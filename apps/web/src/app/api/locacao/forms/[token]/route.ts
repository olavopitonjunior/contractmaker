import { NextRequest, NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { matchDealGroup } from "@/lib/newton/group-match";
import { generateLocacaoContractForDeal } from "@/lib/services/contract-generation";
import { emitNotification } from "@/lib/notifications/emit";
import { deepMergeAtPaths } from "@/lib/forms/dataJson-merge";
import {
  mergeSalesFormDataJson,
  FormNotFoundError,
} from "@/lib/forms/atomic-merge";
import { syncDealClientName } from "@/lib/forms/sync-deal-client-name";
import { formClosedResponse, viewerIsOrgMember } from "@/lib/forms/form-gate";
import {
  redactCommissionerReceiving,
  preserveCommissionerReceiving,
  stripCommissionerReceiving,
} from "@/lib/forms/redact-datajson";
import { autoRegisterFormCommissioners } from "@/lib/forms/auto-register-commissioners";
import { notifyDealEvent } from "@/lib/notifications/deal-events";
import {
  schemaForLocacaoType,
  collectLocacaoFinalizeIssues,
  assertLocacaoFinalizable,
  LocacaoFinalizeBlockedError,
} from "@/lib/forms/validation-locacao";
import { resolveFormRequiredFields } from "@/lib/forms/required-snapshot";
import {
  shouldRecordConsent,
  consentFields,
} from "@/lib/legal/privacy-consent";
import { findMissingRequired, getByPath } from "@/lib/forms/party-required";
import { missingFiadorName } from "@/lib/forms/garantia-fiador-flip";
import { audit, extractAuditContextFromRequest } from "@/lib/security/audit";
import { getOrgModules, isModuleEnabled } from "@/lib/modules/read";
import { MODULE } from "@/lib/modules/catalog";

export const dynamic = "force-dynamic";

// Rota PÚBLICA (sem auth) — não passa pelo seam ensureLocacaoAccess. O gating de
// módulo é feito aqui após resolver a org pelo token: se a org desabilitou o
// módulo de locação, o link público responde "indisponível" (não 403 cru).
async function locacaoEnabled(orgId: string): Promise<boolean> {
  return isModuleEnabled(await getOrgModules(orgId), MODULE.LOCACAO);
}

// GET público — busca o form de locação por token.
export async function GET(
  _req: NextRequest,
  { params }: { params: { token: string } }
) {
  const form = await prisma.salesForm.findUnique({ where: { token: params.token } });
  if (!form) return NextResponse.json({ error: "Form not found" }, { status: 404 });
  if (!(await locacaoEnabled(form.orgId))) {
    return NextResponse.json({ error: "Formulário indisponível" }, { status: 404 });
  }
  // Mesmo gate do form de venda: enviado → só membro da org. O dataJson de
  // locação carrega PII de locador/locatário/fiador.
  const closed = await formClosedResponse(form);
  if (closed) return closed;

  // Mesma redação da esteira de venda — o angariador tem os mesmos dados
  // bancários e o link de locação também costuma estar com o cliente.
  const viewerIsMember = await viewerIsOrgMember(form.orgId);

  return NextResponse.json(
    {
      id: form.id,
      token: form.token,
      title: form.title,
      schemaType: form.schemaType,
      dataJson: redactCommissionerReceiving(form.dataJson, { viewerIsMember }),
      status: form.status,
      updatedAt: form.updatedAt,
      lockedAt: form.lockedAt ? form.lockedAt.toISOString() : null,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}

// PATCH público — auto-save + finalize. Espelha /api/forms/[token] mas valida
// com o schema de locação, pula dedupConjuges/socio_pj (venda) e gera o
// contrato via generateLocacaoContractForDeal. A config fiscal/comissão
// (operador-only) é preservada pelo deep-merge — o cliente não a envia.
export async function PATCH(
  req: NextRequest,
  { params }: { params: { token: string } }
) {
  const body = await req.json();

  const form = await prisma.salesForm.findUnique({
    where: { token: params.token },
    include: {
      org: { select: { formSettings: { select: { autoLockFormOnFinalize: true } } } },
    },
  });
  if (!form) return NextResponse.json({ error: "Form not found" }, { status: 404 });
  if (!(await locacaoEnabled(form.orgId))) {
    return NextResponse.json({ error: "Formulário indisponível" }, { status: 404 });
  }

  // Guard de travamento: form travado não aceita mais alterações (espelha
  // /api/forms/[token]). Lê o estado ANTERIOR — o auto-lock do finalize abaixo
  // não se auto-bloqueia.
  if (form.lockedAt) {
    return NextResponse.json(
      { error: "Formulário travado — não aceita mais alterações", reason: "form_locked" },
      { status: 403 },
    );
  }

  const closed = await formClosedResponse(form);
  if (closed) return closed;

  const requestedStatus =
    typeof body.status === "string" ? body.status : undefined;
  const autoLockSetting =
    form.org.formSettings?.autoLockFormOnFinalize === true;
  // Ver /api/forms/[token]: de quem não é membro, o `recebimento` do angariador
  // volta redigido e precisa ser restaurado no merge.
  const viewerIsMember = await viewerIsOrgMember(form.orgId);
  let finalizedNow = false;

  // Obrigatoriedade configurada pela imobiliária: BLOQUEIA o finalize (422) em
  // vez de virar aviso. O form público é burlável — sem esta trava o preset
  // seria só decoração de UI. Roda ANTES do merge pra não deixar o formulário
  // meio-finalizado; a prévia usa o mesmo deep-merge do caminho real (a versão
  // canônica roda logo abaixo sob row lock).
  //
  // Só a AUSÊNCIA de campo requerido bloqueia. Problema de FORMATO
  // (collectLocacaoFinalizeIssues) segue como warning na resposta — foi assim
  // que a esteira sempre funcionou e o cliente não pode ficar preso por um
  // CPF que o OCR trouxe torto.
  if (requestedStatus === "completo" && form.status !== "completo") {
    const preview = deepMergeAtPaths(
      structuredClone((form.dataJson ?? {}) as Record<string, unknown>),
      (body.dataJson ?? {}) as Record<string, unknown>
    ).merged;
    const requiredByStep = await resolveFormRequiredFields(form);
    const missingRequired = findMissingRequired(
      requiredByStep.flat(),
      (path) => getByPath(preview, path)
    );
    if (missingRequired.length > 0) {
      return NextResponse.json(
        {
          error: "Campos obrigatórios não preenchidos",
          reason: "required_fields_missing",
          missingRequired,
        },
        { status: 422 }
      );
    }
    // Garantia por fiador exige o fiador NOMEADO (2026-09-02). Era só aviso;
    // virou bloqueio quando um documento atribuído ao fiador passou a definir a
    // modalidade sozinho: sem isto, "tipo=fiador" com fiador vazio chegava ao
    // contrato (preâmbulo mutilado, cláusula de fiança sem fiador, linha de
    // assinatura em branco). Só o nome bloqueia; CPF/endereço/cônjuge seguem
    // como aviso, pelo mesmo motivo do comentário acima.
    const missingFiador = missingFiadorName(preview);
    if (missingFiador) {
      return NextResponse.json(
        {
          error: "Garantia por fiador exige o nome do fiador",
          reason: "fiador_incompleto",
          missingRequired: [missingFiador],
        },
        { status: 422 }
      );
    }
  }

  // Merge atômico sob row lock (lib/forms/atomic-merge.ts): releitura do
  // dataJson dentro da transação — o save do token principal não regride o
  // que um subtoken (locador/locatário/fiador) gravou depois da leitura
  // inicial acima. Espelha /api/forms/[token]: a transição pra "completo" é
  // decidida contra o estado FRESCO sob o lock — auto-save concorrente não
  // regride o finalize, e finalize duplo não dobra a geração de contrato.
  let mergeOutcome;
  try {
    mergeOutcome = await mergeSalesFormDataJson({
      where: { token: params.token },
      incoming: (body.dataJson ?? {}) as Record<string, unknown>,
      // Cinto contra o eco de template do auto-save (ver /api/forms/[token]):
      // aba stale não regrava locadores/locatarios 100% vazios por cima do
      // que um link individual preencheu. Fiador fica fora — mora dentro do
      // objeto `garantia` (deep-merge de objeto, não substituição de array).
      protectBlankPartyArrays: ["locadores", "locatarios"],
      // Mesma restauração da esteira de venda: o autosave de quem não é membro
      // devolve os angariadores sem o `recebimento`, que a redação tirou do
      // GET, e o merge os apagaria.
      transform: (merged, fresh) => {
        const out = preserveCommissionerReceiving(merged, fresh.dataJson, {
          viewerIsMember,
        });
        // Veto do finalize SOB O LOCK, sobre o estado RESULTANTE. O piso do
        // wizard (nome da parte, valor do aluguel) deixou de valer sempre —
        // passou a ceder à configuração da org —, então a garantia tem que
        // existir no servidor. Aqui, e não no gate pré-lock ao lado de
        // `missingRequired`, porque lá se mede o `preview`: um auto-save
        // concorrente de outra aba ou de um subtoken pode apagar o nome entre
        // a leitura e a gravação, e o finalize passaria. Lançar aborta a
        // transação: nem `dataJson` nem `status` são gravados.
        if (requestedStatus === "completo" && fresh.status !== "completo") {
          assertLocacaoFinalizable(out);
        }
        return out;
      },
      extraData: (fresh) => {
        const newStatus = requestedStatus ?? fresh.status;
        const isFinalizing =
          newStatus === "completo" && fresh.status !== "completo";
        finalizedNow = isFinalizing;
        return {
          title: body.title ?? form.title,
          status: newStatus,
          // Espelha o finalize de venda: `completedAt` só na primeira vez (é
          // marco de SLA — re-finalizar após uma correção não pode reescrever
          // a data do envio original) e `reopenedAt: null` fecha o gate de
          // novo. Sem este último, um form de locação reaberto ficaria
          // PÚBLICO pra sempre.
          ...(isFinalizing
            ? {
                ...(fresh.completedAt ? {} : { completedAt: new Date() }),
                reopenedAt: null,
              }
            : {}),
          ...(isFinalizing && autoLockSetting ? { lockedAt: new Date() } : {}),
          // Evidência de consentimento LGPD, igual à venda. O finalize É o ato
          // de consentir (o wizard bloqueia o submit sem o checkbox), e até
          // 2026-09-04 a locação coletava o aceite e não o gravava.
          ...(shouldRecordConsent({
            isFinalizing,
            alreadyAcceptedAt: fresh.privacyAcceptedAt,
            bodyPrivacyAccepted: body.privacyAccepted,
          })
            ? consentFields(req)
            : {}),
        };
      },
    });
  } catch (error) {
    // A row pode sumir entre o findUnique inicial e o SELECT FOR UPDATE
    // (operador deletando o deal com ?deleteForm=true durante um auto-save).
    if (error instanceof FormNotFoundError) {
      return NextResponse.json({ error: "Form not found" }, { status: 404 });
    }
    // Veto do finalize (assertLocacaoFinalizable, dentro do transform sob o
    // lock): a transação foi abortada, nada foi gravado. Mesmo formato do 422
    // de `required_fields_missing` — o cliente já sabe destacar `missingRequired`.
    if (error instanceof LocacaoFinalizeBlockedError) {
      return NextResponse.json(
        {
          error: "Campos obrigatórios não preenchidos",
          reason: "finalize_blocked",
          missingRequired: error.issues.map((i) => i.path),
          validationIssues: error.issues,
        },
        { status: 422 }
      );
    }
    throw error;
  }
  const isFinalizing = finalizedNow;
  const mergedData = mergeOutcome.finalData;
  const updated = mergeOutcome.updated;

  if (mergeOutcome.skippedBlankArrayKeys.length > 0) {
    // Guard de eco de template agiu — não bloqueia o save; fica visível.
    console.warn("[locacao forms PATCH] blank party arrays skipped", {
      token: params.token,
      skippedKeys: mergeOutcome.skippedBlankArrayKeys,
    });
    audit(
      extractAuditContextFromRequest(req, form.orgId, null),
      {
        action: "FORM_PATCH_BLANK_ARRAY_SKIPPED",
        result: "DENIED",
        resource: form.id,
        resourceType: "SalesForm",
        metadata: { kind: "locacao", skippedKeys: mergeOutcome.skippedBlankArrayKeys },
      },
    );
  }

  // Validação server-side no finalize (form público é burlável). Não bloqueia a
  // geração — materializa os problemas na resposta pra correção no editor.
  let validationIssues: Array<{ path: string; message: string }> = [];
  if (isFinalizing) {
    const schema = schemaForLocacaoType(form.schemaType);
    const result = schema.safeParse(mergedData);
    const schemaIssues = result.success
      ? []
      : result.error.issues.map((i) => ({
          path: i.path.join("."),
          message: i.message,
        }));
    // Guarda de finalize (obrigatoriedade dura de endereço/valor/vigência +
    // formato quando preenchido). Dedupe por path — o schema base e a guarda
    // podem cobrir o mesmo campo (ex.: fiador).
    const finalizeIssues = collectLocacaoFinalizeIssues(
      mergedData as Record<string, unknown>
    );
    const seen = new Set(schemaIssues.map((i) => i.path));
    validationIssues = [
      ...schemaIssues,
      ...finalizeIssues.filter((i) => !seen.has(i.path)),
    ];
    if (validationIssues.length > 0) {
      console.warn(
        `[locacao/finalize] form ${form.id} finalizado com ${validationIssues.length} problema(s):`,
        validationIssues.map((v) => `${v.path}: ${v.message}`).join(" | ")
      );
    }
  }

  if (typeof body.title === "string" && body.title.trim() && body.title !== form.title) {
    await prisma.deal.updateMany({ where: { formId: form.id }, data: { title: body.title } });
  }

  // Sincroniza Deal.clientName (locatário titular) — helper compartilhado
  // com a esteira de vendas e o subtoken por parte.
  if (body.dataJson || isFinalizing) {
    await syncDealClientName({
      formId: form.id,
      schemaType: form.schemaType,
      mergedData: mergedData as Record<string, unknown>,
    });
  }

  let contractId: string | null = null;
  let dealId: string | null = null;
  if (isFinalizing) {
    const deal = await prisma.deal.findFirst({ where: { formId: form.id } });
    if (deal) {
      dealId = deal.id;
      // Mesmo guard do finalize de venda: contrato já existente NÃO é
      // regenerado. Como a reabertura é no nível do SalesForm (a rota /lock
      // serve as duas esteiras), re-finalizar uma locação criaria um Contract
      // v2 e rebaixaria o v1 a isLatest=false, levando junto as edições que o
      // corretor já fez no Google Doc. Aqui só sincronizamos os dados
      // revisados (merge, pra não apagar o enriquecimento).
      const existingContract = await prisma.contract.findFirst({
        where: { dealId: deal.id },
        orderBy: { version: "desc" },
        select: { id: true, status: true, dataJson: true },
      });
      if (existingContract) {
        contractId = existingContract.id;
        if (existingContract.status !== "aprovado") {
          try {
            const existingData =
              (existingContract.dataJson as Record<string, unknown> | null) ?? {};
            const syncedData = deepMergeAtPaths(
              structuredClone(existingData),
              // Sem os dados bancários do corretor: o Contract.dataJson é lido
              // pelo prompt do LLM de análise, pelo ClickSign e pelo DIMOB, e
              // nenhum deles precisa da chave PIX. Mesma regra do fan-out em
              // contract-generation.
              stripCommissionerReceiving(mergedData)
            ).merged;
            await prisma.contract.update({
              where: { id: existingContract.id },
              data: { dataJson: syncedData as Prisma.InputJsonValue },
            });
          } catch (error) {
            console.error("[locacao] sync contract dataJson failed:", error);
          }
        }
      } else {
        try {
          // O marco do finalize é o form_completed ("formulário foi
          // preenchido"), disparado no fim deste bloco — a geração do contrato
          // em si não notifica ninguém (paridade com vendas).
          const result = await generateLocacaoContractForDeal(deal.id, deal.userId, form.orgId);
          contractId = result.contractId;
        } catch (error) {
          console.error("[locacao] auto-generate contract failed:", error);
          // O cliente que preencheu o form não pode ser punido por um problema da
          // imobiliária (modelo inacessível no Drive, etc.) — o finalize segue. Mas a
          // imobiliária precisa SABER: sem isto, o deal só ficaria sem contrato.
          waitUntil(emitNotification({
            orgId: form.orgId,
            type: "contract_generation_failed",
            title: "Não foi possível gerar o contrato",
            body: error instanceof Error ? error.message : "Erro ao gerar o contrato do modelo.",
            linkUrl: `/locacao/deals/${deal.id}`,
            metadata: { dealId: deal.id, formId: form.id },
          }));
        }
      }

      // Notificação de form_completed é disparada no fim do bloco isFinalizing,
      // encadeada após o auto-cadastro de corretores (paridade com vendas).

      // Copia FormAttachment → DealAttachment (dedupe por URL).
      try {
        const formAttachments = await prisma.formAttachment.findMany({
          where: { formId: form.id },
        });
        if (formAttachments.length > 0) {
          const existing = await prisma.dealAttachment.findMany({
            where: { dealId: deal.id },
            select: { url: true },
          });
          const existingUrls = new Set(existing.map((e) => e.url));
          const newOnes = formAttachments.filter((a) => !existingUrls.has(a.url));
          if (newOnes.length > 0) {
            await prisma.dealAttachment.createMany({
              data: newOnes.map((a) => ({
                dealId: deal.id,
                filename: a.filename,
                mime: a.mime,
                url: a.url,
                category: a.category,
                extractedData: (a.extractedData as Prisma.InputJsonValue) ?? undefined,
              })),
            });
          }
        }
      } catch (error) {
        console.error("[locacao] link form attachments to deal failed:", error);
      }

      waitUntil(matchDealGroup(deal.id).catch(() => {}));
    }

    // Auto-cadastro de corretores (paridade com vendas): o helper varre tanto
    // comissao.comissionados (venda) quanto comissao.angariadores — que desde
    // 2026-08 vêm também da etapa Comissão do form público. Depois da geração
    // de propósito — o helper reescreve o dataJson do form. Em seguida
    // (encadeado), a notificação de form_completed: sino (mesmo type+batchId=
    // form.id do sino legado) + fan-out pros corretores.
    waitUntil(
      autoRegisterFormCommissioners({ formId: form.id, orgId: form.orgId }).then(
        () =>
          dealId
            ? notifyDealEvent({
                dealId,
                orgId: form.orgId,
                event: "form_completed",
                dedupeKey: form.id,
                context: { formId: form.id, extra: { formId: form.id } },
              })
            : undefined
      )
    );
  }

  audit(extractAuditContextFromRequest(req, form.orgId, null), {
    action: "FORM_UPDATE",
    result: "SUCCESS",
    resource: form.id,
    resourceType: "SalesForm",
    metadata: { kind: "locacao", finalizing: isFinalizing, contractId, dealId },
  });

  return NextResponse.json({
    id: updated.id,
    status: updated.status,
    updatedAt: updated.updatedAt,
    contractId,
    dealId,
    validationIssues,
    skippedBlankArrayKeys: mergeOutcome.skippedBlankArrayKeys,
  });
}
