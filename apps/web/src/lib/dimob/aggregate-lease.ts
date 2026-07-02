/**
 * Agregação de LOCAÇÃO para a DIMOB (registro R02 — aluguéis mês a mês).
 *
 * Produz um `DimobLeaseRecord` por lease×locador (unidade de UI/override/exclusão,
 * igual ao Superlógica que gerencia por contrato). O colapso por LOCADOR (FAQ p71/72)
 * acontece só na serialização (build-file).
 *
 * Regras:
 *   - Aluguel RECEBIDO = `RentCharge` kind="aluguel", status∈{paga,repassada}, bucket
 *     pelo **mês do `paidAt`** (regime de caixa).
 *   - Rendimento bruto do mês = valorBase + encargos (rateado por `ownership.percentual`).
 *   - Comissão do declarante = taxaAdminPercent% × valorBase (rateado).
 *   - IRRF = tabela progressiva (só regimeIr="retem_imobiliaria" e locador PF) — `irrf.ts`.
 *
 * Só o carregamento inicial toca o banco; a construção dos registros é pura.
 */

import { prisma } from "@/lib/db/prisma";
import { computeMonthlyIrrf } from "./irrf";

export interface DimobLeaseMonth {
  rendimento: number;
  comissao: number;
  imposto: number;
}

export interface DimobLeaseRecord {
  recordId: string; // `lease:{leaseId}:{ownerIdx}`
  leaseId: string;
  ownerId: string;
  locador: { nome: string; cpfCnpj: string; tipoPessoa: string };
  locatario: { nome: string; cpfCnpj: string };
  numeroContrato: string | null;
  dataContrato: string | null;
  meses: DimobLeaseMonth[]; // 12 (índice 0 = janeiro)
  totalRendimento: number;
  imovel: {
    endereco: string | null;
    cep: string | null;
    uf: string | null;
    tipoImovel: "urbano" | "rural" | null;
  };
}

export interface DimobLeaseAggregate {
  year: number;
  records: DimobLeaseRecord[];
  excluded: DimobLeaseRecord[];
}

function digits(s: string | null | undefined): string {
  return (s ?? "").replace(/\D/g, "");
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Shape mínimo de um lease carregado (o que `buildLeaseRecords` consome). */
export interface LeaseInput {
  id: string;
  taxaAdminPercent: number;
  regimeIr: string;
  vigenciaInicio: Date | null;
  dataJson: unknown;
  property: {
    rua: string | null;
    numero: string | null;
    bairro: string | null;
    uf: string | null;
    cep: string | null;
    tipoDimob: string | null;
    ownerships: Array<{
      percentual: number;
      tipo: string;
      owner: { id: string; nome: string; cpfCnpj: string; tipoPessoa: string };
    }>;
  };
  tenants: Array<{ tipo: string; tenant: { nome: string; cpfCnpj: string } }>;
  rentCharges: Array<{ valorBase: number; encargos: number; paidAt: Date | null }>;
}

/**
 * Constrói os registros R02 (um por locador) de UM lease. Puro/testável.
 * Retorna [] quando o lease não teve aluguel recebido no ano.
 */
export function buildLeaseRecords(lease: LeaseInput, year: number): DimobLeaseRecord[] {
  // Buckets do LEASE por mês (0..11): rendimento (base+encargos) e base (p/ comissão/IRRF).
  const leaseRendimento = new Array(12).fill(0);
  const leaseBase = new Array(12).fill(0);
  for (const c of lease.rentCharges) {
    if (!c.paidAt) continue;
    if (c.paidAt.getUTCFullYear() !== year) continue;
    const m = c.paidAt.getUTCMonth();
    leaseRendimento[m] += (c.valorBase ?? 0) + (c.encargos ?? 0);
    leaseBase[m] += c.valorBase ?? 0;
  }
  const totalLease = leaseRendimento.reduce((a, b) => a + b, 0);
  if (totalLease <= 0) return []; // sem movimento no ano

  const taxa = (lease.taxaAdminPercent ?? 0) / 100;
  const numeroContrato =
    digits(
      String(
        (lease.dataJson as { comissao?: { numero_contrato?: string } } | null)?.comissao
          ?.numero_contrato ?? ""
      )
    ) || null;
  const dataContrato = lease.vigenciaInicio
    ? lease.vigenciaInicio.toISOString().slice(0, 10)
    : null;

  const titular =
    lease.tenants.find((t) => t.tipo === "titular")?.tenant ?? lease.tenants[0]?.tenant;
  const locatario = {
    nome: (titular?.nome ?? "").trim(),
    cpfCnpj: digits(titular?.cpfCnpj),
  };

  const imovel = {
    endereco:
      [lease.property.rua, lease.property.numero].filter(Boolean).join(", ") +
        (lease.property.bairro ? ` - ${lease.property.bairro}` : "") || null,
    cep: digits(lease.property.cep) || null,
    uf: (lease.property.uf || "").trim().toUpperCase() || null,
    tipoImovel: (lease.property.tipoDimob as "urbano" | "rural" | null) ?? null,
  };

  const owners = lease.property.ownerships.length
    ? lease.property.ownerships
    : [];

  return owners.map((os, ownerIdx) => {
    const pct = (os.percentual ?? 100) / 100;
    const meses: DimobLeaseMonth[] = leaseRendimento.map((_, m) => {
      const baseMes = round2(leaseBase[m] * pct);
      return {
        rendimento: round2(leaseRendimento[m] * pct),
        comissao: round2(leaseBase[m] * pct * taxa),
        imposto: computeMonthlyIrrf(baseMes, os.owner.tipoPessoa, lease.regimeIr, year),
      };
    });
    return {
      recordId: `lease:${lease.id}:${ownerIdx}`,
      leaseId: lease.id,
      ownerId: os.owner.id,
      locador: {
        nome: (os.owner.nome ?? "").trim(),
        cpfCnpj: digits(os.owner.cpfCnpj),
        tipoPessoa: os.owner.tipoPessoa,
      },
      locatario,
      numeroContrato,
      dataContrato,
      meses,
      totalRendimento: round2(meses.reduce((a, x) => a + x.rendimento, 0)),
      imovel,
    };
  });
}

export async function aggregateLeasesForYear(
  orgId: string,
  year: number
): Promise<DimobLeaseAggregate> {
  const start = new Date(Date.UTC(year, 0, 1));
  const end = new Date(Date.UTC(year + 1, 0, 1));

  const [leases, exclusions] = await Promise.all([
    prisma.leaseContract.findMany({
      where: { orgId },
      select: {
        id: true,
        taxaAdminPercent: true,
        regimeIr: true,
        vigenciaInicio: true,
        dataJson: true,
        property: {
          select: {
            rua: true,
            numero: true,
            bairro: true,
            uf: true,
            cep: true,
            tipoDimob: true,
            ownerships: {
              select: {
                percentual: true,
                tipo: true,
                owner: { select: { id: true, nome: true, cpfCnpj: true, tipoPessoa: true } },
              },
            },
          },
        },
        tenants: { select: { tipo: true, tenant: { select: { nome: true, cpfCnpj: true } } } },
        rentCharges: {
          where: { kind: "aluguel", status: { in: ["paga", "repassada"] }, paidAt: { gte: start, lt: end } },
          select: { valorBase: true, encargos: true, paidAt: true },
        },
      },
    }),
    prisma.dimobExclusion.findMany({
      where: { orgId, year, leaseId: { not: null } },
      select: { leaseId: true },
    }),
  ]);

  const excludedLeaseIds = new Set(exclusions.map((e) => e.leaseId).filter(Boolean) as string[]);

  const records: DimobLeaseRecord[] = [];
  const excluded: DimobLeaseRecord[] = [];
  for (const lease of leases as unknown as LeaseInput[]) {
    const recs = buildLeaseRecords(lease, year);
    (excludedLeaseIds.has(lease.id) ? excluded : records).push(...recs);
  }

  return { year, records, excluded };
}
