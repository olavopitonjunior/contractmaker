import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/auth";
import {
  requirePlatformRole,
  PlatformRoleRequiredError,
} from "@/lib/security/rbac/platform";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/admin/platform/whoami
 *
 * Retorna a identidade de plataforma do chamador. Gated por `requirePlatformRole`
 * — exige pelo menos "support" (super_admin também passa). Primeira rota a
 * exercitar o guard de plataforma (Fase 0a). 401 se não autenticado, 403 se não
 * for staff de plataforma.
 */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const ctx = await requirePlatformRole(session.user.id, "support");
    return NextResponse.json({ ok: true, role: ctx.role, scope: ctx.scope });
  } catch (err) {
    if (err instanceof PlatformRoleRequiredError) {
      return NextResponse.json(
        { error: err.code, requiredRole: err.requiredRole },
        { status: err.status }
      );
    }
    throw err;
  }
}
