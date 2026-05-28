import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { PERMISSION } from "@/lib/security/rbac/permissions";
import { audit, type AuditAction } from "@/lib/security/audit";
import { ensureLocacaoAccess, isRouteError, parseJsonBody } from "@/lib/locacao/route-helpers";

export const dynamic = "force-dynamic";

interface Params {
  params: Promise<{ id: string }>;
}

const leasePatchSchema = z.object({
  status: z.enum(["rascunho", "assinatura", "ativo", "renovacao", "rescisao", "encerrado"]).optional(),
  valorAluguel: z.number().positive().optional(),
  valorEncargos: z.number().nonnegative().optional(),
  diaVencimento: z.number().int().min(1).max(31).optional(),
  vigenciaFim: z.coerce.date().optional(),
  metadata: z.any().optional(),
});

export async function PATCH(req: NextRequest, { params }: Params) {
  const ctx = await ensureLocacaoAccess(PERMISSION.LEASE_EDIT);
  if (isRouteError(ctx)) return ctx;
  const { id } = await params;

  const existing = await prisma.leaseContract.findFirst({
    where: { id, orgId: ctx.orgId },
    select: { id: true, status: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "Contrato não encontrado" }, { status: 404 });
  }

  const parsed = await parseJsonBody(req, leasePatchSchema);
  if (!parsed.ok) return parsed.response;

  // Status transitions exigem permissão específica.
  if (parsed.data.status === "rescisao") {
    const c = await ensureLocacaoAccess(PERMISSION.LEASE_TERMINATE);
    if (isRouteError(c)) return c;
  }
  if (parsed.data.status === "renovacao") {
    const c = await ensureLocacaoAccess(PERMISSION.LEASE_RENEW);
    if (isRouteError(c)) return c;
  }

  const { metadata, ...updateData } = parsed.data;
  const lease = await prisma.leaseContract.update({
    where: { id },
    data: updateData,
  });

  let action: AuditAction = "LEASE_UPDATE";
  if (parsed.data.status === "rescisao") action = "LEASE_TERMINATE";
  if (parsed.data.status === "renovacao") action = "LEASE_RENEW";

  await audit(
    { orgId: ctx.orgId, userId: ctx.userId },
    {
      action,
      result: "SUCCESS",
      resource: id,
      resourceType: "LeaseContract",
      metadata: metadata as Record<string, unknown> | undefined,
    }
  );

  return NextResponse.json({ lease });
}
