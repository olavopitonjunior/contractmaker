import { NextResponse } from "next/server";
import {
  requirePlatformRole,
  PlatformRoleRequiredError,
  type PlatformRoleName,
  type PlatformContext,
} from "@/lib/security/rbac/platform";

/**
 * Gate de plataforma reutilizável para os handlers de /api/admin/*.
 * Retorna `{ ok: true, ctx }` quando o user satisfaz a role, ou
 * `{ ok: false, res }` com a NextResponse de erro (401/403) já pronta.
 *
 * Uso:
 *   const g = await requirePlatform(session?.user?.id, "super_admin");
 *   if (!g.ok) return g.res;
 *   // g.ctx disponível
 */
export async function requirePlatform(
  userId: string | undefined | null,
  role: PlatformRoleName
): Promise<{ ok: true; ctx: PlatformContext } | { ok: false; res: NextResponse }> {
  if (!userId) {
    return { ok: false, res: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  try {
    const ctx = await requirePlatformRole(userId, role);
    return { ok: true, ctx };
  } catch (err) {
    if (err instanceof PlatformRoleRequiredError) {
      return {
        ok: false,
        res: NextResponse.json(
          { error: err.code, requiredRole: err.requiredRole },
          { status: err.status }
        ),
      };
    }
    throw err;
  }
}
