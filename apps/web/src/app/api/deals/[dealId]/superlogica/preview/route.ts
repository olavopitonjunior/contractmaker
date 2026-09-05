import { NextRequest, NextResponse } from "next/server";
import { loadScopedDeal } from "@/lib/deals/route-helpers";
import { PERMISSION } from "@/lib/security/rbac/permissions";
import { getOrgModules, isFeatureEnabled } from "@/lib/modules/read";
import { FEATURE } from "@/lib/modules/catalog";
import { audit, extractAuditContextFromRequest } from "@/lib/security/audit";
import { ExportNotAllowedError, previewDealExport } from "@/lib/superlogica/export/export-deal";

export const runtime = "nodejs";

/**
 * POST /api/deals/[dealId]/superlogica/preview — monta o que vai para a
 * Superlógica SEM escrever nada lá: espelho da tela da venda + avisos.
 * Gate: deal no escopo do ator (404 fora), feature `vendas.superlogica`
 * (404 desligada) e permissão `superlogica.export` (403).
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
  try {
    const preview = await previewDealExport(orgId, deal.id);
    await audit(extractAuditContextFromRequest(req, orgId, auth.actor.effectiveUserId), {
      action: "SUPERLOGICA_VENDA_PREVIEW",
      result: "SUCCESS",
      resource: deal.id,
      resourceType: "Deal",
      metadata: { canExport: preview.canExport, bloqueantes: preview.warnings.filter((w) => w.blocking).map((w) => w.code) },
    }).catch(() => {});
    return NextResponse.json(preview);
  } catch (err) {
    if (err instanceof ExportNotAllowedError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const message = err instanceof Error ? err.message : String(err);
    console.error("[superlogica preview] erro:", message);
    return NextResponse.json({ error: "Falha ao montar o preview." }, { status: 500 });
  }
}
