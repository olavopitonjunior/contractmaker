import { prisma } from "@/lib/db/prisma";

// Scheduler de recorrência mensal de aluguel (docs/locacao/spec.md §6.1).
// Materializa um RentCharge por (LeaseContract ativo, competência), idempotente
// via @@unique([leaseContractId, competencia]). A EMISSÃO da cobrança Asaas
// (CommissionCharge{kind:"aluguel"}) é um passo separado — ver `emitPendingRentCharges`
// (seam marcado): exige Deal/conta/cliente Asaas e é validado em sandbox/QA.
//
// As funções de cálculo são PURAS e testadas isoladamente — o cron só orquestra.

/** Competência "YYYY-MM" de uma data (em horário local). */
export function competenciaFor(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

/**
 * Data de vencimento da competência, no dia `diaVencimento` (clampado ao
 * último dia do mês — ex.: dia 31 em fevereiro vira 28/29). Âncora ao meio-dia
 * local pra estabilizar timezone (UTC-3).
 */
export function dueDateFor(competencia: string, diaVencimento: number): Date {
  const [y, m] = competencia.split("-").map(Number);
  const lastDay = new Date(y, m, 0).getDate(); // dia 0 do mês seguinte = último do atual
  const dia = Math.min(Math.max(1, diaVencimento || 1), lastDay);
  return new Date(y, m - 1, dia, 12, 0, 0);
}

/** Valor base + encargos de um lease (centavos não — Float, como o resto do app). */
export function rentAmountFor(lease: { valorAluguel: number; valorEncargos: number }): {
  valorBase: number;
  encargos: number;
} {
  return {
    valorBase: Number(lease.valorAluguel) || 0,
    encargos: Number(lease.valorEncargos) || 0,
  };
}

export interface MaterializeResult {
  competencia: string;
  scanned: number;
  created: number;
  existing: number;
}

/**
 * Cria os RentCharge da competência para todos os LeaseContract ativos (ou de
 * uma org específica). Idempotente: usa upsert no índice único — re-rodar não
 * duplica. NÃO emite cobrança Asaas (status fica "pendente").
 */
export async function materializeRentChargesForCompetencia(
  competencia: string,
  opts: { orgId?: string; now?: Date } = {}
): Promise<MaterializeResult> {
  const leases = await prisma.leaseContract.findMany({
    where: { status: "ativo", ...(opts.orgId ? { orgId: opts.orgId } : {}) },
    select: {
      id: true,
      orgId: true,
      valorAluguel: true,
      valorEncargos: true,
      diaVencimento: true,
    },
  });

  let created = 0;
  let existing = 0;

  for (const lease of leases) {
    const { valorBase, encargos } = rentAmountFor(lease);
    const dueDate = dueDateFor(competencia, lease.diaVencimento);
    try {
      // Unique key inclui `kind` (Superlógica delta): permite RentCharge de
      // mesma competência com kinds distintos (aluguel + acordo + extra).
      const res = await prisma.rentCharge.upsert({
        where: {
          leaseContractId_competencia_kind: {
            leaseContractId: lease.id,
            competencia,
            kind: "aluguel",
          },
        },
        // update vazio: idempotente — uma vez criado, o scheduler não mexe
        // (régua/pagamento/ajustes ficam a cargo de outros fluxos).
        update: {},
        create: {
          orgId: lease.orgId,
          leaseContractId: lease.id,
          kind: "aluguel",
          competencia,
          dueDate,
          valorBase,
          encargos,
          status: "pendente",
        },
        select: { createdAt: true, updatedAt: true },
      });
      // createdAt === updatedAt no insert; em re-run o row preexistente bate.
      if (res.createdAt.getTime() === res.updatedAt.getTime()) created++;
      else existing++;
    } catch (err) {
      // Falha numa lease não derruba o lote.
      console.error(
        `[rent-scheduler] falha ao materializar RentCharge lease=${lease.id} comp=${competencia}:`,
        err
      );
    }
  }

  return { competencia, scanned: leases.length, created, existing };
}
