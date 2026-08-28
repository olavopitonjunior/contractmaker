import type { ReviewPlaybook } from "./types";
import { REVIEW_CATEGORIES } from "./types";
import { REVIEW_PROMPT_BASE } from "./shared";

/**
 * Revisão de PROPOSTAS (compra ou locação) — documento PRÉ-contratual,
 * revisado sobre o snapshot congelado no ENVIO (a proposta não tem Google
 * Doc nem versões; o achado é registro de auditoria na timeline e insumo
 * para uma recriação corrigida, nunca um gate).
 */
export const PROPOSTA_REVIEW_PLAYBOOK: ReviewPlaybook = {
  family: "proposta",
  allowedCategories: REVIEW_CATEGORIES,
  maxFindings: 6,
  prompt: `${REVIEW_PROMPT_BASE}

ESPECÍFICO DE PROPOSTA:
- Este é um documento PRÉ-CONTRATUAL: não exija cláusulas de contrato definitivo (vistoria, foro extenso, rescisão detalhada) — a ausência delas NÃO é achado.
- O eixo são as CONDIÇÕES propostas: valor (por extenso E numérico), forma de pagamento (venda: à vista/financiamento, sinal/arras; locação: aluguel, prazo, garantia), validade da proposta e comissão devem bater com o resumo do formulário.
- PARTES (proponente e proprietário/vendedor) e imóvel contra o resumo — nome, documento, endereço.
- Datas coerentes: emissão, validade e datas de condição não podem se contradizer.
- A proposta foi ENVIADA — o achado serve para o corretor recriar uma versão corrigida; em "suggestedFix", aponte a recriação da proposta com o dado certo.`,
};
