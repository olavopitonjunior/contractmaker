import { NextRequest, NextResponse } from "next/server";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { getEffectivePermissions, can } from "@/lib/security/rbac/check";
import { PermissionKey } from "@/lib/security/rbac/permissions";

// Helpers compartilhados pelos endpoints /api/locacao/*.
// Padrão: auth → org → permission. Org-scope é embutido nas queries Prisma
// (toda entidade nova tem orgId direto — não passa via `pipeline.orgId`).

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
  permission: PermissionKey
): Promise<RouteResult> {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const org = await getUserOrg(session.user.id);
  if (!org) {
    return NextResponse.json({ error: "Sem organização ativa" }, { status: 404 });
  }
  const permissions = await getEffectivePermissions(session.user.id, org.id);
  if (!permissions || !can(permissions, permission)) {
    return NextResponse.json(
      { error: `Sem permissão (${permission})` },
      { status: 403 }
    );
  }
  return { userId: session.user.id, orgId: org.id, permissions };
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
