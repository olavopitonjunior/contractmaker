import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { PERMISSION } from "@/lib/security/rbac/permissions";
import { audit } from "@/lib/security/audit";
import { ensureLocacaoAccess, isRouteError, parseJsonBody } from "@/lib/locacao/route-helpers";

export const dynamic = "force-dynamic";

interface Params {
  params: Promise<{ id: string }>;
}

const clausulaSchema = z.object({
  titulo: z.string().min(2).max(200),
  conteudo: z.string().min(5).max(5000),
});

const replaceClausulasSchema = z.object({
  clausulas: z.array(clausulaSchema).max(50),
});

interface ClausulaAdicional {
  id: string;
  titulo: string;
  conteudo: string;
  criadaEm: string;
}

/**
 * GET /api/locacao/leases/[id]/clausulas
 * PUT /api/locacao/leases/[id]/clausulas { clausulas: [...] }
 *
 * Storage em LeaseContract.dataJson.clausulasAdicionais[] (sem schema novo).
 * Substitui o array inteiro (idempotente por client). Aparece no PDF espelho.
 */
export async function GET(_req: NextRequest, { params }: Params) {
  const ctx = await ensureLocacaoAccess(PERMISSION.LEASE_VIEW);
  if (isRouteError(ctx)) return ctx;
  const { id } = await params;

  const lease = await prisma.leaseContract.findFirst({
    where: { id, orgId: ctx.orgId },
    select: { dataJson: true },
  });
  if (!lease) return NextResponse.json({ error: "Contrato não encontrado" }, { status: 404 });

  const data = (lease.dataJson ?? {}) as { clausulasAdicionais?: ClausulaAdicional[] };
  return NextResponse.json({ clausulas: data.clausulasAdicionais ?? [] });
}

export async function PUT(req: NextRequest, { params }: Params) {
  const ctx = await ensureLocacaoAccess(PERMISSION.LEASE_EDIT);
  if (isRouteError(ctx)) return ctx;
  const { id } = await params;

  const lease = await prisma.leaseContract.findFirst({
    where: { id, orgId: ctx.orgId },
    select: { id: true, dataJson: true },
  });
  if (!lease) return NextResponse.json({ error: "Contrato não encontrado" }, { status: 404 });

  const parsed = await parseJsonBody(req, replaceClausulasSchema);
  if (!parsed.ok) return parsed.response;

  const existing = (lease.dataJson ?? {}) as Record<string, unknown>;
  const now = new Date().toISOString();
  const clausulas: ClausulaAdicional[] = parsed.data.clausulas.map((c, idx) => ({
    id: `cla_${Date.now()}_${idx}`,
    titulo: c.titulo,
    conteudo: c.conteudo,
    criadaEm: now,
  }));

  const newDataJson = { ...existing, clausulasAdicionais: clausulas };
  await prisma.leaseContract.update({
    where: { id },
    data: { dataJson: newDataJson as Record<string, unknown> as object },
  });

  await audit(
    { orgId: ctx.orgId, userId: ctx.userId },
    {
      action: "LEASE_UPDATE",
      result: "SUCCESS",
      resource: id,
      resourceType: "LeaseContract",
      metadata: { field: "clausulasAdicionais", count: clausulas.length },
    }
  );

  return NextResponse.json({ clausulas });
}
