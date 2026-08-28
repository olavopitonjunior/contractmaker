import type { ReviewPlaybook } from "./types";
import { REVIEW_CATEGORIES } from "./types";
import { REVIEW_PROMPT_BASE } from "./shared";

/**
 * Revisão de contratos de VENDA (CCV) — o eixo é a forma de pagamento:
 * à vista × financiamento imobiliário, sinal/arras, FGTS, consórcio,
 * parcelas. Os analisadores determinísticos já validam o dataJson (somas,
 * formatos); aqui o revisor confere o TEXTO contra ele.
 */
export const VENDA_REVIEW_PLAYBOOK: ReviewPlaybook = {
  family: "venda",
  allowedCategories: REVIEW_CATEGORIES,
  maxFindings: 6,
  prompt: `${REVIEW_PROMPT_BASE}

ESPECÍFICO DE VENDA (CCV):
- A FORMA DE PAGAMENTO é o eixo central: valor total (por extenso E numérico), sinal/arras, recursos próprios, FGTS, financiamento imobiliário e parcelas descritos no texto devem bater com o resumo do formulário. Um CCV à vista com cláusula de financiamento (ou vice-versa) é coerencia_juridica.
- Confira as partes (vendedores, compradores, cônjuges quando declarados) e o(s) imóvel(is) — matrícula, endereço — contra o resumo.
- Datas: assinatura, entrega/posse e prazos de quitação citados no texto devem ser compatíveis entre si e com o formulário.
- Comissão de corretagem, quando presente no texto, deve corresponder ao que o formulário declarou (responsável e percentual/valor).`,
};
