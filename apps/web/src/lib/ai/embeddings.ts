/**
 * Voyage AI embeddings wrapper.
 *
 * Uses voyage-law-2 (1024 dimensions) by default — specialized for legal text in
 * Portuguese and English. If VOYAGE_API_KEY is not set, calls fail with a clear
 * error so callers can decide to degrade gracefully.
 *
 * @see https://docs.voyageai.com/docs/embeddings
 */

import { recordAIUsage, type AIOperation } from "./usage";

const VOYAGE_API_URL = "https://api.voyageai.com/v1/embeddings";
const DEFAULT_MODEL = "voyage-law-2";
export const EMBEDDING_DIMENSION = 1024;

/**
 * Optional observability context threaded through embed calls. When provided,
 * the call is recorded in AIUsage with the given orgId + operation.
 */
export interface EmbedUsageContext {
  orgId: string;
  userId?: string | null;
  contractId?: string | null;
  operation: AIOperation; // "embed_kb" | "embed_memory" | "embed_query"
}

export type EmbeddingInputType = "document" | "query";

export interface EmbeddingsError {
  code: "missing_api_key" | "api_error" | "network_error" | "invalid_response";
  message: string;
  cause?: unknown;
}

export class VoyageError extends Error {
  code: EmbeddingsError["code"];
  cause?: unknown;

  constructor(err: EmbeddingsError) {
    super(err.message);
    this.name = "VoyageError";
    this.code = err.code;
    this.cause = err.cause;
  }
}

interface VoyageResponse {
  object: string;
  data: Array<{
    object: string;
    embedding: number[];
    index: number;
  }>;
  model: string;
  usage: {
    total_tokens: number;
  };
}

/**
 * Call Voyage to embed a batch of texts.
 * Chunks of >2048 tokens are truncated server-side by Voyage.
 */
export async function embed(
  texts: string[],
  inputType: EmbeddingInputType = "document",
  ctx?: EmbedUsageContext
): Promise<number[][]> {
  const apiKey = process.env.VOYAGE_API_KEY;
  if (!apiKey) {
    throw new VoyageError({
      code: "missing_api_key",
      message:
        "VOYAGE_API_KEY não configurada. Adicione a chave no .env para habilitar a base de conhecimento semântica.",
    });
  }

  if (texts.length === 0) return [];

  const model = process.env.VOYAGE_EMBED_MODEL || DEFAULT_MODEL;
  const t0 = Date.now();

  // Retry com backoff exponencial em 429/5xx — um pico de rate-limit não pode
  // falhar a ingestão/consulta RAG na primeira tentativa (antes era fetch
  // único, ao contrário do OCR que já tinha backoff).
  const MAX_ATTEMPTS = 3;
  let res: Response | null = null;
  let lastErr: unknown = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      res = await fetch(VOYAGE_API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ input: texts, model, input_type: inputType }),
      });
    } catch (err) {
      lastErr = err;
      res = null;
    }
    // Sucesso ou erro não-retryável → sai do loop.
    if (res && (res.ok || (res.status !== 429 && res.status < 500))) break;
    if (attempt < MAX_ATTEMPTS) {
      const backoffMs = 300 * 2 ** (attempt - 1); // 300ms, 600ms
      await new Promise((r) => setTimeout(r, backoffMs));
    }
  }

  if (!res) {
    if (ctx) {
      recordAIUsage({
        orgId: ctx.orgId,
        userId: ctx.userId,
        contractId: ctx.contractId,
        provider: "voyage",
        model,
        operation: ctx.operation,
        promptTokens: 0,
        latencyMs: Date.now() - t0,
        success: false,
        errorMessage: lastErr instanceof Error ? lastErr.message : String(lastErr),
      });
    }
    throw new VoyageError({
      code: "network_error",
      message: "Falha ao conectar com a API da Voyage",
      cause: lastErr,
    });
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    if (ctx) {
      recordAIUsage({
        orgId: ctx.orgId,
        userId: ctx.userId,
        contractId: ctx.contractId,
        provider: "voyage",
        model,
        operation: ctx.operation,
        promptTokens: 0,
        latencyMs: Date.now() - t0,
        success: false,
        errorMessage: `HTTP ${res.status}: ${text.slice(0, 200)}`,
      });
    }
    throw new VoyageError({
      code: "api_error",
      message: `Voyage API retornou ${res.status}: ${text.slice(0, 300)}`,
    });
  }

  let data: VoyageResponse;
  try {
    data = (await res.json()) as VoyageResponse;
  } catch (err) {
    throw new VoyageError({
      code: "invalid_response",
      message: "Resposta da Voyage não é JSON válido",
      cause: err,
    });
  }

  if (!Array.isArray(data.data)) {
    throw new VoyageError({
      code: "invalid_response",
      message: "Resposta da Voyage sem campo 'data'",
    });
  }

  if (ctx) {
    recordAIUsage({
      orgId: ctx.orgId,
      userId: ctx.userId,
      contractId: ctx.contractId,
      provider: "voyage",
      model,
      operation: ctx.operation,
      promptTokens: data.usage?.total_tokens ?? 0,
      completionTokens: 0,
      latencyMs: Date.now() - t0,
      success: true,
    });
  }

  // Sort by index to ensure order matches input
  const sorted = [...data.data].sort((a, b) => a.index - b.index);
  const vectors = sorted.map((d) => d.embedding);

  // Valida a dimensão — um vetor com tamanho inesperado (modelo trocado por
  // engano, resposta corrompida) quebraria o INSERT no pgvector (coluna
  // vector(1024)) ou, pior, entraria com dimensão errada e degradaria o RAG
  // silenciosamente. Só validamos quando o modelo é o default 1024d.
  if (model === DEFAULT_MODEL) {
    for (const v of vectors) {
      if (!Array.isArray(v) || v.length !== EMBEDDING_DIMENSION) {
        throw new VoyageError({
          code: "invalid_response",
          message: `Embedding com dimensão inesperada: ${v?.length ?? "?"} (esperado ${EMBEDDING_DIMENSION})`,
        });
      }
    }
  }

  return vectors;
}

export async function embedOne(
  text: string,
  inputType: EmbeddingInputType = "document",
  ctx?: EmbedUsageContext
): Promise<number[]> {
  const [vec] = await embed([text], inputType, ctx);
  if (!vec) throw new VoyageError({ code: "invalid_response", message: "Empty result" });
  return vec;
}

/**
 * Format a JS array as a pgvector literal string for raw SQL queries.
 * Example: toPgVector([0.1, 0.2, 0.3]) → "[0.1,0.2,0.3]"
 */
export function toPgVector(embedding: number[]): string {
  return `[${embedding.join(",")}]`;
}

export function isEmbeddingsConfigured(): boolean {
  return !!process.env.VOYAGE_API_KEY;
}
