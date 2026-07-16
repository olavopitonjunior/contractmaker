import { NextRequest, NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { matchDealGroup } from "@/lib/newton/group-match";
import { generateContractForDeal } from "@/lib/services/contract-generation";
import { emitNotification } from "@/lib/notifications/emit";
import { dedupConjuges } from "@/lib/forms/dedup-conjuges";
import { dadosContratoSchema } from "@/lib/forms/validation";
import { sendFormSummary } from "@/lib/forms/form-summary-mailer";
import { deepMergeAtPaths } from "@/lib/forms/dataJson-merge";
import { formClosedResponse } from "@/lib/forms/form-gate";
import { audit, extractAuditContextFromRequest } from "@/lib/security/audit";

// GET: public - fetch form data by token
export async function GET(
  _req: NextRequest,
  { params }: { params: { token: string } }
) {
  const form = await prisma.salesForm.findUnique({
    where: { token: params.token },
  });

  if (!form) {
    return NextResponse.json({ error: "Form not found" }, { status: 404 });
  }

  // Form já enviado só é legível por membro da org — o link público deixa de
  // servir PII depois do envio. Antes do gate, o dataJson inteiro (CPF, RG,
  // nome da mãe, PIX de todas as partes) saía aqui sem auth nenhuma.
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
      // Travamento: quando setado, o cliente público renderiza somente-leitura.
      lockedAt: form.lockedAt ? form.lockedAt.toISOString() : null,
    },
    // PII não pode encostar em cache de CDN/proxy intermediário.
    { headers: { "Cache-Control": "no-store" } }
  );
}

// PATCH: public - auto-save form data
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

  if (!form) {
    return NextResponse.json({ error: "Form not found" }, { status: 404 });
  }

  // Guard de travamento: form travado não aceita mais alterações por quem tiver
  // o link (espelha o padrão "Contract aprovado = imutável" em
  // contracts/[id]/route.ts). Lê o estado ANTERIOR — o auto-lock que pode
  // acontecer no mesmo finalize (abaixo) não se auto-bloqueia.
  if (form.lockedAt) {
    return NextResponse.json(
      { error: "Formulário travado — não aceita mais alterações", reason: "form_locked" },
      { status: 403 },
    );
  }

  // Form já enviado não aceita mais escrita pública. Sem isto, quem tivesse o
  // link continuaria editando (e re-finalizando) um negócio já fechado.
  // Reabrir é ação autenticada (`POST .../lock { locked:false, reopen:true }`).
  const closed = await formClosedResponse(form);
  if (closed) return closed;

  const currentData = (form.dataJson as Record<string, unknown>) || {};
  // Deep-merge restrito substitui `{ ...current, ...incoming }` raso.
  // Sem allowlist no token principal — subtokens (PR 4) passam ROLE_PATHS.
  // undefined/null em incoming não apaga chave existente. Arrays substituem
  // inteiros pra permitir remoção de itens (ex: deletar 2º comprador).
  const mergeOutcome = deepMergeAtPaths(
    currentData,
    (body.dataJson ?? {}) as Record<string, unknown>,
  );
  const rawMergedData = mergeOutcome.merged;

  if (mergeOutcome.rejectedPaths.length > 0) {
    // Token principal não deveria ter allowlist — qualquer rejectedPath aqui
    // é bug. Audita best-effort sem bloquear save.
    console.warn("[forms PATCH] rejected paths (token principal)", {
      token: params.token,
      rejectedPaths: mergeOutcome.rejectedPaths,
    });
    audit(
      extractAuditContextFromRequest(req, form.orgId, null),
      {
        action: "FORM_PATCH_REJECTED_PATH",
        result: "DENIED",
        resource: form.id,
        resourceType: "SalesForm",
        metadata: { rejectedPaths: mergeOutcome.rejectedPaths },
      },
    );
  }

  const previousStatus = form.status;
  const newStatus = body.status ?? form.status;

  // No finalize (transição para "completo"), aplica dedup de cônjuges
  // duplicados como vendedor/comprador autônomo. Bug demo 2026-05-05:
  // Isabel virou comprador 2 mesmo já sendo cônjuge de Luiz. Em auto-save
  // intermediário não rodamos dedup — usuário pode estar revendo.
  const isFinalizing = newStatus === "completo" && previousStatus !== "completo";
  const mergedData = isFinalizing ? dedupConjuges(rawMergedData) : rawMergedData;

  // A6 (QA deal 20486): validação server-side no finalize. O form público é
  // editável por qualquer um com o link e a validação client-side é burlável —
  // sem isso, dados inválidos (ex.: CPF do cônjuge vazio quando casado, comissão
  // zerada com comissionado, soma de parcelas ≠ total) finalizavam e geravam
  // contrato sem aviso. NÃO bloqueia a geração (o render linter + o gate de
  // aprovação barram o contrato defeituoso downstream), mas materializa os
  // problemas na resposta e no audit pra correção pelo corretor.
  let validationIssues: Array<{ path: string; message: string }> = [];
  if (isFinalizing) {
    const parsed = dadosContratoSchema.safeParse(mergedData);
    if (!parsed.success) {
      validationIssues = parsed.error.issues.map((i) => ({
        path: i.path.join("."),
        message: i.message,
      }));
      console.warn(
        `[forms/finalize] form ${form.id} finalizado com ${validationIssues.length} problema(s) de validação:`,
        validationIssues.map((v) => `${v.path}: ${v.message}`).join(" | ")
      );
    }
  }

  // Auto-lock no finalize: se a org optou por travar o formulário quando o
  // cliente finaliza, congela os dados no mesmo update (o link continua
  // acessível, mas somente-leitura). Default false preserva o reabrível.
  const autoLockOnFinalize =
    isFinalizing && form.org.formSettings?.autoLockFormOnFinalize === true;

  const updated = await prisma.salesForm.update({
    where: { token: params.token },
    data: {
      dataJson: mergedData as Prisma.InputJsonValue,
      title: body.title ?? form.title,
      status: newStatus,
      // `completedAt` só na PRIMEIRA vez: é marco de SLA do funil, e um form
      // reaberto pra corrigir um dado não pode reescrever a data em que o
      // cliente de fato enviou. `reopenedAt: null` fecha o gate de novo.
      ...(isFinalizing
        ? {
            ...(form.completedAt ? {} : { completedAt: new Date() }),
            reopenedAt: null,
          }
        : {}),
      ...(autoLockOnFinalize ? { lockedAt: new Date() } : {}),
    },
  });

  // Keep the deal title in sync with the form title when the user renames the form
  if (typeof body.title === "string" && body.title.trim() && body.title !== form.title) {
    await prisma.deal.updateMany({
      where: { formId: form.id },
      data: { title: body.title },
    });
  }

  // Audita o finalize (paridade com locação, que já emite FORM_UPDATE). Persiste
  // os validationIssues em metadata — antes só viviam na resposta efêmera e no
  // console.warn, sumindo quando o cliente fechava a aba. Best-effort.
  if (isFinalizing) {
    audit(
      extractAuditContextFromRequest(req, form.orgId, null),
      {
        action: "FORM_UPDATE",
        result: validationIssues.length > 0 ? "FAILURE" : "SUCCESS",
        resource: form.id,
        resourceType: "SalesForm",
        metadata: {
          event: "finalize",
          schemaType: form.schemaType,
          validationIssueCount: validationIssues.length,
          validationIssues: validationIssues.slice(0, 50),
        },
      },
    );
  }

  // Auto-generate contract when form is completed
  let contractId: string | null = null;
  let dealId: string | null = null;
  if (newStatus === "completo" && previousStatus !== "completo") {
    const deal = await prisma.deal.findFirst({
      where: { formId: form.id },
    });

    if (deal) {
      dealId = deal.id;
      // Guard anti-duplicação: QUALQUER contrato já existente no deal bloqueia a
      // geração — não só o importado (templateId=null).
      //
      // Antes o guard só olhava o importado, então re-finalizar um form (o que
      // acontece sempre que a org reabre pra corrigir um dado) chamava
      // `generateContractForDeal` de novo: nascia um Contract v2 e o v1 virava
      // isLatest=false, levando junto TODA edição que o corretor já tinha feito
      // no Google Doc. Sincronizar o dataJson é o comportamento certo nos dois
      // casos; gerar versão nova é ação explícita do corretor (`POST .../version`).
      const existingContract = await prisma.contract.findFirst({
        where: { dealId: deal.id },
        orderBy: { version: "desc" },
        select: { id: true, status: true },
      });
      if (existingContract) {
        // A sincronização do dataJson só roda se NÃO estiver aprovado —
        // aprovado é imutável + congelado no PDF da ClickSign.
        contractId = existingContract.id;
        if (existingContract.status !== "aprovado") {
          try {
            await prisma.contract.update({
              where: { id: existingContract.id },
              data: { dataJson: mergedData as Prisma.InputJsonValue },
            });
          } catch (error) {
            console.error("Sync contract dataJson failed:", error);
          }
        }
      } else {
        try {
          const result = await generateContractForDeal(deal.id, deal.userId, form.orgId);
          contractId = result.contractId;
        } catch (error) {
          console.error("Auto-generate contract failed:", error);
          // Falha da imobiliária (ex.: modelo inacessível no Drive) não derruba o
          // finalize do cliente — mas a equipe precisa ser avisada, senão o deal
          // simplesmente fica sem contrato e ninguém entende por quê.
          waitUntil(emitNotification({
            orgId: form.orgId,
            type: "contract_generation_failed",
            title: "Não foi possível gerar o contrato",
            body: error instanceof Error ? error.message : "Erro ao gerar o contrato do modelo.",
            linkUrl: `/deals/${deal.id}`,
            metadata: { dealId: deal.id, formId: form.id },
          }));
        }
      }

      // Sino: avisa a equipe que o cliente finalizou o form (o corretor não
      // descobre mais só olhando o kanban). batchId=form.id deduplica
      // re-finalizações. waitUntil: void após o response é cancelado na Vercel.
      waitUntil(emitNotification({
        orgId: form.orgId,
        type: "form_completed",
        title: "Formulário finalizado pelo cliente",
        body: `"${form.title || deal.title}" foi preenchido até o fim — contrato em geração.`,
        linkUrl: `/deals/${deal.id}`,
        metadata: { dealId: deal.id, formId: form.id },
        batchId: form.id,
      }));

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
                // H.6 (Phase H, 2026-04-18) — copia extractedData inteiro
                // (incluindo {assignment, fields, confidence}) para que a
                // aba Documentos do deal consiga agrupar docs pelo lado
                // explicitamente escolhido pelo usuário no form, em vez
                // do fallback heurístico cego de resolveKind(category).
                extractedData:
                  (a.extractedData as Prisma.InputJsonValue) ?? undefined,
                contentHash: a.contentHash ?? undefined,
              })),
            });
          }
        }
      } catch (error) {
        console.error("Link form attachments to deal failed:", error);
      }

      // Auto-envio do resumo consolidado por e-mail (opt-in por org). Roda
      // inteiramente em waitUntil pra não somar latência ao finalize; gera o
      // PDF + baixa anexos + envia. summarySentAt protege contra re-disparo
      // em re-finalize (o form é reabrível). Só venda (compra_venda_v1).
      if (form.schemaType === "compra_venda_v1") {
        waitUntil(
          (async () => {
            const settings = await prisma.orgFormSettings.findUnique({
              where: { orgId: form.orgId },
              select: {
                autoSendSummaryOnComplete: true,
                summaryRecipientEmail: true,
                summaryIncludeAttachments: true,
              },
            });
            const recipient = settings?.summaryRecipientEmail?.trim();
            if (!settings?.autoSendSummaryOnComplete || !recipient) return;
            const result = await sendFormSummary({
              formId: form.id,
              to: recipient,
              includeAttachments: settings.summaryIncludeAttachments,
              persist: true,
            });
            if (result.ok) {
              await prisma.salesForm.update({
                where: { id: form.id },
                data: { summarySentAt: new Date() },
              });
            }
          })().catch((e) =>
            console.error("[forms/finalize] auto-send summary failed", e)
          )
        );
      }

      // Phase F.II-δ — automação "sou sócio de PJ X":
      // Varre vendedores[] e compradores[] procurando campo `socio_pj` (adicionado
      // pelo front-end quando PF marca checkbox) e cria DiligentedPerson PJ
      // vinculado ao deal. Planner passa a incluir esta PJ no próximo batch de
      // certidões, cobrindo a "lista H" (itens B-G + falência PJ) automaticamente.
      try {
        const dataLocal = mergedData as {
          vendedores?: Array<{
            socio_pj?: { cnpj?: string; razao_social?: string; uf?: string; cidade?: string };
          }>;
          compradores?: Array<{
            socio_pj?: { cnpj?: string; razao_social?: string; uf?: string; cidade?: string };
          }>;
        };
        const partesComSocio = [
          ...(dataLocal.vendedores ?? []),
          ...(dataLocal.compradores ?? []),
        ]
          .map((p) => p.socio_pj)
          .filter((s): s is NonNullable<typeof s> => !!s?.cnpj?.trim());

        if (partesComSocio.length > 0) {
          const existingDiligenciados = await prisma.diligentedPerson.findMany({
            where: { dealId: deal.id },
            select: { cnpj: true },
          });
          const existingCnpjs = new Set(
            existingDiligenciados.map((d) => d.cnpj?.replace(/\D/g, "")).filter(Boolean)
          );
          const newSocios = partesComSocio.filter(
            (s) => !existingCnpjs.has(s.cnpj!.replace(/\D/g, ""))
          );
          if (newSocios.length > 0) {
            await prisma.diligentedPerson.createMany({
              data: newSocios.map((s) => ({
                dealId: deal.id,
                tipoPessoa: "juridica",
                nome: s.razao_social ?? "PJ sem razão social",
                cnpj: s.cnpj!.replace(/\D/g, ""),
                uf: s.uf ?? null,
                cidade: s.cidade ?? null,
              })),
            });
          }
        }
      } catch (error) {
        console.error("Auto-create DiligentedPerson from socio_pj failed:", error);
      }
    }

    // Partes preenchidas → tenta auto-vincular o grupo de WhatsApp do negócio
    // (cruza telefones das partes com os grupos conhecidos). Best-effort.
    if (dealId) waitUntil(matchDealGroup(dealId).catch(() => {}));
  }

  return NextResponse.json({
    id: updated.id,
    status: updated.status,
    updatedAt: updated.updatedAt,
    contractId,
    dealId,
    // A6: problemas de validação detectados no finalize (não bloqueiam a
    // geração, mas o cliente pode exibir e o contrato gerado terá os findings
    // do render linter). Vazio quando os dados passam no dadosContratoSchema.
    validationIssues,
  });
}
