import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { audit } from "@/lib/security/audit";
import { PERMISSION } from "@/lib/security/rbac/permissions";
import { ensureLocacaoApiAccess, isRouteError, parseJsonBody } from "@/lib/locacao/route-helpers";
import {
  insurerAnalysisCreateSchema,
  insurerAnalysisUpdateSchema,
} from "@/lib/locacao/validators";

export const dynamic = "force-dynamic";

async function assertClient(id: string, orgId: string) {
  const client = await prisma.leaseClient.findUnique({ where: { id } });
  return client && client.orgId === orgId ? client : null;
}

/** GET — lista as análises de fiança por seguradora do cliente. */
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const ctx = await ensureLocacaoApiAccess(req, PERMISSION.CLIENT_VIEW, { scope: "locacao:r" });
  if (isRouteError(ctx)) return ctx;
  if (!(await assertClient(params.id, ctx.orgId))) {
    return NextResponse.json({ error: "Não encontrado" }, { status: 404 });
  }
  const analyses = await prisma.leaseClientInsurerAnalysis.findMany({
    where: { leaseClientId: params.id },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ analyses });
}

/** POST — adiciona uma seguradora à análise do cliente (status manual). */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const ctx = await ensureLocacaoApiAccess(req, PERMISSION.CLIENT_UPDATE, { scope: "locacao:rw" });
  if (isRouteError(ctx)) return ctx;
  if (!(await assertClient(params.id, ctx.orgId))) {
    return NextResponse.json({ error: "Não encontrado" }, { status: 404 });
  }

  const parsed = await parseJsonBody(req, insurerAnalysisCreateSchema);
  if (!parsed.ok) return parsed.response;

  const analysis = await prisma.leaseClientInsurerAnalysis.create({
    data: {
      ...parsed.data,
      orgId: ctx.orgId,
      leaseClientId: params.id,
      createdByUserId: ctx.userId,
    },
  });

  await audit(
    { orgId: ctx.orgId, userId: ctx.userId },
    {
      action: "CLIENT_INSURER_UPSERT",
      result: "SUCCESS",
      resource: analysis.id,
      resourceType: "LeaseClientInsurerAnalysis",
      metadata: { leaseClientId: params.id, seguradora: analysis.seguradora },
    }
  );

  return NextResponse.json({ analysis }, { status: 201 });
}

/** PATCH — atualiza status/dados de uma análise (body traz o `analysisId`). */
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const ctx = await ensureLocacaoApiAccess(req, PERMISSION.CLIENT_UPDATE, { scope: "locacao:rw" });
  if (isRouteError(ctx)) return ctx;
  if (!(await assertClient(params.id, ctx.orgId))) {
    return NextResponse.json({ error: "Não encontrado" }, { status: 404 });
  }

  const parsed = await parseJsonBody(
    req,
    insurerAnalysisUpdateSchema.extend({ analysisId: z.string().min(1) })
  );
  if (!parsed.ok) return parsed.response;
  const { analysisId, ...updates } = parsed.data;

  const existing = await prisma.leaseClientInsurerAnalysis.findUnique({
    where: { id: analysisId },
  });
  if (!existing || existing.leaseClientId !== params.id) {
    return NextResponse.json({ error: "Análise não encontrada" }, { status: 404 });
  }

  const analysis = await prisma.leaseClientInsurerAnalysis.update({
    where: { id: analysisId },
    data: updates,
  });

  await audit(
    { orgId: ctx.orgId, userId: ctx.userId },
    {
      action: "CLIENT_INSURER_UPSERT",
      result: "SUCCESS",
      resource: analysis.id,
      resourceType: "LeaseClientInsurerAnalysis",
      metadata: { leaseClientId: params.id, status: analysis.status },
    }
  );

  return NextResponse.json({ analysis });
}
