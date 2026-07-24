/**
 * insurance-service.ts — escrita de seguros/fiança vinda do agente (Max).
 *
 * Compartilhado pelo endpoint Bearer `-newton`. Decisões de produto:
 *  - `Guarantee(tipo=seguro_fianca)` é a FONTE-DA-VERDADE da fiança (1:1 com o
 *    LeaseContract). O comparativo consolidado (SegurosJá + Alpop) é gravado em
 *    `Guarantee.dadosJson`; o custo escolhido em `custoJson`; o id por fonte em
 *    `externalRef`. Despesa da fiança sai daqui (não duplica InsurancePolicy).
 *  - `InsurancePolicy(tipo=seguro_incendio)` guarda a cotação de incêndio
 *    (status `cotacao` quando o Max registra; vira `ativa` na contratação pela UI).
 *
 * Idempotência: dedupe por `externalRef` (id da cotação/análise na fonte) — atualiza
 * em vez de duplicar quando o Max reenvia o mesmo resultado.
 */

import { prisma } from "@/lib/db/prisma";

const GUARANTEE_STATUSES = new Set([
  "pendente",
  "em_analise",
  "aprovada",
  "vigente",
  "executada",
  "finalizada",
  "recusada",
]);
const INCENDIO_STATUSES = new Set(["cotacao", "em_analise", "pendente", "ativa", "vencida", "cancelada"]);

export interface RecordIncendioInput {
  leaseContractId: string;
  seguradora: string;
  status?: string;
  apoliceNumero?: string;
  premioMensal?: number;
  vigenciaInicio?: string | Date;
  vigenciaFim?: string | Date;
  prazoMeses?: number;
  responsavelPagamento?: string;
  coberturaJson?: unknown;
  externalRef?: string;
}

export interface RecordFiancaInput {
  leaseContractId: string;
  provider?: string;
  status?: string;
  premioMensal?: number;
  coberturaMeses?: number;
  consolidado?: unknown; // comparativo SegurosJá + Alpop (dadosJson)
  custoJson?: unknown;
  externalRef?: string; // ex.: JSON.stringify({ segurosja, alpop })
}

export type ServiceResult<T> = { ok: true; data: T } | { ok: false; error: string; status: 400 | 404 | 409 | 422 };

async function leaseInOrg(leaseContractId: string, orgId: string) {
  return prisma.leaseContract.findFirst({
    where: { id: leaseContractId, orgId },
    select: { id: true, propertyId: true },
  });
}

/** Registra/atualiza a cotação de incêndio (InsurancePolicy, status cotacao por padrão). */
export async function recordIncendioQuote(orgId: string, input: RecordIncendioInput): Promise<ServiceResult<unknown>> {
  const lc = await leaseInOrg(input.leaseContractId, orgId);
  if (!lc) return { ok: false, error: "Contrato não pertence à org.", status: 422 };

  const status = input.status && INCENDIO_STATUSES.has(input.status) ? input.status : "cotacao";
  const inicio = input.vigenciaInicio ? new Date(input.vigenciaInicio) : new Date();
  const fim = input.vigenciaFim
    ? new Date(input.vigenciaFim)
    : new Date(inicio.getFullYear(), inicio.getMonth() + (input.prazoMeses ?? 12), inicio.getDate());

  const base = {
    seguradora: input.seguradora,
    apoliceNumero: input.apoliceNumero ?? null,
    premioMensal: input.premioMensal ?? null,
    vigenciaInicio: inicio,
    vigenciaFim: fim,
    responsavelPagamento: input.responsavelPagamento ?? null,
    coberturaJson: (input.coberturaJson as object) ?? undefined,
    status,
    origem: "api",
    externalRef: input.externalRef ?? null,
  };

  const existing = input.externalRef
    ? await prisma.insurancePolicy.findFirst({
        where: { orgId, leaseContractId: input.leaseContractId, tipo: "seguro_incendio", externalRef: input.externalRef },
        select: { id: true },
      })
    : null;

  const policy = existing
    ? await prisma.insurancePolicy.update({ where: { id: existing.id }, data: base })
    : await prisma.insurancePolicy.create({
        data: { orgId, leaseContractId: input.leaseContractId, propertyId: lc.propertyId, tipo: "seguro_incendio", ...base },
      });
  return { ok: true, data: { policy, updated: Boolean(existing) } };
}

/** Registra/atualiza a fiança como Guarantee (fonte-da-verdade), 1:1 com o LeaseContract. */
export async function recordFiancaGuarantee(orgId: string, input: RecordFiancaInput): Promise<ServiceResult<unknown>> {
  const lc = await leaseInOrg(input.leaseContractId, orgId);
  if (!lc) return { ok: false, error: "Contrato não pertence à org.", status: 422 };

  const status = input.status && GUARANTEE_STATUSES.has(input.status) ? input.status : "em_analise";
  const custoJson =
    (input.custoJson as object) ?? (input.premioMensal != null ? { premioMensal: input.premioMensal } : undefined);

  const guarantee = await prisma.guarantee.upsert({
    where: { leaseContractId: input.leaseContractId },
    create: {
      orgId,
      leaseContractId: input.leaseContractId,
      tipo: "seguro_fianca",
      provider: input.provider ?? null,
      status,
      coberturaMeses: input.coberturaMeses ?? null,
      custoJson: custoJson,
      dadosJson: (input.consolidado as object) ?? undefined,
      externalRef: input.externalRef ?? null,
    },
    update: {
      tipo: "seguro_fianca",
      provider: input.provider ?? undefined,
      status,
      coberturaMeses: input.coberturaMeses ?? undefined,
      custoJson: custoJson,
      dadosJson: (input.consolidado as object) ?? undefined,
      externalRef: input.externalRef ?? undefined,
    },
  });
  return { ok: true, data: { guarantee } };
}

const CREDIT_STATUSES = new Set(["pendente", "aprovado", "aprovado_com_garantia", "analise_manual", "recusado"]);
// Pior caso (decisão de produto multi-locatário): recusado domina; depois análise
// manual; depois aprovado_com_garantia; pendente (ainda analisando) bloqueia "aprovado".
const CREDIT_RANK: Record<string, number> = {
  recusado: 4,
  analise_manual: 3,
  aprovado_com_garantia: 2,
  pendente: 1,
  aprovado: 0,
};

/**
 * Veredito de crédito de nível-deal a partir das análises por pretendente
 * (titular + solidários). Regra: TODOS precisam passar; o pior caso vence.
 */
export function aggregateCreditVerdict(statuses: string[]): string {
  if (!statuses.length) return "pendente";
  return statuses.reduce((worst, s) => ((CREDIT_RANK[s] ?? 1) > (CREDIT_RANK[worst] ?? 1) ? s : worst), "aprovado");
}

export interface RecordCreditInput {
  tenantId: string;
  leaseDealId?: string;
  status: string;
  decisionJson?: unknown; // comparativo consolidado SegurosJá/Alpop
  scoreInterno?: number;
  externalRef?: string;
}

/**
 * Grava a análise de crédito (CreditAnalysis) de UM pretendente. Veredito vem só do
 * underwriting consolidado SegurosJá/Alpop (Serasa fora de escopo). Dedupe por
 * (orgId, tenantId, leaseDealId): atualiza a mais recente, senão cria.
 */
export async function recordCreditAnalysis(orgId: string, input: RecordCreditInput): Promise<ServiceResult<unknown>> {
  const tenant = await prisma.tenant.findFirst({ where: { id: input.tenantId, orgId }, select: { id: true } });
  if (!tenant) return { ok: false, error: "Pretendente (tenant) não pertence à org.", status: 422 };

  const status = CREDIT_STATUSES.has(input.status) ? input.status : "pendente";
  const decisionJson =
    (input.decisionJson as object) ?? (input.externalRef ? { externalRef: input.externalRef } : undefined);

  const existing = await prisma.creditAnalysis.findFirst({
    where: { orgId, tenantId: input.tenantId, leaseDealId: input.leaseDealId ?? null },
    orderBy: { updatedAt: "desc" },
    select: { id: true },
  });

  const analysis = existing
    ? await prisma.creditAnalysis.update({
        where: { id: existing.id },
        data: { status, decisionJson, scoreInterno: input.scoreInterno ?? undefined },
      })
    : await prisma.creditAnalysis.create({
        data: {
          orgId,
          tenantId: input.tenantId,
          leaseDealId: input.leaseDealId ?? null,
          status,
          decisionJson,
          scoreInterno: input.scoreInterno ?? null,
        },
      });
  return { ok: true, data: { creditAnalysis: analysis, updated: Boolean(existing) } };
}

/** Leitura consolidada dos seguros de um contrato (apólices + garantia de fiança). */
export async function readDealInsurance(orgId: string, leaseContractId: string): Promise<ServiceResult<unknown>> {
  const lc = await leaseInOrg(leaseContractId, orgId);
  if (!lc) return { ok: false, error: "Contrato não pertence à org.", status: 404 };
  const [policies, guarantee] = await Promise.all([
    prisma.insurancePolicy.findMany({
      where: { orgId, leaseContractId },
      orderBy: { createdAt: "desc" },
    }),
    prisma.guarantee.findUnique({ where: { leaseContractId } }),
  ]);
  return { ok: true, data: { policies, guarantee } };
}
