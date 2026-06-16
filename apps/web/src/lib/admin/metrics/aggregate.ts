/**
 * Helpers puros de agregação para os endpoints de métricas do painel super-admin.
 * Sem Prisma/IO — recebem os resultados de `groupBy`/`findMany` já buscados e os
 * reduzem em mapas/buckets. Testáveis isoladamente com vitest.
 *
 * Decisão de moeda: NUNCA converter FX no servidor. Custos de IA são USD;
 * ClickSign/Certidões/Asaas são BRL (centavos). Mantemos cada um separado e o
 * front exibe em colunas distintas.
 */

/** Linha genérica de `groupBy(['orgId'])` com `_count` e/ou `_sum`. */
export interface OrgGroupRow {
  orgId: string | null;
  _count?: { _all?: number } | number;
  _sum?: Record<string, number | null | { toString(): string } | undefined>;
}

/** Indexa contagens por orgId a partir de um `groupBy` com `_count: { _all }`. */
export function countByOrg(rows: OrgGroupRow[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of rows) {
    if (!r.orgId) continue;
    const c =
      typeof r._count === "number" ? r._count : r._count?._all ?? 0;
    m.set(r.orgId, (m.get(r.orgId) ?? 0) + c);
  }
  return m;
}

/** Indexa a soma de um campo numérico por orgId (Decimal/Float/Int → number). */
export function sumByOrg(rows: OrgGroupRow[], field: string): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of rows) {
    if (!r.orgId) continue;
    const raw = r._sum?.[field];
    const n = raw == null ? 0 : Number(raw);
    if (Number.isNaN(n)) continue;
    m.set(r.orgId, (m.get(r.orgId) ?? 0) + n);
  }
  return m;
}

/**
 * Conta linhas por orgId a partir de uma lista crua (sem groupBy), usando um
 * seletor de orgId. Útil quando o modelo precisa de join e já trouxemos as rows.
 */
export function countRowsByOrg<T>(
  rows: T[],
  orgIdOf: (row: T) => string | null | undefined
): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of rows) {
    const orgId = orgIdOf(r);
    if (!orgId) continue;
    m.set(orgId, (m.get(orgId) ?? 0) + 1);
  }
  return m;
}

export interface DayBucket {
  date: string; // YYYY-MM-DD
  value: number;
  count: number;
}

/**
 * Agrupa linhas por dia (UTC, YYYY-MM-DD) somando `value` e contando ocorrências.
 * Retorna ordenado por data ascendente.
 */
export function bucketByDay<T>(
  rows: T[],
  dateOf: (row: T) => Date,
  valueOf: (row: T) => number = () => 0
): DayBucket[] {
  const m = new Map<string, DayBucket>();
  for (const r of rows) {
    const date = dateOf(r).toISOString().slice(0, 10);
    const entry = m.get(date) ?? { date, value: 0, count: 0 };
    entry.value += valueOf(r);
    entry.count += 1;
    m.set(date, entry);
  }
  return Array.from(m.values()).sort((a, b) => a.date.localeCompare(b.date));
}

/** Soma um campo numérico de uma lista crua (Decimal/Float/Int → number). */
export function sumField<T>(rows: T[], valueOf: (row: T) => unknown): number {
  let total = 0;
  for (const r of rows) {
    const n = Number(valueOf(r) ?? 0);
    if (!Number.isNaN(n)) total += n;
  }
  return total;
}

/** Conta por chave categórica (status, kind, etc.) a partir de um groupBy. */
export function countByKey<T extends Record<string, unknown>>(
  rows: Array<T & { _count?: { _all?: number } | number }>,
  key: keyof T
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) {
    const k = String(r[key] ?? "—");
    const c = typeof r._count === "number" ? r._count : r._count?._all ?? 0;
    out[k] = (out[k] ?? 0) + c;
  }
  return out;
}
