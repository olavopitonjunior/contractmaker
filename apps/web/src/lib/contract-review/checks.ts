// Checagens DETERMINÍSTICAS da revisão pós-geração — módulo puro.
//
// Conferem o documento gerado contra o plano materializado
// (Contract.generationPlanJson): a cláusula eleita está mesmo no texto? A
// seguradora escolhida aparece? Alguma falha de slot foi engolida na geração?
// Zero IA aqui — é o "processo hard code" que o dono pediu; o LLM (PR 3) só
// cobre o que regra nenhuma alcança.
//
// Filosofia D16: TUDO warning/info, nunca error — a revisão avisa, não trava
// o /approve (error é reservado aos analisadores de validade pré-existentes).
import type { ClauseSlotFailureReason } from "@/lib/templates/clause-slots";
import type { GenerationPlan } from "./plan";
import { normalizeEvidenceText } from "./plan";
import { labelForToken } from "./fill";

/** Mesma forma do QuickFinding do linter, com categoria livre (vira o
 *  namespace do dedupeKey: `review:<category>`). */
export interface ReviewFinding {
  severity: "info" | "warning";
  category: string;
  message: string;
  /** Âncora/dedupe do ContractComment — citação do doc quando existe, senão
   *  um identificador estável do achado. */
  selectedText: string;
  suggestedFix?: string;
}

/** Tradução das falhas de slot para a língua do operador (a razão técnica
 *  hoje morre num console.error da geração). */
const SLOT_FAILURE_MESSAGES: Record<ClauseSlotFailureReason, string> = {
  render_error:
    "A cláusula do acervo para o slot de garantia falhou ao renderizar e o contrato saiu com a cláusula padrão.",
  residual_placeholder:
    "A cláusula do acervo para o slot de garantia tem chave sem preenchimento ({{…}}) e foi descartada — o contrato saiu com a cláusula padrão.",
  chunked_content:
    "A cláusula do acervo está num registro antigo repartido (conteúdo parcial) e foi descartada — o contrato saiu com a cláusula padrão.",
  provider_mismatch:
    "O acervo não tem cláusula da seguradora/prestadora escolhida — o contrato saiu com a cláusula genérica do tipo de garantia.",
};

/**
 * Confere o texto do documento contra o plano de geração.
 *
 * `docText` é o texto REAL (plain text do Google Doc ou htmlContent pós-
 * snapshot) — a normalização dos dois lados é a mesma (`normalizeEvidenceText`),
 * então "presença" sobrevive ao round-trip HTML → Doc → export.
 */
export function clausePlanChecks(
  plan: GenerationPlan,
  docText: string
): ReviewFinding[] {
  const findings: ReviewFinding[] = [];
  const normalizedDoc = normalizeEvidenceText(docText);

  // 1. Cláusula eleita presente no corpo. A evidência é o head normalizado do
  //    conteúdo que a geração injetou — ausência significa que o slot não
  //    chegou ao documento (placeholder não substituído, doc editado, etc.).
  for (const evidence of plan.slotEvidence ?? []) {
    if (!normalizedDoc.includes(evidence.contentHead)) {
      findings.push({
        severity: "warning",
        category: "clausula_ausente",
        message:
          `A cláusula esperada para o slot de ${evidence.slot} não foi encontrada no texto do contrato. ` +
          `Confira se o modelo tem o marcador do slot e se o documento não foi alterado após a geração.`,
        selectedText: `slot:${evidence.slot}`,
      });
    }
  }

  // 2. Seguradora/prestadora citada. Só quando a cláusula eleita veio do
  //    acervo SEM falha (cláusula específica da prestadora): aí o nome dela
  //    tem de aparecer no texto. Cláusula genérica legitimamente não nomeia.
  const provider = plan.garantia?.provider;
  if (provider) {
    const providerResolved = (plan.slots?.resolved ?? []).some(
      (r) => r.source === "knowledge" && !r.failure
    );
    if (providerResolved && !normalizedDoc.includes(normalizeEvidenceText(provider))) {
      findings.push({
        severity: "warning",
        category: "provider_ausente",
        message:
          `A seguradora/prestadora escolhida no formulário (${provider}) não é citada no texto do contrato, ` +
          `apesar de existir cláusula própria dela no acervo.`,
        selectedText: `provider:${provider}`,
      });
    }
  }

  // 3. Falhas de slot engolidas na geração (antes: console.error).
  for (const failure of plan.slots?.failures ?? []) {
    findings.push({
      severity: "warning",
      category: "slot_fallback",
      message: SLOT_FAILURE_MESSAGES[failure.reason] ?? failure.message,
      selectedText: `slot-failure:${failure.slot}:${failure.reason}`,
      suggestedFix:
        failure.reason === "provider_mismatch"
          ? "Cadastre a cláusula da prestadora em Configurações → Seguradoras e prestadoras de garantia."
          : "Corrija a cláusula no Acervo de cláusulas (Templates → Acervo).",
    });
  }

  // 4. D16 persistido: template de outra garantia (fallback da modalidade).
  if (plan.selection.garantiaMatched === false) {
    findings.push({
      severity: "warning",
      category: "template_fallback",
      message:
        plan.selection.templateNotice ??
        `O contrato foi gerado com o template padrão da modalidade — a garantia escolhida não tem modelo próprio.`,
      selectedText: `template:${plan.templateId}`,
      suggestedFix: "Envie o modelo da garantia em Templates para os próximos saírem com ele.",
    });
  }

  // 5. Cláusula veio da base da PLATAFORMA (a org não tinha uma usável).
  for (const resolved of plan.slots?.resolved ?? []) {
    if (resolved.fromPlatform) {
      findings.push({
        severity: "info",
        category: "clausula_plataforma",
        message:
          `A cláusula do slot de ${resolved.slot} veio da base da plataforma — a imobiliária ainda não tem cláusula própria para esta opção.`,
        selectedText: `platform:${resolved.slot}:${resolved.knowledgeItemId ?? ""}`,
      });
    }
  }

  return findings;
}

/**
 * Confere o laudo de preenchimento (`plan.fill`) — campos que o modelo pedia e
 * saíram em branco, e chaves que o sistema não produz. Não lê o documento: o
 * laudo foi medido no momento do replace, com `occurrencesChanged` da própria
 * API do Docs, que é mais confiável que reencontrar um vazio no texto.
 *
 * Obrigatório vazio → um aviso por campo (é o que o operador precisa corrigir
 * um a um). Opcionais vazios → UM aviso agregado; chaves desconhecidas → UM
 * aviso agregado. Sem isso, um modelo com dez chaves opcionais em branco
 * viraria dez comentários e enterraria o que importa.
 */
export function placeholderFillChecks(plan: GenerationPlan): ReviewFinding[] {
  const fill = plan.fill;
  if (!fill) return [];
  const findings: ReviewFinding[] = [];
  const label = (token: string) => labelForToken(token, plan.modalidade);

  for (const entry of fill.empty.filter((e) => e.required)) {
    findings.push({
      severity: "warning",
      category: "campo_obrigatorio_vazio",
      message:
        `O campo obrigatório «${label(entry.token)}» ({{${entry.token}}}) saiu EM BRANCO no contrato` +
        (entry.occurrences > 1 ? ` em ${entry.occurrences} trechos` : "") +
        ` — a geração não tinha esse dado.`,
      selectedText: `campo:${entry.token}`,
      suggestedFix:
        "Complete o dado no formulário e gere o contrato novamente, ou preencha o trecho diretamente no documento antes de aprovar.",
    });
  }

  const optional = fill.empty.filter((e) => !e.required);
  if (optional.length > 0) {
    const lista = optional.map((e) => `«${label(e.token)}» ({{${e.token}}})`).join(", ");
    findings.push({
      severity: "warning",
      category: "campo_vazio",
      message:
        (optional.length === 1
          ? `O campo ${lista} saiu em branco no contrato`
          : `${optional.length} campos saíram em branco no contrato: ${lista}`) +
        ` — a geração não tinha esse(s) dado(s).`,
      selectedText: `campos-vazios:${optional.map((e) => e.token).join(",")}`,
      suggestedFix:
        "Confira se o trecho faz sentido vazio. Se não, complete no formulário e gere novamente, ou edite o documento.",
    });
  }

  if (fill.unknown.length > 0) {
    const lista = fill.unknown.map((t) => `{{${t}}}`).join(", ");
    findings.push({
      severity: "warning",
      category: "chave_desconhecida",
      message:
        (fill.unknown.length === 1
          ? `O modelo pede a chave ${lista}, que o sistema não produz`
          : `O modelo pede ${fill.unknown.length} chaves que o sistema não produz: ${lista}`) +
        ` — o trecho correspondente foi apagado do contrato.`,
      selectedText: `chaves-desconhecidas:${fill.unknown.join(",")}`,
      suggestedFix:
        "No modelo (Templates → Chaves), troque a chave por uma do catálogo da modalidade ou escreva o trecho por extenso.",
    });
  }

  return findings;
}
