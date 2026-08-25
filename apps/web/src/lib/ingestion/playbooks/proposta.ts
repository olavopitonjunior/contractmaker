/**
 * Playbook de PROPOSTA (locação residencial/comercial e venda).
 *
 * Proposta é OFERTA, não instrumento definitivo — e é exatamente aí que a
 * triagem erra: um contrato de locação que cita "conforme a proposta de seguro"
 * já foi classificado como proposta e nasceu na modalidade errada. Por isso o
 * playbook começa pelo teste que separa os dois.
 *
 * O eixo `garantia` EXISTE aqui (a proposta de locação declara qual garantia o
 * proponente oferece), mas não é obrigatório: proposta que não declara garantia
 * é um documento legítimo, ao contrário do contrato.
 */

import type { IngestionPlaybook } from "./types";

export const PROPOSTA_PLAYBOOK: IngestionPlaybook = {
  family: "proposta",
  modalidades: [
    "proposta_locacao_residencial",
    "proposta_locacao_comercial",
    "proposta_venda",
  ],
  allowedSlots: ["garantia"],
  criteriaAxes: ["garantia", "fiadorPessoa", "pessoa"],
  requiresGarantia: false,
  prompt: `## Playbook — PROPOSTA (locação e venda)

### Primeiro: é mesmo uma proposta?

Proposta é OFERTA. Contrato é instrumento definitivo. O teste que decide:

- tem fecho de assinaturas em duas vias com testemunhas, cláusula de VIGÊNCIA e
  cláusula de RESCISÃO ⇒ é CONTRATO, mesmo que a palavra "proposta" apareça
  várias vezes no texto (contratos com seguro-fiança e título de capitalização
  citam "proposta de seguro" e "protocolo da proposta" o tempo todo);
- declara valor ofertado, condições e PRAZO DE VALIDADE da oferta, e chama a
  parte de "proponente" ⇒ é PROPOSTA.

Se o documento for contrato, não force a família: classifique como contrato e
registre \`classification_conflict\` se a heurística tiver dito outra coisa.

### O que separa dois modelos aqui

A modalidade (\`proposta_locacao_residencial\`, \`proposta_locacao_comercial\`,
\`proposta_venda\`) e, na proposta de locação, a GARANTIA que o proponente
oferece. Vale a mesma regra da locação: garantia diferente ⇒ template diferente,
com \`matchCriteria.garantia\` marcada.

A diferença para o contrato é que aqui a garantia NÃO é obrigatória: a proposta
que só registra a oferta, sem declarar garantia, é um modelo legítimo e sai com
\`matchCriteria\` vazio ou só com \`pessoa\`.

### Fornecedor

Se duas propostas de locação diferem apenas na seguradora nomeada, vale a regra
do fornecedor: UM template neutro + uma cláusula por fornecedor, com \`provider\`
como rótulo humano.

### Eixos permitidos aqui

\`garantia\`, \`fiadorPessoa\`, \`pessoa\`. NÃO use \`admImobiliaria\`: na
proposta esse dado ainda nem foi coletado, e marcá-lo desclassificaria o modelo
em todo formulário que não o declarasse.

### Slot permitido aqui

Apenas \`garantia\`.`,
};
