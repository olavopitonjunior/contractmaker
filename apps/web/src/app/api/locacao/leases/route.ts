import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { PERMISSION } from "@/lib/security/rbac/permissions";
import {
  ensureLocacaoApiAccess,
  isRouteError,
} from "@/lib/locacao/route-helpers";

const querySchema = z.object({
  status: z.string().optional(), // rascunho|assinatura|ativo|renovacao|rescisao|encerrado
  propertyId: z.string().optional(),
  // Busca por locatário: nome (contains) ou CPF/CNPJ (só dígitos).
  tenant: z.string().min(2).max(120).optional(),
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

/**
 * GET /api/locacao/leases — listagem de contratos de locação da org.
 * Session (UI) ou Bearer `locacao:r` (Max consulta a carteira antes de
 * analisar crédito/fiança). Payload enxuto: sem dataJson nem repasseSplitJson.
 */
export async function GET(req: NextRequest) {
  const ctx = await ensureLocacaoApiAccess(req, PERMISSION.LEASE_VIEW, {
    scope: "locacao:r",
  });
  if (isRouteError(ctx)) return ctx;

  const parsed = querySchema.safeParse(
    Object.fromEntries(new URL(req.url).searchParams)
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Query inválida", issues: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const q = parsed.data;

  const tenantDigits = q.tenant?.replace(/\D/g, "") ?? "";
  const where = {
    orgId: ctx.orgId,
    ...(q.status ? { status: q.status } : {}),
    ...(q.propertyId ? { propertyId: q.propertyId } : {}),
    ...(q.tenant
      ? {
          tenants: {
            some: {
              tenant:
                tenantDigits.length >= 11
                  ? { cpfCnpj: { contains: tenantDigits } }
                  : { nome: { contains: q.tenant, mode: "insensitive" as const } },
            },
          },
        }
      : {}),
  };

  const [total, rows] = await Promise.all([
    prisma.leaseContract.count({ where }),
    prisma.leaseContract.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: q.offset,
      take: q.limit,
      select: {
        id: true,
        status: true,
        finalidade: true,
        valorAluguel: true,
        valorEncargos: true,
        diaVencimento: true,
        indiceReajuste: true,
        vigenciaInicio: true,
        vigenciaFim: true,
        dataProximoReajuste: true,
        dealId: true,
        contractId: true,
        createdAt: true,
        property: {
          select: {
            id: true,
            kind: true,
            status: true,
            rua: true,
            numero: true,
            bairro: true,
            cidade: true,
            uf: true,
            cep: true,
          },
        },
        tenants: {
          select: {
            tipo: true,
            tenant: {
              select: { id: true, nome: true, tipoPessoa: true, email: true },
            },
          },
        },
        guarantee: { select: { id: true, tipo: true, status: true } },
      },
    }),
  ]);

  return NextResponse.json({ total, offset: q.offset, limit: q.limit, leases: rows });
}
