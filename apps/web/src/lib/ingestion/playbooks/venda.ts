/**
 * Playbook de COMPRA E VENDA.
 *
 * Em venda o discriminador é a FORMA DE PAGAMENTO, e ela já é uma modalidade
 * (`a_vista` × `financiamento`) — não um eixo de `matchCriteria`. Por isso este
 * playbook não tem eixo nenhum e não tem slot: um CCV à vista e um com
 * alienação fiduciária são templates diferentes porque são MODALIDADES
 * diferentes, e a seleção na geração é feita por `deriveCategoryFromPayment`
 * sem olhar critério algum.
 *
 * A regra "fornecedor ⇒ cláusula" não se aplica: não há garantidor em venda. O
 * banco financiador aparece no contrato, mas ele é DADO do negócio (preenchido
 * pelo formulário), não uma variante de redação do acervo.
 */

import type { IngestionPlaybook } from "./types";

export const VENDA_PLAYBOOK: IngestionPlaybook = {
  family: "venda",
  modalidades: ["a_vista", "financiamento"],
  allowedSlots: [],
  criteriaAxes: [],
  requiresGarantia: false,
  prompt: `## Playbook — CONTRATO DE COMPRA E VENDA

### O que separa dois modelos aqui

A FORMA DE PAGAMENTO, e ela já é a modalidade:

- \`a_vista\` — compra e venda simples, permuta, outras formas sem alienação;
- \`financiamento\` — financiamento bancário, FGTS, consórcio, carta de crédito,
  qualquer contrato com alienação fiduciária.

Dois documentos que só diferem nisso são DOIS templates, cada um na sua
modalidade. Dois documentos na mesma modalidade que divergem muito no texto são
um sinal de acervo incompleto ou de dois instrumentos distintos — registre
\`grouping_ambiguous\` em vez de escolher um deles no escuro.

### Sem eixos de matchCriteria e sem slots

Nesta família \`matchCriteria\` sai VAZIO e \`slotBlocks\` não é usado. Não
proponha \`garantia\` aqui: garantia locatícia não existe em compra e venda, e
"alienação fiduciária" é modalidade, não garantia. Não proponha cláusula de
slot: sem slot declarado, uma cláusula gravada aqui nunca seria eleita por nada.

### Nome do banco financiador

O banco aparece no texto do CCV financiado, mas ele é DADO do negócio — o
formulário o preenche. Não trate banco como fornecedor: nada de cláusula
\`provider:\` nesta família.`,
};
