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
import { leaseClientCreateSchema } from "@/lib/locacao/validators";

export const dynamic = "force-dynamic";

/**
 * GET /api/locacao/clients?q=
 *
 * Lista clientes/prospects de locação da org. `?q=` filtra por nome/cpf/phone
 * (usado pelo picker "Importar cadastrado" e pela busca). Inclui quem cadastrou
 * e um resumo das análises (Serasa + fiança por seguradora) pra badge.
 */
export async function GET(req: NextRequest) {
  const ctx = await ensureLocacaoApiAccess(req, PERMISSION.CLIENT_VIEW, { scope: "locacao:r" });
  if (isRouteError(ctx)) return ctx;

  const q = new URL(req.url).searchParams.get("q")?.trim() ?? "";
  const insensitive = "insensitive" as const;

  const clients = await prisma.leaseClient.findMany({
    where: {
      orgId: ctx.orgId,
      ...(q.length >= 2
        ? {
            OR: [
              { nome: { contains: q, mode: insensitive } },
              { cpfCnpj: { contains: q, mode: insensitive } },
              { phone: { contains: q, mode: insensitive } },
              { email: { contains: q, mode: insensitive } },
            ],
          }
        : {}),
    },
    include: {
      createdBy: { select: { id: true, name: true, email: true } },
      insurerAnalyses: { select: { id: true, seguradora: true, status: true } },
      certidaoJobs: {
        where: { provider: "serasa" },
        select: { status: true, resultData: true },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 500,
  });

  return NextResponse.json({ clients });
}

/**
 * POST /api/locacao/clients — cadastra um cliente. Todos os campos (menos nome)
 * são opcionais. `createdByUserId` = usuário efetivo (impersonation-aware).
 */
export async function POST(req: NextRequest) {
  const ctx = await ensureLocacaoAccess(PERMISSION.CLIENT_CREATE);
  if (isRouteError(ctx)) return ctx;

  const parsed = await parseJsonBody(req, leaseClientCreateSchema);
  if (!parsed.ok) return parsed.response;

  const { email, ...rest } = parsed.data;
  const client = await prisma.leaseClient.create({
    data: {
      ...rest,
      email: email || null,
      orgId: ctx.orgId,
      createdByUserId: ctx.userId,
    },
  });

  await audit(
    { orgId: ctx.orgId, userId: ctx.userId },
    {
      action: parsed.data.source === "crm" ? "CLIENT_IMPORT" : "CLIENT_CREATE",
      result: "SUCCESS",
      resource: client.id,
      resourceType: "LeaseClient",
    }
  );

  return NextResponse.json({ client }, { status: 201 });
}
