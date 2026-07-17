import { NextRequest, NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { matchDealGroup } from "@/lib/newton/group-match";
import { generateLocacaoContractForDeal } from "@/lib/services/contract-generation";
import { emitNotification } from "@/lib/notifications/emit";
import { deepMergeAtPaths } from "@/lib/forms/dataJson-merge";
import { syncDealClientName } from "@/lib/forms/sync-deal-client-name";
import { formClosedResponse } from "@/lib/forms/form-gate";
import {
  schemaForLocacaoType,
  collectLocacaoFinalizeIssues,
} from "@/lib/forms/validation-locacao";
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

  return NextResponse.json(
    {
      id: form.id,
      token: form.token,
      title: form.title,
      schemaType: form.schemaType,
      dataJson: form.dataJson,
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

  const currentData = (form.dataJson as Record<string, unknown>) || {};
  const mergeOutcome = deepMergeAtPaths(
    currentData,
    (body.dataJson ?? {}) as Record<string, unknown>
  );
  const mergedData = mergeOutcome.merged;

  const previousStatus = form.status;
  const newStatus = body.status ?? form.status;
  const isFinalizing = newStatus === "completo" && previousStatus !== "completo";

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

  const autoLockOnFinalize =
    isFinalizing && form.org.formSettings?.autoLockFormOnFinalize === true;

  const updated = await prisma.salesForm.update({
    where: { token: params.token },
    data: {
      dataJson: mergedData as Prisma.InputJsonValue,
      title: body.title ?? form.title,
      status: newStatus,
      // Espelha o finalize de venda: `completedAt` só na primeira vez (é marco
      // de SLA — re-finalizar após uma correção não pode reescrever a data do
      // envio original) e `reopenedAt: null` fecha o gate de novo. Sem este
      // último, um form de locação reaberto ficaria PÚBLICO pra sempre: o
      // `isFormClosed` só volta a valer quando a reabertura é encerrada.
      ...(isFinalizing
        ? {
            ...(form.completedAt ? {} : { completedAt: new Date() }),
            reopenedAt: null,
          }
        : {}),
      ...(autoLockOnFinalize ? { lockedAt: new Date() } : {}),
    },
  });

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
              mergedData
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

      // Sino: avisa a equipe que o cliente finalizou o form (paridade com
      // vendas). batchId=form.id deduplica re-finalizações. waitUntil: void
      // após o response é cancelado na Vercel.
      waitUntil(emitNotification({
        orgId: form.orgId,
        type: "form_completed",
        title: "Formulário de locação finalizado",
        body: `"${form.title || deal.title}" foi preenchido até o fim — contrato em geração.`,
        linkUrl: `/locacao/deals/${deal.id}`,
        metadata: { dealId: deal.id, formId: form.id },
        batchId: form.id,
      }));

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
  });
}
