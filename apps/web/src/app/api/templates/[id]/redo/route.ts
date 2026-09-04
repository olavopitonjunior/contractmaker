import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { authorizeIngestion, isOwnedBlobUrl } from "@/lib/ingestion/route-auth";
import { parseLibraryPlan } from "@/lib/ingestion/plan-review";
import { isFilledInstance, knownProviderLabels } from "@/lib/ingestion/plan-executor";
import { sniffFileKind } from "@/lib/ingestion/run-executor";
import {
  ingestTemplateFromDocx,
  RedoTemplateError,
  TemplateDriveUploadError,
} from "@/lib/templates/ingest-template-from-docx";
import { audit, extractAuditContextFromRequest } from "@/lib/security/audit";

export const runtime = "nodejs";
// O pipeline inteiro roda de novo (Drive + slots + IA + releitura): mesmo teto
// da execução do lote.
export const maxDuration = 300;

/**
 * POST /api/templates/[id]/redo — "Refazer padronização".
 *
 * O caminho "nuclear" da revisão: quando o rascunho saiu ruim e as correções
 * cirúrgicas não bastam, o operador refaz do zero a partir do arquivo ORIGINAL
 * do lote — sem reingerir o lote, sem perder o link do modelo. A linha
 * `ContractTemplate` é reaproveitada (mesmo id, nome e critérios); nasce um
 * Google Doc novo e o anterior vai para a lixeira do Drive depois do sucesso.
 *
 * O plano do lote é reaproveitado por `sourceItemId`: os mesmos blocos de slot,
 * os mesmos fornecedores a neutralizar, o mesmo gabarito quando o item era uma
 * instância preenchida. Sem lote (envio avulso, sem `sourceHash` ou sem item)
 * não há de onde refazer: 404 `SOURCE_MISSING` com a instrução de reenviar.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const authz = await authorizeIngestion();
  if (!authz.ok) return authz.response;
  const { orgId, userId } = authz.actor;

  // Escopo na QUERY: inexistente e de outro tenant devolvem o mesmo 404.
  const template = await prisma.contractTemplate.findFirst({
    where: { id: params.id, orgId },
    select: {
      id: true,
      name: true,
      engine: true,
      status: true,
      modalidade: true,
      sourceHash: true,
      googleTemplateDocId: true,
      matchCriteria: true,
    },
  });
  if (!template) {
    return NextResponse.json({ error: "Modelo não encontrado." }, { status: 404 });
  }
  if (template.engine !== "google_docs" || !template.googleTemplateDocId) {
    return NextResponse.json(
      { error: "Só modelo Google Docs pode ser refeito.", code: "NOT_GOOGLE_DOCS" },
      { status: 400 }
    );
  }
  if (template.status === "active") {
    return NextResponse.json(
      {
        error: "Modelo ativo não pode ser refeito. Volte-o para rascunho primeiro.",
        code: "TEMPLATE_ACTIVE",
      },
      { status: 409 }
    );
  }
  const SOURCE_MISSING = NextResponse.json(
    {
      error:
        "Não encontrei o arquivo original deste modelo no acervo. Reenvie o DOCX pela Central de ingestão (com \"substituir\") para refazer.",
      code: "SOURCE_MISSING",
    },
    { status: 404 }
  );
  if (!template.sourceHash) return SOURCE_MISSING;

  // A junção item ↔ modelo é (sourceHash, org do run) — não há FK. O item mais
  // recente ganha: é o que tem o texto e o plano mais atuais.
  const item = await prisma.ingestionItem.findFirst({
    where: { sourceHash: template.sourceHash, run: { orgId } },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      filename: true,
      blobUrl: true,
      text: true,
      classification: true,
      run: {
        select: {
          id: true,
          libraryPlan: true,
          items: { select: { classification: true } },
        },
      },
    },
  });
  if (!item) return SOURCE_MISSING;
  if (!isOwnedBlobUrl(item.blobUrl, orgId)) {
    return NextResponse.json(
      { error: "O arquivo original não pertence a esta imobiliária.", code: "BLOB_NOT_OWNED" },
      { status: 403 }
    );
  }

  let buffer: Buffer;
  try {
    const res = await fetch(item.blobUrl);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    buffer = Buffer.from(await res.arrayBuffer());
  } catch (err) {
    console.error("[templates/redo] falha ao baixar o arquivo original:", err);
    return NextResponse.json(
      { error: "Não consegui baixar o arquivo original agora. Tente de novo.", code: "SOURCE_FETCH_FAILED" },
      { status: 502 }
    );
  }
  if (sniffFileKind(buffer) !== "docx") {
    return NextResponse.json(
      { error: "Só DOCX vira modelo — o arquivo original deste modelo não é DOCX.", code: "NOT_DOCX" },
      { status: 422 }
    );
  }

  const plan = parseLibraryPlan(item.run.libraryPlan);
  const planned = plan?.templates.find((t) => t.sourceItemId === item.id) ?? null;
  const neutralizeProviders = plan ? knownProviderLabels(plan, item.run.items) : [];

  try {
    const created = await ingestTemplateFromDocx({
      orgId,
      buffer,
      filename: item.filename,
      modalidade: template.modalidade ?? planned?.modalidade ?? "locacao",
      name: template.name,
      matchCriteria: (template.matchCriteria ?? null) as Record<string, unknown> | null,
      slotBlocks: planned?.slotBlocks ?? {},
      neutralizeProviders,
      extractGabarito: isFilledInstance(item.classification) ? { userId } : null,
      sourceText: item.text ?? null,
      reuse: { templateId: template.id },
    });

    await audit(extractAuditContextFromRequest(req, orgId, userId), {
      action: "TEMPLATE_REDO",
      result: "SUCCESS",
      resource: template.id,
      resourceType: "ContractTemplate",
      metadata: {
        previousDocId: template.googleTemplateDocId,
        newDocId: created.docId,
        runId: item.run.id,
        itemId: item.id,
        slotsApplied: created.slots.filter((s) => s.applied).map((s) => s.slot),
        neutralized: created.neutralization?.replaced?.length ?? 0,
      },
    });

    // O relatório completo (slots, PII, semântica, redo) já está na linha.
    const fresh = await prisma.contractTemplate.findUnique({
      where: { id: template.id },
      select: { draftReport: true },
    });
    return NextResponse.json({
      ok: true,
      docId: created.docId,
      embedLink: created.embedLink,
      webViewLink: created.webViewLink,
      report: fresh?.draftReport ?? null,
    });
  } catch (err) {
    if (err instanceof RedoTemplateError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    }
    if (err instanceof TemplateDriveUploadError) {
      return NextResponse.json({ error: err.message, code: "DRIVE_UPLOAD_FAILED" }, { status: 502 });
    }
    console.error("[templates/redo] Erro:", err);
    // "Nada mudou" e "o Doc JÁ foi trocado, o resto falhou" são estados
    // diferentes para quem está na tela: no segundo, o modelo aponta para um
    // Doc novo cru — revalidar ou refazer de novo resolve; fingir que nada
    // aconteceu esconde isso.
    let swapped = false;
    try {
      const now = await prisma.contractTemplate.findUnique({
        where: { id: template.id },
        select: { googleTemplateDocId: true },
      });
      swapped = !!now && now.googleTemplateDocId !== template.googleTemplateDocId;
    } catch {
      // Sem leitura, sem afirmação: cai na mensagem genérica.
    }
    const detail = err instanceof Error ? err.message : "Falha ao refazer a padronização.";
    return NextResponse.json(
      swapped
        ? {
            error: `O documento novo foi criado, mas a padronização não terminou: ${detail}. Revalide, ou refaça de novo.`,
            code: "REDO_PARTIAL",
          }
        : { error: detail },
      { status: 502 }
    );
  }
}
