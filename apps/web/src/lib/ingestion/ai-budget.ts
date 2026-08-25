/**
 * Custo de IA do run de ingestão: medição, acúmulo e o CAP.
 *
 * ## Por que um cap por run, e não só o painel de custo
 *
 * O resto do sistema gasta IA por AÇÃO do usuário: um turn de chat, um OCR de
 * documento. O teto natural é a paciência de quem está olhando a tela. A
 * ingestão em lote não tem esse teto — ela é disparada uma vez sobre um acervo
 * inteiro e se re-encadeia sozinha. Um lote com 200 arquivos, um planner que
 * escala pro Opus a cada tentativa e um bug de laço produzem uma fatura que
 * ninguém vê nascer.
 *
 * O cap é a única defesa que não depende de alguém estar olhando: passou do
 * teto, o run PARA com motivo legível em vez de continuar gastando. Parar cedo
 * custa uma retomada manual; não parar custa dinheiro real e irrecuperável.
 *
 * ## Onde o número vive
 *
 * `IngestionRun.aiCostUsd` (Decimal 12,6) é o acumulado do run e é ele que o
 * cap compara. `AIUsage` continua recebendo uma linha por chamada — os dois não
 * são redundantes: `AIUsage` responde "quanto custou cada chamada e de quem
 * foi", `aiCostUsd` responde "este run pode fazer mais uma chamada?", e a
 * segunda pergunta não pode depender de um agregado sobre uma tabela que cresce
 * sem parar.
 */

import { prisma } from "@/lib/db/prisma";
import { calcCostUsd, recordAIUsage, type AIOperation } from "@/lib/ai/usage";
import type { StructuredUsage } from "@/lib/ai/shared/anthropic-structured";

/**
 * Teto padrão por run, em USD. Alvo de custo real: ~US$1–1,5 num tenant de ~20
 * documentos — Haiku por documento na classificação (o volume) e UMA chamada de
 * Opus no plano (o julgamento). O teto é folgado de propósito: ele não é o
 * orçamento, é o disjuntor.
 */
export const DEFAULT_RUN_MAX_USD = 5;

/**
 * Lido a cada chamada (e não uma vez no load do módulo) de propósito: é a
 * alavanca de emergência do operador de plataforma, e ela não pode exigir
 * deploy para valer.
 */
export function runMaxUsd(): number {
  const raw = Number(process.env.INGESTION_RUN_MAX_USD ?? DEFAULT_RUN_MAX_USD);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_RUN_MAX_USD;
}

/** Operações de IA da ingestão em lote. */
export type IngestionOperation = Extract<
  AIOperation,
  "ingest_classify" | "ingest_plan"
>;

/**
 * Estourou o teto. Erro TIPADO porque o executor precisa distinguir "o run
 * ficou caro" (estado explicável, retomável depois de o operador subir o teto)
 * de "o run quebrou" — as duas coisas viravam a mesma string em `error`.
 */
export class IngestionCostCapError extends Error {
  readonly code = "INGESTION_COST_CAP" as const;
  readonly spentUsd: number;
  readonly capUsd: number;
  constructor(spentUsd: number, capUsd: number) {
    super(
      `A ingestão atingiu o teto de custo de IA deste lote ` +
        `(US$ ${capUsd.toFixed(2)}; gasto US$ ${spentUsd.toFixed(4)}). ` +
        `O lote foi interrompido antes de gastar mais.`
    );
    this.name = "IngestionCostCapError";
    this.spentUsd = spentUsd;
    this.capUsd = capUsd;
  }
}

/**
 * Converte o `aiCostUsd` que volta do Prisma (um `Decimal`, não um number) num
 * número. `Number(decimal)` sozinho daria `NaN` para `null` e `0` para
 * `undefined` — e um NaN aqui desligaria o cap em silêncio, que é o único modo
 * de falha que este módulo não pode ter.
 */
export function readAiCostUsd(raw: unknown): number {
  if (raw == null) return 0;
  const n = typeof raw === "object" ? Number(String(raw)) : Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

export interface IngestionAiMeterOptions {
  runId: string;
  orgId: string;
  userId?: string | null;
  /** Já gasto por invocações anteriores deste run (lido de `aiCostUsd`). */
  spentUsd?: number;
  capUsd?: number;
  /** Persistência do acumulado. Injetável para o teste não precisar de banco. */
  persist?: (runId: string, totalUsd: number) => Promise<void>;
}

export interface MeteredCall {
  operation: IngestionOperation;
  model: string;
  usage: StructuredUsage;
  latencyMs: number;
  success?: boolean;
  errorMessage?: string;
}

async function persistToRun(runId: string, totalUsd: number): Promise<void> {
  await prisma.ingestionRun.updateMany({
    where: { id: runId },
    data: { aiCostUsd: totalUsd },
  });
}

/**
 * Medidor de UM run. Vive por invocação do executor; o estado que atravessa
 * invocações é a coluna `aiCostUsd`, passada de volta em `spentUsd`.
 */
export class IngestionAiMeter {
  readonly runId: string;
  readonly capUsd: number;
  private readonly orgId: string;
  private readonly userId: string | null;
  private readonly persist: (runId: string, totalUsd: number) => Promise<void>;
  private spent: number;

  constructor(options: IngestionAiMeterOptions) {
    this.runId = options.runId;
    this.orgId = options.orgId;
    this.userId = options.userId ?? null;
    this.capUsd = options.capUsd ?? runMaxUsd();
    this.spent = Math.max(0, options.spentUsd ?? 0);
    this.persist = options.persist ?? persistToRun;
  }

  /** Total gasto pelo run até agora, em USD. */
  get spentUsd(): number {
    return this.spent;
  }

  /** Ainda cabe uma chamada? */
  withinCap(): boolean {
    return this.spent < this.capUsd;
  }

  /**
   * Porta de entrada de TODA chamada de IA da ingestão: verifica ANTES de
   * gastar. Checar depois transformaria o cap num relatório do estouro.
   */
  assertWithinCap(): void {
    if (!this.withinCap()) {
      throw new IngestionCostCapError(this.spent, this.capUsd);
    }
  }

  /**
   * Registra uma chamada: linha em `AIUsage` + acúmulo em `aiCostUsd`. Devolve
   * o custo da chamada.
   *
   * Não lança quando o teto é ultrapassado NESTA chamada — o dinheiro já foi
   * gasto e perder o registro dele seria o pior dos dois mundos. Quem barra é o
   * `assertWithinCap` da chamada seguinte.
   */
  async record(call: MeteredCall): Promise<number> {
    const costUsd = calcCostUsd(
      call.model,
      call.usage.promptTokens,
      call.usage.completionTokens,
      call.usage.cacheReadTokens,
      call.usage.cacheWriteTokens
    );

    recordAIUsage({
      orgId: this.orgId,
      userId: this.userId,
      // Explícito: a ingestão de acervo não pertence a nenhum agente do
      // registry, e deixar o campo ausente faria o lookup por operação decidir.
      agentKey: null,
      provider: "anthropic",
      model: call.model,
      operation: call.operation,
      promptTokens: call.usage.promptTokens,
      completionTokens: call.usage.completionTokens,
      cacheReadTokens: call.usage.cacheReadTokens,
      cacheWriteTokens: call.usage.cacheWriteTokens,
      latencyMs: call.latencyMs,
      success: call.success ?? true,
      errorMessage: call.errorMessage,
    });

    this.spent = Number((this.spent + costUsd).toFixed(6));
    try {
      await this.persist(this.runId, this.spent);
    } catch (err) {
      // Persistência é observabilidade + cap entre invocações; falhar aqui não
      // pode derrubar um run que já pagou pela chamada. O cap desta invocação
      // segue valendo, porque `this.spent` é memória.
      console.warn(
        `[ingestion] não deu para gravar aiCostUsd do run ${this.runId}:`,
        err
      );
    }
    return costUsd;
  }
}
