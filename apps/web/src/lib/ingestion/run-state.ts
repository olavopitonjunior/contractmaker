/**
 * Máquina de estados do run de ingestão — o núcleo PURO do pipeline.
 *
 * Módulo sem prisma, sem rede e sem fs: só transições, fatiamento e a condição
 * do claim. É deliberadamente separado do executor porque é aqui que moram as
 * decisões que quebram em silêncio no runtime — "esse run pode avançar?", "que
 * itens entram nesta fatia?", "o claim está livre?" — e todas elas precisam ser
 * exercitáveis sem banco.
 *
 * ## Por que um run tem estágios e não um booleano
 *
 * Uma invocação de `/advance` cabe em 120s (maxDuration da Vercel). Um acervo de
 * imobiliária tem dezenas de arquivos e um PDF escaneado leva dezenas de
 * segundos só de OCR. Então cada invocação processa uma FATIA de itens do
 * estágio corrente e devolve; o run só troca de estágio quando NÃO sobra item
 * pendente naquele estágio. Isso torna `/advance` idempotente por item: chamar
 * duas vezes não reprocessa o que já saiu de `pending`.
 *
 * ## O corte da Fase A1
 *
 * Os dois pontos de JULGAMENTO (classificação por documento e decisão de
 * conjunto → LibraryPlan) são da Fase A2. Aqui o pipeline vai até `grouping` e
 * entra em `planning` — onde para, porque não há planner registrado. Parar em
 * `planning` sem `libraryPlan` é um estado CONSISTENTE e legível ("o
 * determinístico acabou, falta a decisão"); inventar um plano seria pior que
 * não ter nenhum.
 */

/** Estágios de um run, na ordem em que o pipeline os percorre. */
export const RUN_STATUSES = [
  "queued",
  "extracting",
  "classifying",
  "grouping",
  "planning",
  "awaiting_review",
  "executing",
  "done",
  "failed",
  "cancelled",
] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

/** Estados finais: nada mais acontece com o run. */
export const TERMINAL_RUN_STATUSES: readonly RunStatus[] = [
  "done",
  "failed",
  "cancelled",
];

/**
 * Transições permitidas. `failed`/`cancelled` são alcançáveis de qualquer
 * estágio não-terminal e por isso não aparecem em cada lista — ver
 * {@link canTransition}.
 */
const FORWARD: Readonly<Record<RunStatus, readonly RunStatus[]>> = {
  queued: ["extracting"],
  extracting: ["classifying"],
  classifying: ["grouping"],
  grouping: ["planning"],
  planning: ["awaiting_review"],
  awaiting_review: ["executing"],
  executing: ["done"],
  done: [],
  failed: [],
  cancelled: [],
};

export function isTerminalRunStatus(status: RunStatus): boolean {
  return TERMINAL_RUN_STATUSES.includes(status);
}

export function isRunStatus(v: unknown): v is RunStatus {
  return typeof v === "string" && (RUN_STATUSES as readonly string[]).includes(v);
}

/**
 * Transição válida?
 *
 * Permanecer no MESMO estágio é sempre válido para um run vivo — é o caso
 * normal do fatiamento (três invocações seguidas deixam o run em `extracting`).
 * Sem isso, o executor precisaria de um caminho especial para "avancei mas não
 * mudei de estágio", que é justamente o caminho mais comum.
 */
export function canTransition(from: RunStatus, to: RunStatus): boolean {
  if (isTerminalRunStatus(from)) return false;
  if (to === from) return true;
  if (to === "failed" || to === "cancelled") return true;
  return FORWARD[from].includes(to);
}

/** Próximo estágio na ordem do pipeline, ou null se não há (terminal). */
export function nextRunStatus(status: RunStatus): RunStatus | null {
  return FORWARD[status][0] ?? null;
}

/**
 * Estágios que o `/advance` e o sweeper conduzem SOZINHOS.
 *
 * `planning` fica de fora porque depende do LLM (Fase A2) e `awaiting_review`
 * porque depende de gente. Um run parado neles não está travado — está
 * esperando, e o sweeper não deve tocá-lo.
 */
export const AUTO_ADVANCE_STATUSES: readonly RunStatus[] = [
  "queued",
  "extracting",
  "classifying",
  "grouping",
];

export function isAutoAdvanceable(status: RunStatus): boolean {
  return AUTO_ADVANCE_STATUSES.includes(status);
}

// ────────────────────────────────────────────────────────────────────────────
// Itens
// ────────────────────────────────────────────────────────────────────────────

export const ITEM_STATUSES = [
  "pending",
  "extracted",
  "classified",
  "planned",
  "executed",
  "discarded",
  "error",
] as const;
export type ItemStatus = (typeof ITEM_STATUSES)[number];

/** Status de item que cada estágio consome. */
const STAGE_INPUT: Partial<Record<RunStatus, ItemStatus>> = {
  extracting: "pending",
  classifying: "extracted",
};

/** O que o estágio consome, ou null quando ele não é item-a-item (grouping). */
export function stageInputStatus(status: RunStatus): ItemStatus | null {
  return STAGE_INPUT[status] ?? null;
}

/** Quantos itens cada invocação processa. Extração é o gargalo (OCR). */
export const EXTRACT_BATCH_SIZE = 5;
/** Classificação determinística é barata; a fatia é maior de propósito. */
export const CLASSIFY_BATCH_SIZE = 25;

export function batchSizeFor(status: RunStatus): number {
  return status === "extracting" ? EXTRACT_BATCH_SIZE : CLASSIFY_BATCH_SIZE;
}

export interface SliceableItem {
  id: string;
  status: ItemStatus;
}

/**
 * A fatia desta invocação: os itens que o estágio corrente ainda tem para
 * processar, no máximo `batchSize`.
 *
 * Devolve `[]` quando o estágio terminou — e é esse `[]` que autoriza o
 * executor a trocar de estágio. Itens `error`/`discarded` nunca entram: um DOCX
 * corrompido não pode segurar o lote inteiro em `extracting` para sempre.
 */
export function itemsForSlice<T extends SliceableItem>(
  items: readonly T[],
  status: RunStatus,
  batchSize = batchSizeFor(status)
): T[] {
  const input = stageInputStatus(status);
  if (!input) return [];
  return items.filter((i) => i.status === input).slice(0, batchSize);
}

/**
 * `itemsDone` do estágio corrente — quantos itens já não têm trabalho pendente
 * NELE.
 *
 * O progresso é relativo ao estágio de propósito. Uma barra que contasse "itens
 * totalmente prontos" ficaria em zero durante toda a extração, que é a parte
 * demorada, e depois saltaria — que é justamente o comportamento que faz o
 * operador achar que travou.
 */
export function stageProgress(
  items: readonly SliceableItem[],
  status: RunStatus
): number {
  if (status === "queued") return 0;
  const input = stageInputStatus(status);
  if (!input) return items.length;
  return items.filter((i) => i.status !== input).length;
}

// ────────────────────────────────────────────────────────────────────────────
// Claim
// ────────────────────────────────────────────────────────────────────────────

/**
 * Janela de stale do claim. Uma fatia inteira (5 PDFs de OCR) cabe folgada em
 * 120s; passou de 5min, o worker morreu e o run pode ser reclaimado.
 */
export const RUN_STALE_MS = Number(process.env.INGESTION_RUN_STALE_MS ?? "300000");

export interface RunClaimWhere {
  id: string;
  orgId?: string;
  // Array mutável (e não `readonly`) porque é isso que o `StringFilter` do
  // Prisma aceita — o `where` vai direto pro `updateMany`.
  status: { in: RunStatus[] };
  OR: [{ startedAt: null }, { startedAt: { lt: Date } }];
}

/**
 * O `where` do claim atômico.
 *
 * A condição de disponibilidade vai no WHERE, não num `if` antes do update: é o
 * próprio `UPDATE ... WHERE` do Postgres que serializa duas invocações
 * concorrentes. Quem perde a corrida recebe `count = 0` e desiste — ler o run,
 * decidir em JS e só então gravar deixaria a janela entre a leitura e a escrita
 * aberta, e as duas invocações processariam a mesma fatia.
 *
 * Mesma técnica de `processOcrQueue` (lib/ai/ocr-worker.ts), com `startedAt` no
 * papel de `extractingStartedAt`.
 */
export function runClaimWhere(args: {
  runId: string;
  orgId?: string;
  now: Date;
  staleMs?: number;
  statuses?: readonly RunStatus[];
}): RunClaimWhere {
  const staleBefore = new Date(
    args.now.getTime() - (args.staleMs ?? RUN_STALE_MS)
  );
  return {
    id: args.runId,
    ...(args.orgId ? { orgId: args.orgId } : {}),
    status: { in: [...(args.statuses ?? AUTO_ADVANCE_STATUSES)] },
    OR: [{ startedAt: null }, { startedAt: { lt: staleBefore } }],
  };
}

/**
 * O run está disponível para claim NESTE instante? Espelha exatamente o `where`
 * acima — existe para os testes e para o sweeper filtrarem em memória sem
 * duplicar a regra.
 */
export function isClaimable(
  run: { status: RunStatus; startedAt: Date | null },
  now: Date,
  staleMs = RUN_STALE_MS
): boolean {
  if (!isAutoAdvanceable(run.status)) return false;
  if (run.startedAt === null) return true;
  return run.startedAt.getTime() < now.getTime() - staleMs;
}
