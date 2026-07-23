import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import {
  requirePlatformRole,
  PlatformRoleRequiredError,
} from "@/lib/security/rbac/platform";
import { audit, extractAuditContextFromRequest } from "@/lib/security/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function gate(userId: string) {
  try {
    await requirePlatformRole(userId, "super_admin");
    return null;
  } catch (err) {
    if (err instanceof PlatformRoleRequiredError) {
      return NextResponse.json({ error: err.code }, { status: err.status });
    }
    throw err;
  }
}

/** GET — conexão iList da org + contagens do espelho. Gated super_admin. */
export async function GET(_req: NextRequest, { params }: { params: { orgId: string } }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const denied = await gate(session.user.id);
  if (denied) return denied;

  const connection = await prisma.iListConnection.findUnique({ where: { orgId: params.orgId } });
  if (!connection) return NextResponse.json({ connection: null });

  const [total, ativos] = await Promise.all([
    prisma.iListListing.count({ where: { connectionId: connection.id, deletedAt: null } }),
    prisma.iListListing.count({
      where: { connectionId: connection.id, deletedAt: null, listingStatus: 160 },
    }),
  ]);
  return NextResponse.json({ connection, counts: { total, ativos } });
}

const putSchema = z.object({
  regionId: z.number().int().positive(),
  officeIds: z.array(z.number().int().positive()).min(1).max(50),
  enabled: z.boolean().optional(),
});

/**
 * PUT — cria/atualiza a conexão. Trocar região ou remover offices apaga os
 * listings que saíram do escopo e reseta o cursor (força full sync).
 */
export async function PUT(req: NextRequest, { params }: { params: { orgId: string } }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const denied = await gate(session.user.id);
  if (denied) return denied;

  const org = await prisma.organization.findUnique({
    where: { id: params.orgId },
    select: { id: true },
  });
  if (!org) return NextResponse.json({ error: "Org não encontrada" }, { status: 404 });

  const parsed = putSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validação falhou", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const { regionId, officeIds, enabled } = parsed.data;

  const existing = await prisma.iListConnection.findUnique({ where: { orgId: params.orgId } });
  const regionChanged = existing !== null && existing.regionId !== regionId;
  const removedOffices = existing
    ? existing.officeIds.filter((o) => !officeIds.includes(o))
    : [];

  const connection = await prisma.iListConnection.upsert({
    where: { orgId: params.orgId },
    create: { orgId: params.orgId, regionId, officeIds, enabled: enabled ?? true },
    update: {
      regionId,
      officeIds,
      ...(typeof enabled === "boolean" ? { enabled } : {}),
      // Mudança de escopo invalida o delta — força full na próxima sync.
      ...(regionChanged ? { lastCursor: null, lastFullSyncAt: null, syncStatus: "pending" } : {}),
    },
  });

  if (regionChanged) {
    await prisma.iListListing.deleteMany({ where: { connectionId: connection.id } });
  } else if (removedOffices.length) {
    await prisma.iListListing.deleteMany({
      where: { connectionId: connection.id, officeId: { in: removedOffices } },
    });
  }

  await audit(extractAuditContextFromRequest(req, params.orgId, session.user.id), {
    action: "ILIST_CONNECTION_UPDATED",
    result: "SUCCESS",
    resourceType: "IListConnection",
    resource: connection.id,
    metadata: { regionId, officeIds, enabled: connection.enabled, regionChanged },
  });

  return NextResponse.json({ ok: true, connection });
}

/** DELETE — remove a conexão; cascade apaga o espelho (LGPD-friendly). */
export async function DELETE(req: NextRequest, { params }: { params: { orgId: string } }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const denied = await gate(session.user.id);
  if (denied) return denied;

  const existing = await prisma.iListConnection.findUnique({ where: { orgId: params.orgId } });
  if (!existing) return NextResponse.json({ error: "Conexão não encontrada" }, { status: 404 });

  await prisma.iListConnection.delete({ where: { id: existing.id } });

  await audit(extractAuditContextFromRequest(req, params.orgId, session.user.id), {
    action: "ILIST_CONNECTION_REMOVED",
    result: "SUCCESS",
    resourceType: "IListConnection",
    resource: existing.id,
    metadata: { regionId: existing.regionId, officeIds: existing.officeIds },
  });

  return NextResponse.json({ ok: true });
}
