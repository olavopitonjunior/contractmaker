import type { ReviewPlaybook } from "./types";
import { REVIEW_CATEGORIES } from "./types";
import { REVIEW_PROMPT_BASE } from "./shared";

/**
 * Revisão de contratos de ADMINISTRAÇÃO DE LOCAÇÃO — instrumento
 * imobiliária ↔ proprietário. Sem garantia locatícia e sem slots de
 * cláusula: o eixo é a prestação de serviço (taxa de administração,
 * repasses, exclusividade, poderes de representação).
 */
export const ADMINISTRACAO_REVIEW_PLAYBOOK: ReviewPlaybook = {
  family: "administracao",
  allowedCategories: REVIEW_CATEGORIES,
  maxFindings: 6,
  prompt: `${REVIEW_PROMPT_BASE}

ESPECÍFICO DE ADMINISTRAÇÃO DE LOCAÇÃO:
- As PARTES são a imobiliária (administradora/contratada) e o(s) proprietário(s) (contratante). Locatário e garantia locatícia NÃO são partes deste instrumento — cláusula que trate fiador/caução/seguro-fiança como obrigação DESTE contrato é coerencia_juridica.
- O eixo é a prestação de serviço: taxa de administração (percentual), forma e prazo de repasse ao proprietário, exclusividade (ou não) e prazo de vigência devem bater com o resumo do formulário.
- Qualificação da administradora (razão social, CNPJ, CRECI) e do(s) proprietário(s) contra o resumo.
- Poderes conferidos à administradora (receber aluguéis, dar quitação, ajuizar) devem ser coerentes entre as cláusulas — um poder citado numa cláusula e negado noutra é coerencia_juridica.`,
};
