import { NextResponse } from "next/server";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { getEffectiveUserId } from "@/lib/auth/impersonation";
import { prisma } from "@/lib/db/prisma";

/**
 * Gate das configurações Ficha Certa da org — só owner/admin, mesmo padrão de
 * lib/clicksign/settings-guard.ts. Respeita impersonation via getEffectiveUserId.
 */
export type FichaCertaAdminCtx = { orgId: string; userId: string };

export async function requireFichaCertaAdmin(): Promise<
  { ok: true; ctx: FichaCertaAdminCtx } | { ok: false; response: NextResponse }
> {
  const session = await auth();
  if (!session?.user) {
    return { ok: false, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  const org = await getUserOrg(session.user.id);
  if (!org) {
    return { ok: false, response: NextResponse.json({ error: "No organization" }, { status: 400 }) };
  }
  const effUserId = await getEffectiveUserId(session.user.id);
  const membership = await prisma.orgMembership.findFirst({
    where: { userId: effUserId, orgId: org.id },
    select: { role: true },
  });
  if (!membership || !["owner", "admin"].includes(membership.role)) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Apenas owner/admin podem configurar a Ficha Certa." },
        { status: 403 }
      ),
    };
  }
  return { ok: true, ctx: { orgId: org.id, userId: effUserId } };
}
