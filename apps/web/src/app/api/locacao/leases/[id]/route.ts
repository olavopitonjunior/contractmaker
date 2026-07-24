import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { PERMISSION } from "@/lib/security/rbac/permissions";
import { audit, type AuditAction } from "@/lib/security/audit";
import {
  ensureLocacaoAccess,
  ensureLocacaoApiAccess,
  isRouteError,
  parseJsonBody,
} from "@/lib/locacao/route-helpers";
import { materializeLeaseParties } from "@/lib/locacao/materialize-parties";

export const dynamic = "force-dynamic";

interface Params {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/locacao/leases/:id — detalhe do contrato de locação. Session (UI)
 * ou Bearer `locacao:r` (Max). Sem repasseSplitJson (dados bancários de
 * terceiros não saem pra M2M de leitura).
 */
export async function GET(req: NextRequest, { params }: Params) {
  const ctx = await ensureLocacaoApiAccess(req, PERMISSION.LEASE_VIEW, {
    scope: "locacao:r",
  });
  if (isRouteError(ctx)) return ctx;
  const { id } = await params;

  const lease = await prisma.leaseContract.findFirst({
    where: { id, orgId: ctx.orgId },
    include: {
      property: {
        select: {
          id: true,
          kind: true,
          status: true,
          rua: true,
          numero: true,
          complemento: true,
          bairro: true,
          cidade: true,
          uf: true,
          cep: true,
          matricula: true,
        },
      },
      tenants: {
        select: {
          tipo: true,
          tenant: {
            select: {
              id: true,
              nome: true,
              tipoPessoa: true,
              cpfCnpj: true,
              email: true,
              phone: true,
            },
          },
        },
      },
      // SELECT explícito: dadosJson (dados bancários de caução),
      // fiadorPartyJson (CPF/RG/renda do fiador) e historicoJson NÃO saem
      // pra M2M — mesma regra do repasseSplitJson no nível do lease.
      guarantee: {
        select: {
          id: true,
          tipo: true,
          caucaoSubtipo: true,
          status: true,
          provider: true,
          coberturaMeses: true,
          custoJson: true,
          externalRef: true,
          createdAt: true,
        },
      },
      insurancePolicies: {
        select: {
          id: true,
          tipo: true,
          seguradora: true,
          status: true,
          vigenciaInicio: true,
          vigenciaFim: true,
          premioMensal: true,
        },
      },
    },
  });
  if (!lease) {
    return NextResponse.json({ error: "Contrato não encontrado" }, { status: 404 });
  }

  const { repasseSplitJson: _split, dataJson: _data, ...safe } = lease;
  return NextResponse.json({ lease: safe });
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
    select: { id: true, status: true, propertyId: true },
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

  // "Criar administração": ao ativar (rascunho→ativo), normaliza as partes do
  // dataJson em PropertyOwner/Tenant/joins e marca o imóvel como locado. Tudo
  // numa transação — se a materialização falhar, a ativação não acontece pela
  // metade.
  const activating = existing.status !== "ativo" && updateData.status === "ativo";
  let lease;
  if (activating) {
    lease = await prisma.$transaction(async (tx) => {
      await materializeLeaseParties({ orgId: ctx.orgId, leaseContractId: id }, tx);
      if (existing.propertyId) {
        await tx.property.update({
          where: { id: existing.propertyId },
          data: { status: "locado" },
        });
      }
      return tx.leaseContract.update({ where: { id }, data: updateData });
    });
  } else {
    lease = await prisma.leaseContract.update({ where: { id }, data: updateData });
  }

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
