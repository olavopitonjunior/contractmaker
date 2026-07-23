import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import {
  requirePlatformRole,
  PlatformRoleRequiredError,
} from "@/lib/security/rbac/platform";
import { audit, extractAuditContextFromRequest } from "@/lib/security/audit";
import { syncOrgListings } from "@/lib/ilist/sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const bodySchema = z.object({ full: z.boolean().optional() });

/** POST { full? } — dispara sync da conexão da org. Gated super_admin. */
export async function POST(req: NextRequest, { params }: { params: { orgId: string } }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    await requirePlatformRole(session.user.id, "super_admin");
  } catch (err) {
    if (err instanceof PlatformRoleRequiredError) {
      return NextResponse.json({ error: err.code }, { status: err.status });
    }
    throw err;
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  const full = parsed.success ? (parsed.data.full ?? false) : false;

  const connection = await prisma.iListConnection.findUnique({ where: { orgId: params.orgId } });
  if (!connection) return NextResponse.json({ error: "Conexão não encontrada" }, { status: 404 });
  if (!connection.enabled) {
    return NextResponse.json({ error: "Conexão desabilitada" }, { status: 409 });
  }
  // Sem full nunca sincronizado → força full (primeiro sync reconcilia tudo).
  const effectiveFull = full || !connection.lastFullSyncAt;

  const result = await syncOrgListings(connection, { full: effectiveFull });

  await audit(extractAuditContextFromRequest(req, params.orgId, session.user.id), {
    action: "ILIST_SYNC_RUN",
    result: result.ok ? "SUCCESS" : "FAILURE",
    resourceType: "IListConnection",
    resource: connection.id,
    metadata: { full: effectiveFull, ...result },
  });

  return NextResponse.json(result, { status: result.ok ? 200 : 502 });
}
