/**
 * OCR Quarantine Specialist — wrapper de OCR (Gemini 2.5 Flash) com
 * Sentinel classifier obrigatório.
 *
 * Padrão CaMeL: este especialista é o ÚNICO ponto autorizado a converter
 * texto não-confiável (PDF/DOCX/imagem/URL externa) em estrutura tipada.
 * Antes de devolver o JSON estruturado pro orchestrator, passa o texto
 * raw pelo `classifyText` — se detectar injection, quarantina (não
 * devolve o texto) e grava AuditLog.
 *
 * Não tem tools de write — é puramente OCR + classify + return.
 *
 * Reusa `extractDocumentData` de `lib/ai/ocr.ts` (Gemini) e
 * `quarantineAttachment` de `sentinel/middleware.ts`.
 */

import { z } from "zod";
import { extractDocumentData } from "../ocr";
import { quarantineAttachment } from "../sentinel/middleware";
import { recordEvent } from "../multi-agent-memory";

export type DocCategory =
  | "rg"
  | "cpf"
  | "cnh"
  | "matricula"
  | "iptu"
  | "escritura"
  | "procuracao"
  | "comprovante_residencia"
  | "certidao_casamento"
  | "ficha_resumo"
  | "outro";

export interface OcrQuarantineResult {
  /** Quando true, o anexo passou na quarentena. */
  passed: boolean;
  /** Categoria classificada — só populada quando passed=true. */
  category?: DocCategory;
  /** Campos extraídos tipados — só quando passed=true. */
  fields?: Record<string, unknown>;
  /** Confidence 0..1 do Gemini. */
  confidence?: number;
  /** Razão de quarentena (quando passed=false). */
  quarantineReason?: string;
  /** Score de trust do classifier (0..1). */
  trustedScore?: number;
}

const FieldsSchema = z.record(z.unknown());

export interface QuarantineContext {
  contractId: string;
  orgId: string;
  userId: string;
}

/**
 * Executa OCR no buffer/URL + classifier de injection. Devolve resultado
 * tipado APENAS se passar — senão devolve `{ passed: false, ... }` e o
 * caller deve descartar o conteúdo.
 *
 * @param input — buffer do documento OU URL pra fetch
 */
export async function ocrQuarantine(
  input:
    | { kind: "buffer"; buffer: Buffer; mime: string }
    | { kind: "url"; url: string },
  context: QuarantineContext
): Promise<OcrQuarantineResult> {
  // 1. Roda OCR. extractDocumentData lança em falha hard — encapsular.
  // Signature: (imageBase64, mimeType, category?, ctx?) → ExtractionResult
  let extracted;
  try {
    let imageBase64: string;
    let mime: string;
    if (input.kind === "buffer") {
      imageBase64 = input.buffer.toString("base64");
      mime = input.mime;
    } else {
      const resp = await fetch(input.url, { signal: AbortSignal.timeout(15_000) });
      if (!resp.ok) {
        return { passed: false, quarantineReason: `Fetch URL ${resp.status}` };
      }
      imageBase64 = Buffer.from(await resp.arrayBuffer()).toString("base64");
      mime = resp.headers.get("content-type") ?? "application/octet-stream";
    }
    extracted = await extractDocumentData(imageBase64, mime, undefined, {
      orgId: context.orgId,
      userId: context.userId,
      contractId: context.contractId,
    });
  } catch (err) {
    return {
      passed: false,
      quarantineReason: `OCR falhou: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // 2. Validar shape com Zod — segurança extra contra Gemini retornar lixo.
  const parsed = FieldsSchema.safeParse(extracted.fields);
  if (!parsed.success) {
    recordEvent({
      orgId: context.orgId,
      contractId: context.contractId,
      action: "SENTINEL_ATTACHMENT_QUARANTINED",
      result: "DENIED",
      metadata: {
        reason: "OCR shape inválido",
        zodErrors: parsed.error.errors.slice(0, 3),
      },
    });
    return { passed: false, quarantineReason: "OCR retornou shape inesperado" };
  }

  // 3. Texto raw → classifier de injection.
  const rawTextSnippet = extracted.rawText?.slice(0, 8000) ?? "";
  if (rawTextSnippet.length > 0) {
    const quarantine = await quarantineAttachment(rawTextSnippet, context, {
      audit: true,
    });
    if (!quarantine.passed) {
      return {
        passed: false,
        quarantineReason: quarantine.reason ?? "Classifier detectou injection",
        trustedScore: quarantine.classification.trustedScore,
      };
    }
    return {
      passed: true,
      category: (extracted.documentType ?? "outro") as DocCategory,
      fields: parsed.data,
      confidence: extracted.confidence,
      trustedScore: quarantine.classification.trustedScore,
    };
  }

  // Sem rawText (e.g. imagem com poucos chars) — passa com warning.
  return {
    passed: true,
    category: (extracted.documentType ?? "outro") as DocCategory,
    fields: parsed.data,
    confidence: extracted.confidence,
    trustedScore: 1,
  };
}
