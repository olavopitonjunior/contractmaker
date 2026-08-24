import { GoogleGenAI } from "@google/genai";
import { recordAIUsage, geminiUsageToTokens, type AIOperation } from "@/lib/ai/usage";
import type { GeminiUsageMetadata } from "@/lib/ai/usage";
import type { ImportableMime } from "@/lib/google/upload-file-as-gdoc";

/**
 * Runner compartilhado de extração de documentos via Gemini. Concentra o
 * client, a chamada `generateContent`, o `recordAIUsage` e o parse defensivo —
 * os extractors (CCV de venda, contrato de locação) fornecem só o prompt e a
 * operation de telemetria.
 *
 * Best-effort por contrato: erros de rede/parse/safety viram `{}` e o caller
 * segue o fluxo (o usuário completa manualmente).
 */

let genaiClient: GoogleGenAI | null = null;
function getGenAI(): GoogleGenAI {
  if (!genaiClient) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY nao configurada");
    }
    genaiClient = new GoogleGenAI({ apiKey });
  }
  return genaiClient;
}

/** Gemini não parseia DOCX nativamente, mas o Drive converte antes nos fluxos
 *  de import — aqui aceitamos os dois mimes que os call-sites enviam. */
export const EXTRACTION_SUPPORTED_MIMES: ImportableMime[] = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
];

export interface DocExtractionContext {
  orgId: string;
  userId?: string | null;
  contractId?: string | null;
}

export interface RunDocExtractionInput {
  buffer: Buffer;
  sourceMime: ImportableMime;
  prompt: string;
  /** Operation gravada no AIUsage (ex: "extract_ccv_doc", "extract_locacao_doc"). */
  operation: AIOperation;
  ctx: DocExtractionContext;
  /** Override de modelo; default CCV_EXTRACTION_MODEL || gemini-2.5-flash. */
  model?: string;
}

export async function runDocExtraction(
  input: RunDocExtractionInput
): Promise<Record<string, unknown>> {
  const { buffer, sourceMime, prompt, operation, ctx } = input;
  if (!EXTRACTION_SUPPORTED_MIMES.includes(sourceMime)) {
    return {};
  }

  const model =
    input.model || process.env.CCV_EXTRACTION_MODEL || "gemini-2.5-flash";
  const t0 = Date.now();

  let text: string;
  let usage:
    | GeminiUsageMetadata
    | undefined;

  try {
    const ai = getGenAI();
    const response = await ai.models.generateContent({
      model,
      contents: [
        { text: prompt },
        {
          inlineData: {
            mimeType: sourceMime,
            data: buffer.toString("base64"),
          },
        },
      ],
    });
    text = response.text ?? "{}";
    usage = (
      response as {
        usageMetadata?: GeminiUsageMetadata;
      }
    ).usageMetadata;
  } catch (err) {
    recordAIUsage({
      orgId: ctx.orgId,
      userId: ctx.userId,
      contractId: ctx.contractId,
      provider: "gemini",
      model,
      operation,
      promptTokens: 0,
      latencyMs: Date.now() - t0,
      success: false,
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    console.error(`[genai-extract] Gemini falhou (${operation}):`, err);
    return {};
  }

  const tok = geminiUsageToTokens(usage, model);
  recordAIUsage({
    orgId: ctx.orgId,
    userId: ctx.userId,
    contractId: ctx.contractId,
    provider: "gemini",
    model,
    operation,
    promptTokens: tok.promptTokens,
    completionTokens: tok.completionTokens,
    thoughtsTokens: tok.thoughtsTokens,
    latencyMs: Date.now() - t0,
    success: true,
  });

  return parseExtractionJson(text);
}

/** Tenta parsear o JSON retornado pelo Gemini. Defensivo contra markdown wrap. */
export function parseExtractionJson(raw: string): Record<string, unknown> {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return {};
  try {
    const parsed = JSON.parse(match[0]);
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}
