import { NextRequest, NextResponse } from "next/server";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { getEffectiveUserId } from "@/lib/auth/impersonation";
import { getEffectivePermissions, can } from "@/lib/security/rbac/check";
import { PERMISSION, PermissionKey } from "@/lib/security/rbac/permissions";
import { assertModuleEnabled, assertFeatureEnabled, ModuleDisabledError } from "@/lib/modules/guard";
import { MODULE, FEATURE, type FeatureKey } from "@/lib/modules/catalog";

// Mapa permission → sub-função do catálogo. Quando a rota não passa `feature`
// explícito, a sub-função é derivada da permission (que já codifica o subdomínio).
// Permissions ausentes aqui gateiam só no nível do MÓDULO (locacao). contratos/
// pessoas são default-on e ficam no gate de módulo; os toggles finos relevantes
// (cobranças/repasses/despesas — default-off) estão mapeados.
// INSURANCE_*/INSPECTION_* gateiam só no módulo: seguros/garantias/vistorias
// fazem parte da jornada comercial do deal (kanban) — os toggles locacao.seguros/
// locacao.vistorias valem apenas pro menu/páginas ADM de portfólio.
// Override explícito quando o mapa seria ambíguo (ex.: RENT_VIEW em repasses/simular).
const PERMISSION_FEATURE: Partial<Record<PermissionKey, FeatureKey>> = {
  [PERMISSION.RENT_VIEW]: FEATURE.LOCACAO_COBRANCAS,
  [PERMISSION.RENT_GENERATE]: FEATURE.LOCACAO_COBRANCAS,
  [PERMISSION.RENT_REMIND]: FEATURE.LOCACAO_COBRANCAS,
  [PERMISSION.RENT_MARK_REPASSED]: FEATURE.LOCACAO_REPASSES,
  [PERMISSION.EXPENSE_VIEW]: FEATURE.LOCACAO_DESPESAS,
  [PERMISSION.EXPENSE_CREATE]: FEATURE.LOCACAO_DESPESAS,
  [PERMISSION.EXPENSE_EDIT]: FEATURE.LOCACAO_DESPESAS,
  [PERMISSION.EXPENSE_DELETE]: FEATURE.LOCACAO_DESPESAS,
  [PERMISSION.CHECKLIST_VIEW]: FEATURE.LOCACAO_VISTORIAS,
  [PERMISSION.CHECKLIST_MANAGE]: FEATURE.LOCACAO_VISTORIAS,
  // Garantia é intrínseca ao contrato (Lei 8.245 art. 37) — gateia em contratos.
  [PERMISSION.GUARANTEE_VIEW]: FEATURE.LOCACAO_CONTRATOS,
  [PERMISSION.GUARANTEE_MANAGE]: FEATURE.LOCACAO_CONTRATOS,
  // Clientes/prospects fazem parte do subdomínio Pessoas.
  [PERMISSION.CLIENT_VIEW]: FEATURE.LOCACAO_PESSOAS,
  [PERMISSION.CLIENT_CREATE]: FEATURE.LOCACAO_PESSOAS,
  [PERMISSION.CLIENT_UPDATE]: FEATURE.LOCACAO_PESSOAS,
};

// Helpers compartilhados pelos endpoints /api/locacao/*.
// Padrão: auth → org → módulo/feature habilitado → permission. Org-scope é
// embutido nas queries Prisma (toda entidade nova tem orgId direto — não passa
// via `pipeline.orgId`). Este é o SEAM ÚNICO de gating do módulo locação:
// 28 das 29 rotas /api/locacao/* passam por aqui (exceção: form público por token).

export interface RouteContext {
  userId: string;
  orgId: string;
  permissions: Awaited<ReturnType<typeof getEffectivePermissions>>;
}

export type RouteResult = RouteContext | NextResponse;

/**
 * Garante session + org ativa + permission concreta. Retorna ou um contexto
 * pronto pra usar, ou uma `NextResponse` de erro (401/403/404) já pronta.
 */
export async function ensureLocacaoAccess(
  permission: PermissionKey,
  feature?: FeatureKey
): Promise<RouteResult> {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const org = await getUserOrg(session.user.id);
  if (!org) {
    return NextResponse.json({ error: "Sem organização ativa" }, { status: 404 });
  }
  // Gating de módulo/sub-função por tenant. Sub-função (feature) implica módulo.
  // `feature` explícito tem prioridade; senão deriva da permission (PERMISSION_FEATURE);
  // sem mapeamento, gateia só no nível do módulo.
  const effectiveFeature = feature ?? PERMISSION_FEATURE[permission];
  try {
    if (effectiveFeature) {
      await assertFeatureEnabled(org.id, effectiveFeature);
    } else {
      await assertModuleEnabled(org.id, MODULE.LOCACAO);
    }
  } catch (e) {
    if (e instanceof ModuleDisabledError) {
      return NextResponse.json({ error: e.code }, { status: e.status });
    }
    throw e;
  }
  // Id efetivo (owner impersonado sob "testar como"; senão o próprio usuário).
  const effUserId = await getEffectiveUserId(session.user.id);
  const permissions = await getEffectivePermissions(effUserId, org.id);
  if (!permissions || !can(permissions, permission)) {
    return NextResponse.json(
      { error: `Sem permissão (${permission})` },
      { status: 403 }
    );
  }
  return { userId: effUserId, orgId: org.id, permissions };
}

export function isRouteError(r: RouteResult): r is NextResponse {
  return r instanceof NextResponse;
}

/**
 * Parser Zod uniforme que retorna 422 com `.flatten()` em caso de erro.
 * Compatível com schemas que aplicam `.transform()` (que mudam o tipo de saída).
 */
export async function parseJsonBody<T>(
  req: NextRequest,
  schema: { safeParse: (input: unknown) => { success: true; data: T } | { success: false; error: { flatten(): unknown } } }
): Promise<{ ok: true; data: T } | { ok: false; response: NextResponse }> {
  try {
    const body = await req.json();
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return {
        ok: false,
        response: NextResponse.json(
          { error: "Validation failed", details: parsed.error.flatten() },
          { status: 422 }
        ),
      };
    }
    return { ok: true, data: parsed.data };
  } catch {
    return {
      ok: false,
      response: NextResponse.json({ error: "Invalid JSON" }, { status: 400 }),
    };
  }
}
