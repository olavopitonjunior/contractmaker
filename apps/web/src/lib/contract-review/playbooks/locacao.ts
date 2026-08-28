import type { ReviewPlaybook } from "./types";
import { REVIEW_CATEGORIES } from "./types";
import { REVIEW_PROMPT_BASE } from "./shared";

/**
 * Revisão de contratos de LOCAÇÃO — a família com taxonomia rica: tipo de
 * garantia é template de primeira classe, prestadora é cláusula injetada no
 * slot. O que o revisor cobra aqui espelha o que o motor decide
 * mecanicamente (matchCriteria.garantia + rankSlotCandidates).
 */
export const LOCACAO_REVIEW_PLAYBOOK: ReviewPlaybook = {
  family: "locacao",
  allowedCategories: REVIEW_CATEGORIES,
  maxFindings: 6,
  prompt: `${REVIEW_PROMPT_BASE}

ESPECÍFICO DE LOCAÇÃO:
- A GARANTIA é o eixo central: o tipo escolhido no formulário (fiador, caução, seguro fiança, garantia onerosa, título de capitalização, garantia própria, sem garantia) define o template e a cláusula. Se o texto tratar de garantia DIFERENTE da escolhida (ex.: qualificação de fiador num contrato de seguro fiança), é coerencia_juridica.
- A SEGURADORA/PRESTADORA escolhida no formulário deve ser a única nomeada nas cláusulas de garantia. Concorrente nomeada = estrutura_documento.
- Confira aluguel (valor por extenso E numérico), dia de vencimento, prazo/vigência, datas de início e fim, e as partes (locador, locatário, fiador quando houver) contra o resumo do formulário.
- Encargos e repasses (IPTU, condomínio, seguro incêndio) citados no texto devem ser compatíveis com o que o formulário declarou.
- ARMADILHA CONHECIDA: a cláusula de seguro contra INCÊNDIO cita "apólice"/"seguradora" em todos os contratos, inclusive nos sem seguro-fiança — isso NÃO é divergência de garantia.`,
};
