/**
 * Playbook de revisão pós-geração — o conhecimento do PROCESSO, versionado no
 * repo, no mesmo desenho de lib/ingestion/playbooks: o texto que o prompt PEDE
 * e os parâmetros que o guardrail COBRA saem do mesmo arquivo, senão o modelo
 * produz achados sistematicamente descartados e ninguém entende por quê.
 *
 * Módulo puro: sem prisma, sem rede.
 */

export const REVIEW_FAMILIES = ["locacao", "venda", "administracao"] as const;
export type ReviewFamily = (typeof REVIEW_FAMILIES)[number];

/**
 * Categorias de achado que o revisor pode produzir. Lidas pelo guardrail
 * (categoria fora da lista do playbook → descarte) e pelo dedupe do
 * ContractComment (`review:<categoria>`).
 */
export const REVIEW_CATEGORIES = [
  /** Dado do formulário divergente do texto (valor, data, nome, endereço). */
  "dados_form",
  /** Contradição interna ou incoerência jurídica básica do texto. */
  "coerencia_juridica",
  /** Estrutura do documento: numeração, seções faltantes/duplicadas, lógica
   *  de cláusulas e fornecedores no corpo. */
  "estrutura_documento",
] as const;
export type ReviewCategory = (typeof REVIEW_CATEGORIES)[number];

export interface ReviewPlaybook {
  family: ReviewFamily;
  /** Categorias válidas nesta família — o guardrail descarta o resto. */
  allowedCategories: readonly ReviewCategory[];
  /** Máximo de achados aceitos por revisão (precisão > cobertura). */
  maxFindings: number;
  /** Bloco ESTÁVEL do system prompt (cacheável — nada volátil aqui). */
  prompt: string;
}
