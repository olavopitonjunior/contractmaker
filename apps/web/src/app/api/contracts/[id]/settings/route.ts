import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/context";
import { prisma } from "@/lib/db/prisma";
import { renderContratoHTML } from "@/lib/render/handlebars";
import { audit, extractAuditContextFromRequest } from "@/lib/security/audit";
import { deepMergeAtPaths } from "@/lib/forms/dataJson-merge";
import {
  contractSettingsSchema,
  buildSettingsPatch,
} from "@/lib/contracts/default-config";
import {
  syncRenderedHtmlDiffToDoc,
  type DocSyncReport,
} from "@/lib/contracts/settings-doc-sync";
import { guardContractScope } from "@/lib/deals/route-helpers";
import { PERMISSION } from "@/lib/security/rbac/permissions";

export const runtime = "nodejs";
export const maxDuration = 60;

type SkipReason = "no_google_doc" | "no_template" | "google_docs_engine";

/**
 * PATCH /api/contracts/[id]/settings
 *
 * Salva as configurações contratuais (foro, desistência, local/data de
 * assinatura, multas/juros/prazos) do contrato e reflete a mudança no texto do
 * Google Doc.
 *
 * ## O detalhe que faz a feature funcionar
 *
 * `Contract.dataJson` JÁ está enriquecido (a geração grava o resultado de
 * `enrichContractData`), e o enrich é idempotente — só preenche o que falta.
 * Então gravar só `assinatura.cidade` ou `desistencia.permite` NÃO mudaria uma
 * vírgula do render: as pontes `config.municipio_imovel`,
 * `config.data_assinatura` e `config.desistencia_*` já estão materializadas.
 * `buildSettingsPatch` grava as pontes junto — é isso que faz o texto mudar.
 *
 * ## Por que não re-enriquecer aqui
 *
 * `enrichContractData` tem derivações que dependem da data corrente (prazos de
 * parcela), então re-rodá-lo produziria diferenças espúrias no diff. Renderizar
 * direto do dataJson armazenado reproduz o HTML original e maximiza o casamento
 * dos parágrafos.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const authResult = await requireAuth(req, { scope: "contracts:rw" });
  if (!authResult.ok) return authResult.response;
  const { ctx } = authResult;

  const parsed = contractSettingsSchema.safeParse(
    await req.json().catch(() => null)
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Payload inválido", issues: parsed.error.flatten() },
      { status: 400 }
    );
  }

  // Cross-org guard — Deal não tem orgId direto; o escopo vem do pipeline.
  const contract = await prisma.contract.findFirst({
    where: { id: params.id, deal: { pipeline: { orgId: ctx.orgId } } },
    include: {
      template: { select: { handlebarsSource: true, engine: true } },
      deal: { include: { form: { select: { id: true } } } },
    },
  });
  if (!contract) {
    return NextResponse.json({ error: "Contrato não encontrado" }, { status: 404 });
  }

  // Escopo do gerente + permissão de edição de contrato.
  const denied = await guardContractScope({
    contractId: params.id,
    userId: ctx.userId,
    orgId: ctx.orgId,
    via: ctx.via,
    permission: PERMISSION.CONTRACT_EDIT,
  });
  if (denied) return denied;

  if (contract.status === "aprovado") {
    return NextResponse.json(
      { error: "Contrato aprovado é imutável" },
      { status: 409 }
    );
  }

  const activeEnvelope = await prisma.envelope.findFirst({
    where: { contractId: contract.id, status: { in: ["running", "closed"] } },
    select: { id: true },
  });
  if (activeEnvelope) {
    return NextResponse.json(
      { error: "Contrato já enviado para assinatura — configurações congeladas" },
      { status: 409 }
    );
  }

  const currentData = (contract.dataJson as Record<string, unknown> | null) ?? {};
  const patch = buildSettingsPatch(parsed.data);
  const merged = deepMergeAtPaths(structuredClone(currentData), patch).merged;

  // --- Reflete no Google Doc ---
  let doc: DocSyncReport | { skipped: SkipReason };
  let oldHtml: string | null = null;
  let newHtml: string | null = null;

  if (!contract.googleDocId) {
    doc = { skipped: "no_google_doc" };
  } else if (!contract.templateId || !contract.template) {
    // Contrato importado: o corpo é o GDoc, não há template pra re-renderizar.
    doc = { skipped: "no_template" };
  } else if (contract.template.engine === "google_docs") {
    // Engine google_docs não passa por Handlebars — o diff não se aplica.
    doc = { skipped: "google_docs_engine" };
  } else {
    oldHtml = renderContratoHTML(contract.template.handlebarsSource, currentData);
    newHtml = renderContratoHTML(contract.template.handlebarsSource, merged);
    doc = await syncRenderedHtmlDiffToDoc({
      docId: contract.googleDocId,
      oldHtml,
      newHtml,
    });
  }

  // Persiste mesmo se o doc falhar: dado > texto. O texto é recuperável pelo
  // Chat IA; o dado, se perdido, o usuário redigita.
  await prisma.$transaction(async (tx) => {
    await tx.contract.update({
      where: { id: contract.id },
      data: {
        dataJson: merged as object,
        ...(newHtml ? { htmlContent: newHtml } : {}),
      },
    });
    // Triple-write: uma regeração futura (ou o wizard de cobrança) precisa ver
    // as mesmas configurações — espelha o padrão de /signers-data.
    const dealData = (contract.deal.dataJson as Record<string, unknown> | null) ?? {};
    const dealMerged = deepMergeAtPaths(structuredClone(dealData), patch).merged;
    await tx.deal.update({
      where: { id: contract.dealId },
      data: { dataJson: dealMerged as object },
    });
    if (contract.deal.form?.id) {
      const form = await tx.salesForm.findUnique({
        where: { id: contract.deal.form.id },
        select: { dataJson: true },
      });
      const formMerged = deepMergeAtPaths(
        structuredClone((form?.dataJson as Record<string, unknown> | null) ?? {}),
        patch
      ).merged;
      await tx.salesForm.update({
        where: { id: contract.deal.form.id },
        data: { dataJson: formMerged as object },
      });
    }
  });

  // ChangeLog com htmlBefore/htmlAfter alimenta o painel "Mudanças" (DiffView
  // já renderiza a partir desses campos) — diff visual de graça.
  const applied = "applied" in doc ? doc.applied : 0;
  await prisma.contractChangeLog
    .create({
      data: {
        contractId: contract.id,
        userId: ctx.userId,
        action: "settings_update",
        source: "user",
        summary: `Configurações do contrato atualizadas${
          applied > 0 ? ` — ${applied} trecho(s) ajustado(s) no documento` : ""
        }`,
        details: { report: doc } as object,
        ...(oldHtml && newHtml
          ? {
              htmlBefore: oldHtml.slice(0, 50_000),
              htmlAfter: newHtml.slice(0, 50_000),
            }
          : {}),
      },
    })
    .catch((err) => console.warn("[contract-settings] changelog falhou", err));

  await audit(extractAuditContextFromRequest(req, ctx.orgId, ctx.userId), {
    action: "CONTRACT_SETTINGS_UPDATE",
    result: "SUCCESS",
    resource: contract.id,
    resourceType: "Contract",
    metadata: { via: ctx.via, report: doc as object },
  });

  return NextResponse.json({ ok: true, doc });
}
