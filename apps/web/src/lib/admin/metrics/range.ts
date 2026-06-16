/**
 * Parsing de janela de tempo para os endpoints de métricas do painel super-admin.
 * Pura (sem Prisma/IO) — testável com vitest. Espelha o default 30d e a guarda
 * de data inválida de `app/api/ai-usage/route.ts`.
 */

export interface MetricsRange {
  from: Date;
  to: Date;
}

export class InvalidRangeError extends Error {
  constructor() {
    super("Invalid date range");
    this.name = "InvalidRangeError";
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Resolve `?from&to` (YYYY-MM-DD ou ISO). Default: últimos 30 dias até agora.
 * `now` é injetável para teste determinístico. Lança `InvalidRangeError` se
 * qualquer data for inválida.
 */
export function parseRange(
  params: { from?: string | null; to?: string | null },
  now: Date = new Date()
): MetricsRange {
  const to = params.to ? new Date(params.to) : now;
  const from = params.from
    ? new Date(params.from)
    : new Date(to.getTime() - 30 * DAY_MS);

  if (isNaN(from.getTime()) || isNaN(to.getTime())) {
    throw new InvalidRangeError();
  }
  return { from, to };
}

/** Conveniência: extrai from/to de uma URLSearchParams. */
export function parseRangeFromSearch(
  searchParams: URLSearchParams,
  now: Date = new Date()
): MetricsRange {
  return parseRange(
    { from: searchParams.get("from"), to: searchParams.get("to") },
    now
  );
}
