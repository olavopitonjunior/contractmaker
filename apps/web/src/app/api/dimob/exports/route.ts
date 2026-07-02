import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/context";
import { prisma } from "@/lib/db/prisma";
import {
  requirePermission,
  PermissionDeniedError,
  MembershipRequiredError,
} from "@/lib/security/rbac/guard";
import { PERMISSION } from "@/lib/security/rbac/permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/dimob/exports?year=YYYY
 * Histórico de arquivos DIMOB gerados pela org (mais recentes primeiro).
 * `year` opcional filtra por ano-calendário. Cada item traz `fileUrl` p/ re-download.
 */
export async function GET(req: NextRequest) {
  const authResult = await requireAuth(req);
  if (!authResult.ok) return authResult.response;
  const { ctx } = authResult;
  try {
    await requirePermission({
      userId: ctx.userId,
      orgId: ctx.orgId,
      permission: PERMISSION.REPORT_VIEW,
    });
  } catch (err) {
    if (err instanceof PermissionDeniedError || err instanceof MembershipRequiredError) {
      return NextResponse.json({ error: err.code }, { status: err.status });
    }
    throw err;
  }

  const yearRaw = Number(new URL(req.url).searchParams.get("year"));
  const year = Number.isInteger(yearRaw) && yearRaw >= 2000 && yearRaw <= 2100 ? yearRaw : undefined;

  const exports = await prisma.dimobExport.findMany({
    where: { orgId: ctx.orgId, ...(year ? { year } : {}) },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true,
      year: true,
      recordCount: true,
      totalOperacoes: true,
      totalComissao: true,
      contentHash: true,
      fileUrl: true,
      retificadora: true,
      numeroRecibo: true,
      createdAt: true,
      generatedByUserId: true,
    },
  });

  // Resolve nomes de quem gerou (best-effort).
  const userIds = [...new Set(exports.map((e) => e.generatedByUserId).filter(Boolean) as string[])];
  const users = userIds.length
    ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, email: true } })
    : [];
  const nameById = new Map(users.map((u) => [u.id, u.name || u.email || "—"]));

  return NextResponse.json({
    exports: exports.map((e) => ({
      ...e,
      generatedByName: e.generatedByUserId ? nameById.get(e.generatedByUserId) ?? null : null,
    })),
  });
}
