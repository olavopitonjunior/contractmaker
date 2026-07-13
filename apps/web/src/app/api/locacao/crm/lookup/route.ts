import { NextRequest, NextResponse } from "next/server";
import { PERMISSION } from "@/lib/security/rbac/permissions";
import { ensureLocacaoAccess, isRouteError, parseJsonBody } from "@/lib/locacao/route-helpers";
import { crmLookupSchema } from "@/lib/locacao/validators";

export const dynamic = "force-dynamic";

/**
 * POST /api/locacao/crm/lookup — localizar um registro no CRM externo por ID.
 *
 * STUB (Fase 1): a integração real ainda não está plugada. Este é o SEAM onde
 * um conector (ex.: lib/superlogica, read-only) entrará depois. Contrato de
 * resposta ESTÁVEL pra a UI:
 *   - `{ configured: false, message }` (HTTP 501) enquanto não há conector.
 *   - futuro sucesso: `{ configured: true, entity, crmId, fields: {...} }` onde
 *     `fields` já vem no shape aceito por POST /clients ou /properties.
 *
 * A popup de import consome esse shape: mostra "CRM não configurado" quando
 * `configured=false`, e um preview + botão "Importar" quando `configured=true`.
 */
export async function POST(req: NextRequest) {
  const ctx = await ensureLocacaoAccess(PERMISSION.CLIENT_VIEW);
  if (isRouteError(ctx)) return ctx;

  const parsed = await parseJsonBody(req, crmLookupSchema);
  if (!parsed.ok) return parsed.response;

  return NextResponse.json(
    {
      configured: false,
      entity: parsed.data.entity,
      crmId: parsed.data.crmId,
      message:
        "Integração com o CRM ainda não configurada. A busca por ID será habilitada quando o conector for conectado.",
    },
    { status: 501 }
  );
}
