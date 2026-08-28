// Máquina de estados do run de revisão pós-geração — núcleo PURO.
//
// Espelha a forma de lib/ingestion/run-state.ts (claim atômico com a condição
// de disponibilidade no WHERE do updateMany) sem genericizar o original: os
// statuses são outros e um run de revisão não tem fatias — um contrato é UMA
// unidade. O custo de acoplar os dois seria maior que estas ~60 linhas.
//
// `skipped` é terminal e NÃO é falha: flag desligada, contrato já aprovado,
// cap de custo do dia estourado — o motivo fica no report.

export const REVIEW_STATUSES = [
  "queued",
  "reviewing",
  "done",
  "failed",
  "skipped",
] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

export const TERMINAL_REVIEW_STATUSES: readonly ReviewStatus[] = [
  "done",
  "failed",
  "skipped",
];

export function isReviewStatus(v: unknown): v is ReviewStatus {
  return typeof v === "string" && (REVIEW_STATUSES as readonly string[]).includes(v);
}

export function isTerminalReviewStatus(status: ReviewStatus): boolean {
  return TERMINAL_REVIEW_STATUSES.includes(status);
}

/**
 * Transições: queued → reviewing → done; reviewing → queued (Drive caiu — o
 * executor devolve o run para o sweeper re-tentar); failed/skipped de qualquer
 * estado vivo. Permanecer no mesmo estado é válido (re-claim de stale).
 */
export function canTransition(from: ReviewStatus, to: ReviewStatus): boolean {
  if (isTerminalReviewStatus(from)) return false;
  if (to === from) return true;
  if (to === "failed" || to === "skipped") return true;
  if (from === "queued") return to === "reviewing";
  return to === "done" || to === "queued";
}

/**
 * Janela de stale do claim — MAIOR que o maxDuration da rota (300s), senão o
 * sweeper rouba o claim de um worker vivo e a chamada de LLM é paga em dobro.
 */
export const REVIEW_STALE_MS = Number(
  process.env.CONTRACT_REVIEW_STALE_MS ?? "600000"
);

/** Máximo de tentativas antes de `failed` (Drive indisponível na leitura). */
export const REVIEW_MAX_ATTEMPTS = 3;

export interface ReviewClaimWhere {
  id: string;
  status: { in: ReviewStatus[] };
  OR: [{ startedAt: null }, { startedAt: { lt: Date } }];
}

/**
 * O `where` do claim atômico — mesma técnica de `runClaimWhere` da ingestão:
 * a disponibilidade vai no WHERE e o Postgres serializa invocações
 * concorrentes; quem perde recebe `count = 0` e desiste.
 */
export function reviewClaimWhere(args: {
  runId: string;
  now: Date;
  staleMs?: number;
}): ReviewClaimWhere {
  const staleBefore = new Date(args.now.getTime() - (args.staleMs ?? REVIEW_STALE_MS));
  return {
    id: args.runId,
    status: { in: ["queued", "reviewing"] },
    OR: [{ startedAt: null }, { startedAt: { lt: staleBefore } }],
  };
}

/** Espelho em memória do `where` acima — para testes e para o sweeper. */
export function isClaimable(
  run: { status: ReviewStatus; startedAt: Date | null },
  now: Date,
  staleMs = REVIEW_STALE_MS
): boolean {
  if (run.status !== "queued" && run.status !== "reviewing") return false;
  if (run.startedAt === null) return true;
  return run.startedAt.getTime() < now.getTime() - staleMs;
}
