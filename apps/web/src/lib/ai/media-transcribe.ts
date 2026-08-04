import { GoogleGenAI } from "@google/genai";
import { recordAIUsage } from "@/lib/ai/usage";

/**
 * Áudio e imagem de WhatsApp → texto, para o Max.
 *
 * ── Por que isto mora AQUI e não no serviço do Max ────────────────────────
 *
 * O Max roda em outro repo, com credenciais próprias e deliberadamente
 * mínimas. Transcrever lá exigiria uma `GEMINI_API_KEY` naquele projeto —
 * mais um segredo para girar, em mais um lugar, e o custo sairia do painel de
 * `AIUsage` que o dono usa para saber quanto a IA gastou no mês dele.
 *
 * Aqui a chave já existe, o `recordAIUsage` já existe e o teto por agente já é
 * aplicado na rota. O Max paga uma hop de rede e ganha observabilidade e teto
 * de graça — e o tenant continua vendo um número só.
 *
 * ── Best-effort, com o silêncio explícito ─────────────────────────────────
 *
 * Falha vira `null`, e quem chama tem que dizer à pessoa que não conseguiu
 * ouvir/ver. Um áudio ignorado em silêncio é pior que um "não entendi": a
 * pessoa fica esperando resposta de uma coisa que o agente nunca recebeu.
 */

let genaiClient: GoogleGenAI | null = null;
function getGenAI(): GoogleGenAI {
  if (!genaiClient) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("GEMINI_API_KEY não configurada");
    genaiClient = new GoogleGenAI({ apiKey });
  }
  return genaiClient;
}

const MODEL = process.env.MEDIA_TRANSCRIBE_MODEL || "gemini-2.5-flash";

/** Os formatos que a Z-API entrega — ogg/opus é o da nota de voz. */
export const SUPPORTED_AUDIO_MIMES = new Set<string>([
  "audio/ogg",
  "audio/ogg; codecs=opus",
  "audio/ogg;codecs=opus",
  "audio/opus",
  "audio/mpeg",
  "audio/mp4",
  "audio/m4a",
  "audio/x-m4a",
  "audio/amr",
  "audio/wav",
]);

export const SUPPORTED_IMAGE_MIMES = new Set<string>([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
]);

/**
 * Teto do que entra. O corpo da Vercel para em 4.5 MB e base64 infla 33%, então
 * o limite real do binário é bem menor que o da requisição. Nota de voz de
 * WhatsApp raramente passa de 200 KB; foto de celular passa fácil, e o caminho
 * honesto para ela é recusar com motivo, não estourar no meio.
 */
export const MAX_MEDIA_BYTES = 3 * 1024 * 1024;

export type MediaKind = "audio" | "image";

/**
 * `verbatim` no áudio, e não resumo: o que a pessoa disse é o turno dela na
 * conversa. Resumir aqui faria o modelo seguinte responder a uma paráfrase, e
 * dois modelos em série cada um interpretando é como um detalhe (um número, um
 * endereço) vira outro sem ninguém notar.
 */
const PROMPT: Record<MediaKind, string> = {
  audio:
    "Transcreva este áudio em português do Brasil, literalmente, sem resumir " +
    "e sem corrigir a fala. Devolva SOMENTE a transcrição, sem comentários, " +
    "sem aspas e sem prefixo. Se não houver fala audível, devolva exatamente: " +
    "(áudio sem fala audível)",
  image:
    "Descreva esta imagem em português do Brasil para alguém que não pode " +
    "vê-la, em no máximo 3 frases. Se houver texto legível (documento, " +
    "print, placa, contrato), TRANSCREVA o texto integralmente depois da " +
    "descrição, precedido de 'Texto na imagem:'. Devolva somente isso.",
};

export interface TranscribeParams {
  orgId: string;
  userId?: string | null;
  kind: MediaKind;
  mimeType: string;
  data: Buffer;
}

export interface TranscribeResult {
  text: string;
  model: string;
}

export function isSupportedMime(kind: MediaKind, mimeType: string): boolean {
  const normalized = mimeType.trim().toLowerCase();
  const base = normalized.split(";")[0].trim();
  const set = kind === "audio" ? SUPPORTED_AUDIO_MIMES : SUPPORTED_IMAGE_MIMES;
  return set.has(normalized) || set.has(base);
}

/** `null` quando não deu — nunca lança. */
export async function transcribeMedia(
  p: TranscribeParams
): Promise<TranscribeResult | null> {
  const t0 = Date.now();

  try {
    const ai = getGenAI();
    const response = await ai.models.generateContent({
      model: MODEL,
      contents: [
        { text: PROMPT[p.kind] },
        {
          inlineData: {
            mimeType: p.mimeType,
            data: p.data.toString("base64"),
          },
        },
      ],
    });

    const usage = (
      response as {
        usageMetadata?: {
          promptTokenCount?: number;
          candidatesTokenCount?: number;
        };
      }
    ).usageMetadata;

    const text = (response.text ?? "").trim();

    recordAIUsage({
      orgId: p.orgId,
      userId: p.userId ?? null,
      agentKey: "max",
      provider: "gemini",
      model: MODEL,
      operation: "max_transcribe",
      promptTokens: usage?.promptTokenCount ?? 0,
      completionTokens: usage?.candidatesTokenCount ?? 0,
      latencyMs: Date.now() - t0,
      success: text.length > 0,
    });

    return text.length > 0 ? { text, model: MODEL } : null;
  } catch (err) {
    // Gravado mesmo em falha: uma sequência de erros de transcrição só aparece
    // no painel se as tentativas frustradas também virarem linha.
    recordAIUsage({
      orgId: p.orgId,
      userId: p.userId ?? null,
      agentKey: "max",
      provider: "gemini",
      model: MODEL,
      operation: "max_transcribe",
      promptTokens: 0,
      latencyMs: Date.now() - t0,
      success: false,
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    console.error(
      "[media-transcribe] falhou:",
      err instanceof Error ? err.message : String(err)
    );
    return null;
  }
}
