import { NextRequest, NextResponse } from "next/server";
import { loadScopedDeal } from "@/lib/deals/route-helpers";
import { PERMISSION } from "@/lib/security/rbac/permissions";
import { getOrgModules, isFeatureEnabled } from "@/lib/modules/read";
import { FEATURE } from "@/lib/modules/catalog";
import { extractAuditContextFromRequest } from "@/lib/security/audit";
import { ExportNotAllowedError, exportDeal } from "@/lib/superlogica/export/export-deal";
import { VendaExportBlockedError } from "@/lib/superlogica/export/build-venda-payload";
import { SuperlogicaNotConfiguredError } from "@/lib/superlogica/account";
import { SuperlogicaError } from "@/lib/superlogica/client";

export const runtime = "nodejs";
// ~20–30 chamadas SERIAIS à Superlógica (pessoas, corretores, imóvel, venda,
// leitura de volta) a 1–4 s cada. Literal exigido pelo Next; o valor é
// espelhado em EXPORT_MAX_DURATION_S (export-deal.ts), de onde deriva a
// janela de "running abandonado".
export const maxDuration = 300;

/**
 * POST /api/deals/[dealId]/superlogica/export — cria a venda na Superlógica
 * (pessoas → corretores → imóvel → venda), grava o registro e move o negócio
 * para "Cobrança emitida". Idempotente por negócio: segunda chamada devolve a
 * venda existente (200, `alreadyExported: true`).
 * Respostas: 422 avisos bloqueantes; 409 stage/conta/andamento; 502 API da
 * Superlógica recusou (mensagem dela, sem PII).
 */
export async function POST(req: NextRequest, { params }: { params: { dealId: string } }) {
  const r = await loadScopedDeal(req, params.dealId, { permission: PERMISSION.SUPERLOGICA_EXPORT });
  if ("fail" in r) return r.fail;
  const { auth, deal } = r;
  const orgId = deal.pipeline.orgId;
  const modules = await getOrgModules(orgId);
  if (!isFeatureEnabled(modules, FEATURE.VENDAS_SUPERLOGICA)) {
    return NextResponse.json({ error: "Não encontrado" }, { status: 404 });
  }
  const userId = auth.actor.effectiveUserId;
  try {
    const result = await exportDeal({
      orgId,
      dealId: deal.id,
      userId,
      auditCtx: extractAuditContextFromRequest(req, orgId, userId),
    });
    return NextResponse.json(result, { status: result.alreadyExported ? 200 : 201 });
  } catch (err) {
    if (err instanceof VendaExportBlockedError) {
      return NextResponse.json(
        { error: "Exportação bloqueada. Corrija os itens abaixo.", warnings: err.warnings },
        { status: 422 },
      );
    }
    if (err instanceof ExportNotAllowedError || err instanceof SuperlogicaNotConfiguredError) {
      const status = err instanceof ExportNotAllowedError ? err.status : 409;
      return NextResponse.json({ error: err.message }, { status });
    }
    if (err instanceof SuperlogicaError) {
      return NextResponse.json({ error: `Superlógica recusou: ${err.message}` }, { status: 502 });
    }
    // Erro não previsto (Prisma, decrypt, moveDealStage…): mensagem fixa para
    // o browser; o texto interno fica só no log e no registro da exportação.
    console.error("[superlogica export] erro:", err instanceof Error ? err.message : String(err));
    return NextResponse.json(
      { error: "Falha interna ao exportar. A tentativa ficou registrada no negócio; tente de novo em instantes." },
      { status: 500 },
    );
  }
}
