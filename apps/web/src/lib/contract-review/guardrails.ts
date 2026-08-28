// Guardrails determinísticos sobre a saída do revisor LLM — módulo puro.
//
// O mesmo desenho de plan-guardrails da ingestão: o LLM propõe, o validador
// cobra, e as violações voltam como feedback do retry. A âncora central
// anti-alucinação é o `selectedText` — achado cuja citação não existe no
// documento é DESCARTADO, não corrigido: se o modelo não consegue apontar o
// trecho, o achado não é verificável.
import { normalizeEvidenceText } from "./plan";
import type { ReviewCategory, ReviewPlaybook } from "./playbooks/types";

/** Achado cru como veio do modelo (schema estruturado já validou a forma). */
export interface RawReviewFinding {
  category: string;
  severity: string;
  title: string;
  finding: string;
  selectedText: string;
  /** Null = não se aplica (o schema estruturado exige o campo; ausência é valor). */
  expected?: string | null;
  suggestedFix?: string | null;
}

export interface ReviewLlmOutput {
  findings: RawReviewFinding[];
  documentOk: boolean;
}

/** Achado aceito — categoria estreitada e severidade clampada. */
export interface AcceptedReviewFinding {
  category: ReviewCategory;
  severity: "info" | "warning";
  title: string;
  finding: string;
  selectedText: string;
  expected?: string;
  suggestedFix?: string;
}

export type ReviewViolationKind =
  | "selected_text_not_found"
  | "selected_text_too_short"
  | "invalid_category"
  | "duplicate_existing"
  | "duplicate_in_batch"
  | "over_max_findings";

export interface ReviewViolation {
  index: number;
  kind: ReviewViolationKind;
  /** PT-BR — vira o feedback do retry. */
  detail: string;
}

export interface ValidateReviewFindingsInput {
  docText: string;
  playbook: ReviewPlaybook;
  /** `selectedText` dos comentários IA não resolvidos já existentes. */
  existingSelectedTexts: readonly string[];
}

export interface ValidateReviewFindingsResult {
  accepted: AcceptedReviewFinding[];
  violations: ReviewViolation[];
}

const MIN_SELECTED_TEXT = 15;
const MAX_SELECTED_TEXT = 240;

export function validateReviewFindings(
  output: ReviewLlmOutput,
  input: ValidateReviewFindingsInput
): ValidateReviewFindingsResult {
  const normalizedDoc = normalizeEvidenceText(input.docText);
  const existing = new Set(
    input.existingSelectedTexts.map((t) => normalizeEvidenceText(t))
  );
  const seenInBatch = new Set<string>();
  const accepted: AcceptedReviewFinding[] = [];
  const violations: ReviewViolation[] = [];

  output.findings.forEach((raw, index) => {
    const category = raw.category as ReviewCategory;
    if (!input.playbook.allowedCategories.includes(category)) {
      violations.push({
        index,
        kind: "invalid_category",
        detail: `Categoria "${raw.category}" não existe — use ${input.playbook.allowedCategories.join(", ")}.`,
      });
      return;
    }

    const selectedText = raw.selectedText.slice(0, MAX_SELECTED_TEXT);
    if (normalizeEvidenceText(selectedText).length < MIN_SELECTED_TEXT) {
      violations.push({
        index,
        kind: "selected_text_too_short",
        detail: `selectedText de "${raw.title}" tem menos de ${MIN_SELECTED_TEXT} caracteres úteis — cite um trecho identificável.`,
      });
      return;
    }

    const normalizedSelected = normalizeEvidenceText(selectedText);
    if (!normalizedDoc.includes(normalizedSelected)) {
      violations.push({
        index,
        kind: "selected_text_not_found",
        detail: `selectedText de "${raw.title}" não é citação literal do contrato — copie o trecho exatamente como está no texto.`,
      });
      return;
    }

    if (existing.has(normalizedSelected)) {
      violations.push({
        index,
        kind: "duplicate_existing",
        detail: `"${raw.title}" repete um comentário já existente sobre o mesmo trecho.`,
      });
      return;
    }
    const batchKey = `${category}::${normalizedSelected}`;
    if (seenInBatch.has(batchKey)) {
      violations.push({
        index,
        kind: "duplicate_in_batch",
        detail: `"${raw.title}" duplica outro achado desta mesma resposta.`,
      });
      return;
    }

    if (accepted.length >= input.playbook.maxFindings) {
      violations.push({
        index,
        kind: "over_max_findings",
        detail: `Acima do limite de ${input.playbook.maxFindings} achados — priorize os mais graves.`,
      });
      return;
    }

    seenInBatch.add(batchKey);
    accepted.push({
      category,
      // Clamp: "error" (ou qualquer outra coisa) vira warning — a revisão só
      // avisa; error é reservado aos analisadores determinísticos que gateiam
      // o /approve.
      severity: raw.severity === "info" ? "info" : "warning",
      title: raw.title.slice(0, 80),
      finding: raw.finding,
      selectedText,
      ...(raw.expected ? { expected: raw.expected } : {}),
      ...(raw.suggestedFix ? { suggestedFix: raw.suggestedFix } : {}),
    });
  });

  return { accepted, violations };
}
