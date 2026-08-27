/**
 * Playbook de CONTRATO DE ADMINISTRAÇÃO (imobiliária ↔ proprietário).
 *
 * Família própria, e não um caso da locação, pelo mesmo motivo que
 * `administracao_locacao` é uma modalidade que NÃO começa com "locacao" em
 * `template-category.ts`: é outro INSTRUMENTO, entre outras partes, com gerador
 * próprio. Gerar o contrato do inquilino com o modelo de administração produz
 * um documento que não vincula quem assina.
 *
 * Consequência para o planner: aqui não existe garantia locatícia (quem dá
 * garantia é o locatário, que não é parte deste contrato) e não existe slot.
 */

import type { IngestionPlaybook } from "./types";

export const ADMINISTRACAO_PLAYBOOK: IngestionPlaybook = {
  family: "administracao",
  modalidades: ["administracao_locacao"],
  allowedSlots: [],
  criteriaAxes: [],
  requiresGarantia: false,
  prompt: `## Playbook — CONTRATO DE ADMINISTRAÇÃO DE LOCAÇÃO

### Que documento é este

O contrato entre a IMOBILIÁRIA e o PROPRIETÁRIO, que autoriza a administração do
imóvel: taxa de administração, repasse do aluguel, prestação de contas, poderes
de representação. O locatário não é parte dele.

### Um só template por org, em regra

A imobiliária costuma ter um único modelo de administração. Se o lote trouxer
mais de um documento desta família, verifique se não são versões do mesmo modelo
(uma revisada, outra antiga): nesse caso proponha UM template, a partir do
documento mais completo, e descarte o outro com \`duplicate\`. Se forem de fato
diferentes (por exemplo, administração com e sem garantia de recebimento),
proponha os dois e explique a diferença no \`rationale\` de cada um.

### Sem garantia, sem eixo, sem slot

\`matchCriteria\` sai VAZIO. Não proponha \`garantia\`: a garantia locatícia é
do contrato de locação, não deste. Não proponha \`slotBlocks\` nem cláusulas de
slot — não há slot declarado nesta família, e a cláusula ficaria órfã no acervo.`,
};
