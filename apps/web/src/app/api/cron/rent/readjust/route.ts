import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import {
  calculateReadjustment,
  type Indice,
} from "@/lib/locacao/readjustment-calculator";
import { isCronAllowedInStaging } from "@/lib/env/staging";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/cron/rent/readjust
 *
 * Cron mensal (dia 1): pra cada LeaseContract ativo cuja `dataProximoReajuste`
 * cai neste mês, calcula o reajuste via índice do contrato e cria
 * LeaseReadjustment em status "proposto" (HITL — gestor aprova/recusa via UI).
 *
 * Idempotente: skip se já existe LeaseReadjustment "proposto" ou "aplicado"
 * pro mesmo contrato no mês.
 *
 * Schedule sugerido: `0 0 1 * *` (mensal dia 1). Adicionar em vercel.json.
 * Auth: CRON_SECRET Bearer.
 */
export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = req.headers.get("authorization");
    if (authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }
  if (!(await isCronAllowedInStaging("/api/cron/rent/readjust"))) {
    return NextResponse.json({ skipped: "staging-disabled", path: "/api/cron/rent/readjust" });
  }

  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const startOfNextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);

  const leases = await prisma.leaseContract.findMany({
    where: {
      status: "ativo",
      dataProximoReajuste: { gte: startOfMonth, lt: startOfNextMonth },
    },
    select: {
      id: true,
      orgId: true,
      valorAluguel: true,
      indiceReajuste: true,
    },
  });

  let created = 0;
  let skipped = 0;

  for (const lease of leases) {
    const existing = await prisma.leaseReadjustment.findFirst({
      where: {
        leaseContractId: lease.id,
        dataReajuste: { gte: startOfMonth, lt: startOfNextMonth },
        status: { in: ["proposto", "aprovado", "aplicado"] },
      },
      select: { id: true },
    });
    if (existing) {
      skipped++;
      continue;
    }

    const calc = calculateReadjustment(
      lease.valorAluguel,
      lease.indiceReajuste as Indice
    );
    await prisma.leaseReadjustment.create({
      data: {
        orgId: lease.orgId,
        leaseContractId: lease.id,
        dataReajuste: now,
        indice: calc.indice,
        percentualAplicado: calc.percentualAplicado,
        valorAnterior: calc.valorAnterior,
        valorNovo: calc.valorNovo,
        observacao: "Proposta gerada automaticamente pelo cron mensal",
        status: "proposto",
      },
    });
    created++;
  }

  return NextResponse.json({
    scanned: leases.length,
    created,
    skipped,
    timestamp: now.toISOString(),
  });
}
