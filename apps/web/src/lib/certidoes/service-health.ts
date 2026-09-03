import { prisma } from "@/lib/db/prisma";
import { classifyJobBucket, type HealthBucket, type HealthJobLike } from "./health-monitor";
import { isEmailThrottle, isEndpointNotEnabled } from "./error-codes";
import { monthlyBudgetCents, monthlySpendWhere } from "./budget";

/**
 * Saúde do serviço de certidões por org, em LEITURA — resgate 5c.
 *
 * Espelha o guard de custo do executor (orçamento mensal + crédito esgotado) e
 * a taxa de sucesso recente, num bloco compacto pra ANEXAR ao e-mail do
 * problem-digest (o aviso só sai quando já há problema; ver o cron
 * cron/certidoes/problem-digest). Não envia e-mail nem escreve nada.
 */

// Buckets que contam como "problema" (falha acionável) na taxa de sucesso.
// `ok` é sucesso; `em_voo`/`outro` ficam de fora (transitório/indefinido).
const PROBLEM_BUCKETS = new Set<HealthBucket>([
  "dado_faltante",
  "failed_retryable",
  "credito",
  "config_endpoint",
  "codigo_suspeito",
  "indisponivel",
]);

function formatBRL(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

interface MonthSpend {
  spentCents: number;
  budgetCents: number;
  pct: number;
}

async function monthSpend(
  orgId: string,
  provider: "infosimples" | "serasa"
): Promise<MonthSpend> {
  const now = new Date();
  const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const agg = await prisma.certidaoJob.aggregate({
    where: monthlySpendWhere(orgId, provider, firstOfMonth),
    _sum: { costCents: true },
  });
  const spentCents = agg._sum.costCents ?? 0;
  const budgetCents = monthlyBudgetCents(provider);
  return {
    spentCents,
    budgetCents,
    pct: budgetCents > 0 ? spentCents / budgetCents : 0,
  };
}

/**
 * Estado do guard de custo da org (leitura): orçamento estourado e/ou crédito
 * Infosimples esgotado (603/604 genuíno recente — filtra throttle de e-mail e
 * endpoint não-habilitado, que NÃO são falta de crédito).
 */
async function guardState(
  orgId: string,
  infosimples: MonthSpend
): Promise<{ budgetExceeded: boolean; creditExhausted: boolean }> {
  const budgetExceeded = infosimples.spentCents >= infosimples.budgetCents;
  const recent = await prisma.certidaoJob.findMany({
    where: {
      orgId,
      resultCode: { in: [603, 604] },
      finishedAt: { gte: new Date(Date.now() - 30 * 60_000) },
    },
    select: { resultMessage: true, errorMessage: true },
    take: 20,
  });
  const creditExhausted = recent.some((c) => {
    const msg = [c.resultMessage, c.errorMessage].filter(Boolean).join(" ");
    return !isEmailThrottle(msg) && !isEndpointNotEnabled(msg);
  });
  return { budgetExceeded, creditExhausted };
}

export interface ServiceHealth {
  text: string;
  html: string;
  /** Sinaliza degradação (guard ativo) — o caller pode destacar. */
  degraded: boolean;
}

/**
 * Monta o bloco de saúde do serviço da org (últimas `windowHours`): estado do
 * guard, % de orçamento por provedor e taxa de sucesso. Sempre retorna conteúdo.
 */
export async function buildServiceHealth(
  orgId: string,
  windowHours = 24
): Promise<ServiceHealth> {
  const since = new Date(Date.now() - windowHours * 60 * 60_000);
  const rows = await prisma.certidaoJob.findMany({
    where: { orgId, createdAt: { gte: since }, status: { not: "replaced" } },
    select: {
      status: true,
      resultCode: true,
      errorMessage: true,
      resultData: true,
      retryCount: true,
    },
  });

  let success = 0;
  let problems = 0;
  for (const r of rows) {
    const b = classifyJobBucket(r as HealthJobLike);
    if (b === "ok") success++;
    else if (PROBLEM_BUCKETS.has(b)) problems++;
  }
  const decided = success + problems;
  const successRate = decided > 0 ? Math.round((success / decided) * 100) : 100;

  const [infosimples, serasa] = await Promise.all([
    monthSpend(orgId, "infosimples"),
    monthSpend(orgId, "serasa"),
  ]);
  const guard = await guardState(orgId, infosimples);
  const degraded = guard.budgetExceeded || guard.creditExhausted;

  const guardLabel = guard.creditExhausted
    ? "BLOQUEADO — crédito Infosimples esgotado (603/604 recente)"
    : guard.budgetExceeded
      ? "BLOQUEADO — orçamento mensal Infosimples estourado"
      : "OK — dentro do orçamento e com crédito";

  const infoLine = `Orçamento Infosimples: ${formatBRL(infosimples.spentCents)} de ${formatBRL(infosimples.budgetCents)} (${Math.round(infosimples.pct * 100)}%)`;
  const serasaLine =
    serasa.spentCents > 0
      ? `Orçamento Serasa: ${formatBRL(serasa.spentCents)} de ${formatBRL(serasa.budgetCents)} (${Math.round(serasa.pct * 100)}%)`
      : null;
  const rateLine = `Taxa de sucesso (${windowHours}h): ${successRate}%`;

  const text = [
    `Saúde do serviço: ${guardLabel}`,
    `- ${infoLine}`,
    ...(serasaLine ? [`- ${serasaLine}`] : []),
    `- ${rateLine}`,
  ].join("\n");

  const html = `<p><strong>Saúde do serviço:</strong> ${guardLabel}</p><ul><li>${infoLine}</li>${
    serasaLine ? `<li>${serasaLine}</li>` : ""
  }<li>${rateLine}</li></ul>`;

  return { text, html, degraded };
}
