import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/auth";
import { requirePlatform } from "@/lib/admin/gate";
import { resolveSupportOrgId } from "@/lib/support/org";
import { seedSupportKb } from "@/lib/support/seed";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

// Semeia a base padrão (FAQ + mapa de telas) RODANDO DENTRO DO DEPLOY — usa o
// banco/org/env deste ambiente, então não depende de env local (que já mirou o
// banco errado uma vez). Idempotente (delete-by-source). super_admin.
export async function POST() {
  const session = await auth();
  const g = await requirePlatform(session?.user?.id, "super_admin");
  if (!g.ok) return g.res;

  const orgId = await resolveSupportOrgId();
  const { created } = await seedSupportKb(orgId, { createdBy: session!.user!.id });

  return NextResponse.json({ ok: true, orgId, created });
}
