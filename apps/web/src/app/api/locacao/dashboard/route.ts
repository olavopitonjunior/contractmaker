import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { PERMISSION } from "@/lib/security/rbac/permissions";
import { ensureLocacaoAccess, isRouteError } from "@/lib/locacao/route-helpers";
import { competenciaFor } from "@/lib/locacao/rent-scheduler";

export const dynamic = "force-dynamic";

/**
 * GET /api/locacao/dashboard
 *
 * Agregação dos 10 cards do dashboard operacional de Locação (docs/locacao/spec.md §17.5).
 * Espelha o resumo do Superlógica §3. Todas as queries filtradas por orgId.
 * Cacheável 60s (Upstash) — pra Fase 1, sem cache (queries simples sob 100k contratos).
 */
export async function GET() {
  const ctx = await ensureLocacaoAccess(PERMISSION.LEASE_VIEW);
  if (isRouteError(ctx)) return ctx;

  const now = new Date();
  const competencia = competenciaFor(now);
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const startOfNextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const sixtyDaysFromNow = new Date(now.getTime() + 60 * 24 * 60 * 60_000);

  // Cards em paralelo.
  const [
    rentChargesMonth,
    rentChargesPaid,
    rentChargesPending,
    rentChargesLate,
    guaranteesExpiringMonth,
    guaranteesExpiring60d,
    leaseContractsWithoutGuarantee,
    insuranceExpiringMonth,
    insuranceExpired,
    insuranceExpiring60d,
    leaseContractsSummary,
    checklistsPending,
    leasesToReadjust,
    leasesExpiringThisMonth,
    repassesToRealize,
    repassesOverdue,
    expensesDueToday,
    expensesOverdue,
    repasseGarantidoActive,
  ] = await Promise.all([
    prisma.rentCharge.count({ where: { orgId: ctx.orgId, competencia } }),
    prisma.rentCharge.count({ where: { orgId: ctx.orgId, competencia, status: "paga" } }),
    prisma.rentCharge.count({
      where: { orgId: ctx.orgId, competencia, status: { in: ["pendente", "emitida"] } },
    }),
    prisma.rentCharge.count({
      where: { orgId: ctx.orgId, competencia, status: "atrasada" },
    }),

    prisma.guarantee.count({
      where: {
        orgId: ctx.orgId,
        status: "ativa",
        leaseContract: { vigenciaFim: { gte: startOfMonth, lt: startOfNextMonth } },
      },
    }),
    prisma.guarantee.count({
      where: {
        orgId: ctx.orgId,
        status: "ativa",
        leaseContract: { vigenciaFim: { lte: sixtyDaysFromNow, gte: now } },
      },
    }),
    prisma.leaseContract.count({
      where: { orgId: ctx.orgId, status: "ativo", guarantee: null },
    }),

    prisma.insurancePolicy.count({
      where: {
        orgId: ctx.orgId,
        status: "ativa",
        vigenciaFim: { gte: startOfMonth, lt: startOfNextMonth },
      },
    }),
    prisma.insurancePolicy.count({
      where: { orgId: ctx.orgId, vigenciaFim: { lt: now }, status: { not: "cancelada" } },
    }),
    prisma.insurancePolicy.count({
      where: { orgId: ctx.orgId, status: "ativa", vigenciaFim: { lte: sixtyDaysFromNow, gte: now } },
    }),

    prisma.leaseContract.findMany({
      where: { orgId: ctx.orgId, status: "ativo" },
      select: { valorAluguel: true, taxaAdminPercent: true },
    }),

    prisma.checklist.count({
      where: { orgId: ctx.orgId, status: { in: ["pendente", "aguardando_aprovacao"] } },
    }),

    prisma.leaseContract.count({
      where: { orgId: ctx.orgId, status: "ativo" /* dataProximoReajuste no spec — Fase 1 sem campo */ },
    }),
    prisma.leaseContract.count({
      where: {
        orgId: ctx.orgId,
        status: "ativo",
        vigenciaFim: { gte: startOfMonth, lt: startOfNextMonth },
      },
    }),

    prisma.rentCharge.count({
      where: {
        orgId: ctx.orgId,
        status: "paga",
        repasseTransferId: null,
        paidAt: { gte: startOfMonth, lt: startOfNextMonth },
      },
    }),
    prisma.rentCharge.count({
      where: { orgId: ctx.orgId, status: "paga", repasseTransferId: null, paidAt: { lt: startOfMonth } },
    }),

    prisma.expense.count({
      where: { orgId: ctx.orgId, status: "pendente", dueDate: { lte: now, gte: new Date(now.getFullYear(), now.getMonth(), now.getDate()) } },
    }),
    prisma.expense.count({
      where: { orgId: ctx.orgId, status: "pendente", dueDate: { lt: new Date(now.getFullYear(), now.getMonth(), now.getDate()) } },
    }),

    prisma.leaseContract.count({
      where: { orgId: ctx.orgId, status: "ativo", repasseGarantido: { not: "nao" } },
    }),
  ]);

  // Taxa adm: média + total mensal.
  const totalLeases = leaseContractsSummary.length;
  let taxaAdmTotal = 0;
  for (const lc of leaseContractsSummary) {
    taxaAdmTotal += (lc.valorAluguel * lc.taxaAdminPercent) / 100;
  }
  const taxaAdmMedia = totalLeases > 0 ? taxaAdmTotal / totalLeases : 0;

  return NextResponse.json({
    competencia,
    cobrancas: {
      total: rentChargesMonth,
      pagas: rentChargesPaid,
      pendentes: rentChargesPending,
      atrasadas: rentChargesLate,
      percentRecebido: rentChargesMonth > 0 ? (rentChargesPaid / rentChargesMonth) * 100 : 0,
    },
    garantias: {
      vencendoMes: guaranteesExpiringMonth,
      vencendo60d: guaranteesExpiring60d,
      semGarantia: leaseContractsWithoutGuarantee,
    },
    seguros: {
      vencendoMes: insuranceExpiringMonth,
      vencidos: insuranceExpired,
      vencendo60d: insuranceExpiring60d,
    },
    taxaAdm: {
      total: taxaAdmTotal,
      media: taxaAdmMedia,
      contratosAtivos: totalLeases,
    },
    checklistsPendentes: checklistsPending,
    leasesToReadjust,
    leasesExpiringThisMonth,
    repasses: {
      aRealizar: repassesToRealize,
      atrasados: repassesOverdue,
    },
    despesas: {
      hoje: expensesDueToday,
      atrasadas: expensesOverdue,
    },
    repasseGarantido: repasseGarantidoActive,
  });
}
