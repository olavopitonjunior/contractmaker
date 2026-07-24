import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { PERMISSION } from "@/lib/security/rbac/permissions";
import { audit } from "@/lib/security/audit";
import {
  ensureLocacaoAccess,
  ensureLocacaoApiAccess,
  isRouteError,
  parseJsonBody,
} from "@/lib/locacao/route-helpers";
import { leaseClientUpdateSchema } from "@/lib/locacao/validators";

export const dynamic = "force-dynamic";

/** Busca o cliente garantindo escopo da org. Retorna null se não existe/cross-org. */
async function findScoped(id: string, orgId: string) {
  const client = await prisma.leaseClient.findUnique({ where: { id } });
  if (!client || client.orgId !== orgId) return null;
  return client;
}

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const ctx = await ensureLocacaoApiAccess(req, PERMISSION.CLIENT_VIEW, { scope: "locacao:r" });
  if (isRouteError(ctx)) return ctx;

  const client = await prisma.leaseClient.findUnique({
    where: { id: params.id },
    include: {
      createdBy: { select: { id: true, name: true, email: true } },
      insurerAnalyses: { orderBy: { createdAt: "desc" } },
      attachments: { orderBy: { createdAt: "desc" } },
    },
  });
  if (!client || client.orgId !== ctx.orgId) {
    return NextResponse.json({ error: "Não encontrado" }, { status: 404 });
  }
  return NextResponse.json({ client });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const ctx = await ensureLocacaoAccess(PERMISSION.CLIENT_UPDATE);
  if (isRouteError(ctx)) return ctx;

  const existing = await findScoped(params.id, ctx.orgId);
  if (!existing) {
    return NextResponse.json({ error: "Não encontrado" }, { status: 404 });
  }

  const parsed = await parseJsonBody(req, leaseClientUpdateSchema);
  if (!parsed.ok) return parsed.response;

  const { email, ...rest } = parsed.data;
  const client = await prisma.leaseClient.update({
    where: { id: params.id },
    data: {
      ...rest,
      ...(email !== undefined ? { email: email || null } : {}),
    },
  });

  await audit(
    { orgId: ctx.orgId, userId: ctx.userId },
    {
      action: "CLIENT_UPDATE",
      result: "SUCCESS",
      resource: client.id,
      resourceType: "LeaseClient",
    }
  );

  return NextResponse.json({ client });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const ctx = await ensureLocacaoAccess(PERMISSION.CLIENT_UPDATE);
  if (isRouteError(ctx)) return ctx;

  const existing = await findScoped(params.id, ctx.orgId);
  if (!existing) {
    return NextResponse.json({ error: "Não encontrado" }, { status: 404 });
  }

  // Cascata: attachments + insurerAnalyses (onDelete Cascade).
  // CertidaoJob.leaseClientId vira null (onDelete SetNull) — jobs preservados.
  await prisma.leaseClient.delete({ where: { id: params.id } });

  await audit(
    { orgId: ctx.orgId, userId: ctx.userId },
    {
      action: "CLIENT_DELETE",
      result: "SUCCESS",
      resource: params.id,
      resourceType: "LeaseClient",
    }
  );

  return NextResponse.json({ ok: true });
}
