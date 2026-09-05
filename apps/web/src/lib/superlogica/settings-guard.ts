import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/context";
import {
  requirePermission,
  PermissionDeniedError,
  MembershipRequiredError,
} from "@/lib/security/rbac/guard";
import { PERMISSION } from "@/lib/security/rbac/permissions";
import { getOrgModules, isFeatureEnabled } from "@/lib/modules/read";
import { FEATURE } from "@/lib/modules/catalog";

/**
 * Gate das rotas de configuração da Superlógica (molde: lib/clicksign/
 * settings-guard.ts, mas por PERMISSÃO em vez de papel literal — assim um
 * papel customizado com `superlogica.configure` também configura):
 *   sessão → feature `vendas.superlogica` ligada na org (senão 404: a
 *   integração "não existe" para a org) → `PERMISSION.SUPERLOGICA_CONFIGURE`
 *   (senão 403).
 *
 * Mora fora de `route.ts` de propósito: export que não é handler dentro de um
 * route.ts quebra a checagem de tipos gerada pelo `next build` (TS2344),
 * mesmo com `tsc --noEmit` verde.
 */
export type SuperlogicaAdminCtx = { orgId: string; userId: string };

export async function requireSuperlogicaAdmin(
  req: NextRequest
): Promise<{ ok: true; ctx: SuperlogicaAdminCtx } | { ok: false; response: NextResponse }> {
  const authResult = await requireAuth(req);
  if (!authResult.ok) return { ok: false, response: authResult.response };
  const { ctx } = authResult;
  const modules = await getOrgModules(ctx.orgId);
  if (!isFeatureEnabled(modules, FEATURE.VENDAS_SUPERLOGICA)) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Integração Superlógica não habilitada para esta imobiliária." },
        { status: 404 }
      ),
    };
  }
  try {
    await requirePermission({
      userId: ctx.userId,
      orgId: ctx.orgId,
      permission: PERMISSION.SUPERLOGICA_CONFIGURE,
    });
  } catch (err) {
    if (err instanceof PermissionDeniedError || err instanceof MembershipRequiredError) {
      return {
        ok: false,
        response: NextResponse.json(
          { error: "Sem permissão para configurar a Superlógica nesta imobiliária." },
          { status: 403 }
        ),
      };
    }
    throw err;
  }
  return { ok: true, ctx: { orgId: ctx.orgId, userId: ctx.userId } };
}
