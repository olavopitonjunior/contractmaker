import { NextRequest, NextResponse } from "next/server";
import { PERMISSION } from "@/lib/security/rbac/permissions";
import { ensureLocacaoAccess, isRouteError, parseJsonBody } from "@/lib/locacao/route-helpers";
import { crmLookupSchema } from "@/lib/locacao/validators";
import { prisma } from "@/lib/db/prisma";
import { getIListConnection } from "@/lib/ilist/connection";
import { buildImportPayload } from "@/lib/ilist/import";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/locacao/crm/lookup — localizar um registro no CRM externo por ID.
 *
 * Conector plugado: iList/RexAPI (RE/MAX). `entity: "imovel"` resolve o ID
 * contra o ESPELHO org-scoped (aceita ListingID público, ilistId "710031017-6"
 * ou ExternalID com/sem prefixo "ext-") e devolve `fields` já no shape do
 * propertyCreateSchema. `entity: "cliente"` segue não configurado (o iList não
 * expõe leads/clientes via API — ver docs/integracoes/ilist-rexapi-study.md).
 *
 * Contrato estável com a UI (ImportarCrmDialog):
 *   - `{ configured: false, message }` (HTTP 501) sem conector.
 *   - `{ configured: true, entity, crmId, fields }` no sucesso.
 */
export async function POST(req: NextRequest) {
  const ctx = await ensureLocacaoAccess(PERMISSION.CLIENT_VIEW);
  if (isRouteError(ctx)) return ctx;

  const parsed = await parseJsonBody(req, crmLookupSchema);
  if (!parsed.ok) return parsed.response;
  const { entity, crmId } = parsed.data;

  const notConfigured = (message: string) =>
    NextResponse.json({ configured: false, entity, crmId, message }, { status: 501 });

  if (entity === "cliente") {
    return notConfigured(
      "O iList não expõe clientes/leads via API. Importe o imóvel e cadastre o cliente manualmente.",
    );
  }

  const connection = await getIListConnection(ctx.orgId);
  if (!connection) {
    return notConfigured(
      "Integração iList não habilitada para esta imobiliária. Fale com o suporte.",
    );
  }

  const term = crmId.trim().replace(/^ext-/i, "");
  const listing = await prisma.iListListing.findFirst({
    where: {
      orgId: ctx.orgId,
      deletedAt: null,
      OR: [{ listingCode: term }, { ilistId: term }, { externalId: term }],
    },
  });
  if (!listing) {
    return NextResponse.json(
      {
        configured: true,
        entity,
        crmId,
        error: "NOT_FOUND",
        message: `Nenhum imóvel com o código "${crmId}" no catálogo iList desta imobiliária. O catálogo sincroniza a cada 6h.`,
      },
      { status: 404 },
    );
  }

  const payload = await buildImportPayload(listing, connection.regionId);

  return NextResponse.json({
    configured: true,
    entity,
    crmId,
    fields: payload.locacaoFields,
  });
}
