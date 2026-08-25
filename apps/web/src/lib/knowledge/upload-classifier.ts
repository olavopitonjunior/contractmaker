/**
 * Classificador de upload da base de conhecimento.
 *
 * Existem dois caminhos de ingestão de DOCX/PDF no produto — `/api/knowledge/upload`
 * (RAG) e `/api/templates/from-docx` (template com placeholders) — e nada
 * dizia ao usuário qual era o certo: um contrato-modelo inteiro acabava virando
 * uma "cláusula" no acervo. Este módulo decide, a partir do texto já extraído:
 *
 *  - `template`  → contrato completo (qualificação das partes + cláusulas
 *                  sequenciais + fecho de assinaturas). A rota devolve 409 e a
 *                  UI oferece o fluxo de modelos.
 *  - `clauses`   → coleção de cláusulas soltas → 1 KnowledgeItem por cláusula.
 *  - `knowledge` → o resto (legislação, manual, parecer) → chunking por tamanho.
 *
 * A 1ª camada é DETERMINÍSTICA (`classifyByHeuristics`, testável e sem custo).
 * A 2ª (Gemini 2.5 Flash) só roda quando a heurística fica incerta.
 */

import { GoogleGenAI } from "@google/genai";
import { recordAIUsage, geminiUsageToTokens } from "@/lib/ai/usage";
import type { GeminiUsageMetadata } from "@/lib/ai/usage";
import { countClauseHeaders } from "./clause-segmenter";

export type UploadKind = "template" | "clauses" | "knowledge";

export interface UploadClassification {
  kind: UploadKind;
  /** 0..1 — abaixo de `UNCERTAIN_THRESHOLD` a camada de IA é acionada. */
  confidence: number;
  /** Explicação curta em PT-BR, mostrada ao usuário no card do 409. */
  reason: string;
  /**
   * Só para `kind === "knowledge"`: categoria de KnowledgeItem sugerida.
   * "model" quando o documento parece um contrato de referência; "clause"
   * (default histórico da rota) caso contrário.
   */
  suggestedCategory?: "model" | "clause";
  /** Camada que decidiu — usado só em log/debug. */
  via?: "heuristics" | "ai" | "heuristics_fallback";
}

/** Abaixo disso a heurística não é confiável o bastante pra decidir sozinha. */
export const UNCERTAIN_THRESHOLD = 0.7;

/** Corte do texto enviado à IA — o começo e o miolo já bastam pra estrutura. */
const AI_TEXT_LIMIT = 12_000;

/** Título de contrato só conta quando aparece no topo do documento. */
const HEAD_CHARS = 1_500;

// ────────────────────────────────────────────────────────────────────────────
// Camada 1 — heurísticas determinísticas
// ────────────────────────────────────────────────────────────────────────────

/** Qualificação de parte: nome + documento + endereço + "doravante...". */
const QUALIFICATION_PATTERNS: RegExp[] = [
  /inscrit[oa]s?\s+no\s+CPF/i,
  /\bCPF\b[^\n]{0,30}\d{3}\.?\d{3}\.?\d{3}-?\d{2}/i,
  /portador(?:a|es)?\s+d[oa]\s+(?:c[ée]dula|RG|carteira|documento)/i,
  /residente\s+e\s+domiciliad[oa]/i,
  /doravante\s+(?:simplesmente\s+)?(?:denominad|design|nomead|chamad)/i,
  /\bbrasileir[oa]\b\s*,\s*[a-zà-ú]/i,
  /estado\s+civil/i,
];

/** Fecho: local/data, vias, testemunhas, linhas de assinatura. */
const CLOSING_PATTERNS: RegExp[] = [
  /por\s+estarem\s+(?:assim\s+)?justos\s+e\s+(?:contratad|acordad|conveniad|pactuad)/i,
  /(?:firmam|assinam)\s+o\s+presente/i,
  /em\s+\d+\s*\([a-zà-ú]+\)\s*vias/i,
  /em\s+(?:duas|tr[êe]s|quatro)\s+vias/i,
  /^\s*TESTEMUNHAS?\s*:?\s*$/im,
  /_{6,}/,
  /^[^\n]{0,40},\s*\d{1,2}\s+de\s+[a-zà-ú]+\s+de\s+\d{4}\.?\s*$/im,
];

/**
 * Título de instrumento — sinal forte de documento contratual inteiro.
 * Ancorado no INÍCIO da linha (até 24 chars de folga p/ numeração ou espaço):
 * cláusula solta cita "instrumento particular de confissão de dívida" no meio
 * do parágrafo e isso NÃO é título.
 */
const CONTRACT_TITLE_PATTERNS: RegExp[] = [
  /^[^\n]{0,24}INSTRUMENTO\s+PARTICULAR\b/im,
  /^[^\n]{0,24}CONTRATO\s+DE\s+[A-ZÀ-Ü]{3}/m,
  /^[^\n]{0,24}(?:COMPROMISSO|PROMESSA)\s+DE\s+(?:COMPRA\s+E\s+)?VENDA/im,
  /^[^\n]{0,24}ESCRITURA\s+P[ÚU]BLICA/im,
  /^[^\n]{0,24}CONTRATO\s+DE\s+LOCA[ÇC][ÃA]O/im,
];

const FILENAME_TEMPLATE_HINT = /(contrato|minuta|modelo|instrumento|ccv|template)/i;
const FILENAME_CLAUSES_HINT = /(cl[áa]usul|banco.?de.?cl|acervo)/i;

export interface HeuristicSignals {
  clauseHeaders: number;
  qualificationHits: number;
  closingHits: number;
  hasContractTitle: boolean;
  filenameHint: "template" | "clauses" | null;
}

/**
 * Sinais crus do documento. Exportado pra facilitar teste e debug — a decisão
 * fica em `classifyByHeuristics`.
 */
export function collectSignals(text: string, filename: string): HeuristicSignals {
  const head = text.slice(0, HEAD_CHARS);
  return {
    clauseHeaders: countClauseHeaders(text),
    qualificationHits: QUALIFICATION_PATTERNS.filter((re) => re.test(text)).length,
    closingHits: CLOSING_PATTERNS.filter((re) => re.test(text)).length,
    hasContractTitle: CONTRACT_TITLE_PATTERNS.some((re) => re.test(head)),
    filenameHint: FILENAME_CLAUSES_HINT.test(filename)
      ? "clauses"
      : FILENAME_TEMPLATE_HINT.test(filename)
        ? "template"
        : null,
  };
}

function describe(s: HeuristicSignals): string {
  const parts = [`${s.clauseHeaders} cabeçalho(s) de cláusula`];
  if (s.qualificationHits >= 2) parts.push("qualificação de partes");
  if (s.closingHits >= 1) parts.push("fecho de assinaturas");
  if (s.hasContractTitle) parts.push("título de instrumento");
  return parts.join(", ");
}

/**
 * Heurística pura — sem IA, sem I/O. Duas cláusulas ou mais + qualificação +
 * fecho = contrato inteiro; cláusulas sem moldura = coleção; o resto é acervo.
 */
export function classifyByHeuristics(
  text: string,
  filename: string
): UploadClassification {
  const s = collectSignals(text, filename);
  // Qualificação isolada é fraca (uma cláusula solta pode citar CPF) — exige 2.
  const hasQualification = s.qualificationHits >= 2;
  const hasClosing = s.closingHits >= 1;
  const structural =
    (hasQualification ? 1 : 0) + (hasClosing ? 1 : 0) + (s.hasContractTitle ? 1 : 0);
  const detail = describe(s);

  if (s.clauseHeaders >= 2) {
    if (structural >= 2) {
      return {
        kind: "template",
        confidence: structural === 3 && s.clauseHeaders >= 3 ? 0.95 : 0.85,
        reason: `Estrutura de contrato completo: ${detail}.`,
        via: "heuristics",
      };
    }
    if (structural === 1) {
      // Meio-termo: contrato sem fecho legível OU coleção com um preâmbulo.
      // Confiança abaixo do limiar → a camada de IA desempata.
      return s.clauseHeaders >= 3
        ? {
            kind: "template",
            confidence: 0.55,
            reason: `Parece um contrato, mas faltam sinais: ${detail}.`,
            via: "heuristics",
          }
        : {
            kind: "clauses",
            confidence: 0.5,
            reason: `Poucas cláusulas e sinais mistos: ${detail}.`,
            via: "heuristics",
          };
    }
    return {
      kind: "clauses",
      confidence: s.clauseHeaders >= 4 ? 0.85 : 0.75,
      reason: `Coleção de cláusulas soltas — sem qualificação de partes nem fecho (${detail}).`,
      via: "heuristics",
    };
  }

  if (structural >= 2) {
    // Contrato em prosa, sem cláusulas numeradas reconhecíveis.
    return {
      kind: "template",
      confidence: 0.6,
      reason: `Documento com moldura de contrato, mas sem cláusulas numeradas (${detail}).`,
      via: "heuristics",
    };
  }

  const suggestedCategory: "model" | "clause" =
    s.hasContractTitle || s.filenameHint === "template" ? "model" : "clause";
  return {
    kind: "knowledge",
    confidence: s.clauseHeaders === 0 ? 0.8 : 0.55,
    reason: `Texto de referência, sem estrutura de contrato (${detail}).`,
    suggestedCategory,
    via: "heuristics",
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Camada 2 — desempate por IA (Gemini 2.5 Flash)
// ────────────────────────────────────────────────────────────────────────────

let genaiClient: GoogleGenAI | null = null;
function getGenAI(): GoogleGenAI {
  if (!genaiClient) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("GEMINI_API_KEY nao configurada");
    genaiClient = new GoogleGenAI({ apiKey });
  }
  return genaiClient;
}

const AI_PROMPT = `Você classifica um documento jurídico brasileiro que acabou de ser enviado para a base de conhecimento de uma imobiliária.

Responda APENAS um JSON: {"kind": "...", "confidence": 0.0, "reason": "..."}

Valores de kind:
- "template": contrato completo e pronto para uso (qualificação das partes, cláusulas em sequência e fecho com data/assinaturas). Serve de MODELO para gerar novos contratos.
- "clauses": coleção de cláusulas avulsas, sem partes qualificadas e sem fecho — um acervo para reuso individual.
- "knowledge": qualquer outro material de referência (lei, jurisprudência, manual, parecer, glossário, checklist).

reason: uma frase curta em português explicando a escolha.
confidence: 0 a 1.

DOCUMENTO:
`;

function parseAiJson(raw: string): UploadClassification | null {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]) as Record<string, unknown>;
    const kind = String(parsed.kind ?? "").trim().toLowerCase();
    if (kind !== "template" && kind !== "clauses" && kind !== "knowledge") return null;
    const confidence =
      typeof parsed.confidence === "number"
        ? Math.max(0, Math.min(1, parsed.confidence))
        : 0.7;
    const reason =
      typeof parsed.reason === "string" && parsed.reason.trim()
        ? parsed.reason.trim().slice(0, 300)
        : "Classificado pela IA.";
    return { kind, confidence, reason, via: "ai" };
  } catch {
    return null;
  }
}

/**
 * Classificação completa: heurística e, só quando ela fica incerta (ou quando
 * a chave do Gemini existe), um desempate por IA. Qualquer falha da IA cai de
 * volta na heurística com confiança rebaixada — a rota nunca quebra por isso.
 */
export async function classifyKnowledgeUpload(
  text: string,
  filename: string,
  ctx?: { orgId: string; userId?: string | null }
): Promise<UploadClassification> {
  const heuristic = classifyByHeuristics(text, filename);
  if (heuristic.confidence >= UNCERTAIN_THRESHOLD) return heuristic;
  if (!process.env.GEMINI_API_KEY) return heuristic;

  const model = process.env.GEMINI_CLASSIFY_MODEL || "gemini-2.5-flash";
  const t0 = Date.now();
  try {
    const response = await getGenAI().models.generateContent({
      model,
      contents: [{ text: `${AI_PROMPT}${text.slice(0, AI_TEXT_LIMIT)}` }],
    });
    if (ctx) {
      const usage = (
        response as {
          usageMetadata?: GeminiUsageMetadata;
        }
      ).usageMetadata;
      const tok = geminiUsageToTokens(usage, model);
      recordAIUsage({
        orgId: ctx.orgId,
        userId: ctx.userId,
        provider: "gemini",
        model,
        operation: "knowledge_upload_classification",
        promptTokens: tok.promptTokens,
        completionTokens: tok.completionTokens,
        thoughtsTokens: tok.thoughtsTokens,
        latencyMs: Date.now() - t0,
        success: true,
      });
    }
    const parsed = parseAiJson(response.text ?? "");
    if (!parsed) {
      return { ...heuristic, confidence: 0.5, via: "heuristics_fallback" };
    }
    return {
      ...parsed,
      suggestedCategory:
        parsed.kind === "knowledge" ? (heuristic.suggestedCategory ?? "clause") : undefined,
    };
  } catch (err) {
    if (ctx) {
      recordAIUsage({
        orgId: ctx.orgId,
        userId: ctx.userId,
        provider: "gemini",
        model,
        operation: "knowledge_upload_classification",
        promptTokens: 0,
        latencyMs: Date.now() - t0,
        success: false,
        errorMessage: err instanceof Error ? err.message : String(err),
      });
    }
    return {
      ...heuristic,
      confidence: Math.min(heuristic.confidence, 0.4),
      reason: `${heuristic.reason} (desempate por IA indisponível)`,
      via: "heuristics_fallback",
    };
  }
}

/** Reset pra testes (forçar re-instanciar com env mockada). */
export function __resetGenAIForTests(): void {
  genaiClient = null;
}
