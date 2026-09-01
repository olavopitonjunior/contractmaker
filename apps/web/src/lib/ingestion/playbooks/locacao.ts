/**
 * Playbook de LOCAÇÃO — a família onde as duas regras de produto valem.
 *
 * As duas regras (ditadas pelo dono em 25/08/2026):
 *
 *   1. Garantia diferente ⇒ TEMPLATE FÍSICO diferente.
 *   2. Só o fornecedor muda ⇒ MESMA base + CLÁUSULA com `provider:<slug>`.
 *
 * Os few-shots abaixo são trechos REAIS do corpus da Ativa (as quatro minutas
 * residenciais de `lib/templates/__tests__/fixtures/ativa-residencial/`), com o
 * elenco já fictício. Estão aqui em vez de exemplos inventados porque é
 * exatamente a redação real que confunde: a cláusula de seguro contra INCÊNDIO
 * cita "apólice" em todos os quatro contratos — inclusive no de fiador — e um
 * exemplo sintético nunca reproduziria essa armadilha.
 */

import type { IngestionPlaybook } from "./types";

/** Trecho literal de `03-RES-PORTO-SEGURO.txt` (cláusula décima quinta). */
const FEWSHOT_SEGURO_FIANCA =
  "Cláusula décima quinta: O seguro de Fiança Locatícia contratado pelo LOCADOR " +
  "junto à PORTO SEGURO CIA. DE SEGUROS GERAIS, em que a vigência inicial será a " +
  "data de protocolo da proposta ou data distinta acordada entre as partes e a " +
  "vigência final será a data do término do contrato de locação, garantirá esta " +
  "locação, nos termos do inciso III, do artigo 37 da Lei do Inquilinato.";

/** Trecho literal de `01-RES-FIADOR.txt` (cláusula décima quinta). */
const FEWSHOT_FIADOR =
  "Cláusula décima quinta: ASSINA ESTE CONTRATO NA CONDIÇÃO DE FIADOR E DEVEDOR " +
  "SOLIDÁRIO COM O LOCATÁRIO, POR TODAS OBRIGAÇÕES POR ESTE ASSUMIDAS: [NOME], " +
  "brasileiro, casado, comerciante (…), que dá em prova de solvência o imóvel " +
  "registrado na matrícula nº. 99.002.";

/** Trecho literal de `04-RES-TITULO-CAPITALIZACAO.txt` (cláusula décima quinta). */
const FEWSHOT_TITULO =
  "Cláusula décima quinta: Como garantia da presente locação, apresenta o " +
  "LOCATÁRIO(A) um TÍTULO DE CAPITALIZAÇÃO no valor de R$ 8.400,00 no banco " +
  "Bradesco, com a Proposta nº 80000123 à MAPFRE Capitalização S.A.";

export const LOCACAO_PLAYBOOK: IngestionPlaybook = {
  family: "locacao",
  modalidades: ["locacao", "locacao_comercial", "temporada"],
  allowedSlots: ["garantia"],
  criteriaAxes: ["garantia", "fiadorPessoa", "pessoa", "admImobiliaria"],
  requiresGarantia: true,
  prompt: `## Playbook — CONTRATO DE LOCAÇÃO

### Regra 1: garantia diferente ⇒ template físico diferente

Fiador, caução, seguro-fiança, título de capitalização, garantia onerosa e "sem
garantia" produzem CONTRATOS DIFERENTES, não variações de um contrato. Cada
template de locação que você propuser tem de trazer \`matchCriteria.garantia\`
preenchida com o valor canônico da garantia daquele documento — é ela que faz o
formulário eleger o modelo certo na hora de gerar. Template de locação sem
\`matchCriteria.garantia\` é plano inválido.

Exemplos reais de cláusula de garantia, para você reconhecer cada tipo:

- seguro_fianca — "${FEWSHOT_SEGURO_FIANCA}"
- fiador — "${FEWSHOT_FIADOR}"
- titulo_capitalizacao — "${FEWSHOT_TITULO}"

ARMADILHA CONHECIDA: todo contrato de locação traz uma cláusula de
SEGURO CONTRA INCÊNDIO que cita "apólice" e "seguradora". Ela não é garantia —
aparece igual nos quatro contratos do acervo, inclusive no de fiador. Nunca
classifique um contrato como seguro-fiança por causa dela.

### Regra 2: só o fornecedor muda ⇒ mesma base + cláusula

Quando dois documentos têm a MESMA garantia e diferem apenas em qual empresa a
presta (Porto Seguro × Tokio Marine × Pottencial × TOO no seguro-fiança;
Almada × Loft × CredAluga na garantia onerosa), eles são o MESMO modelo. Proponha
UM template a partir de um deles e uma CLÁUSULA por fornecedor.

Consequência direta: o template é NEUTRO DE FORNECEDOR. Se o documento que você
escolheu como base nomeia a seguradora/garantidora no corpo, o trecho tem de sair
do corpo:

- se ele é a cláusula de garantia, liste os parágrafos LITERAIS em
  \`slotBlocks.garantia\` — eles viram o espaço \`{{slot_garantia}}\` e a redação
  certa entra na geração;
- se ele é outro trecho que menciona o fornecedor de passagem (no corpus real,
  a cláusula de pintura interna cita "Porto Seguro"), registre uma issue
  \`provider_in_template\` apontando o item. Não invente slot novo para isso.

O nome do fornecedor sai no campo \`provider\` da cláusula como RÓTULO HUMANO
("Porto Seguro", "Tokio Marine"), nunca como slug — quem slugifica é o executor.

### Regra 3: descubra o padrão DESTE acervo

Não presuma. Uma imobiliária tem quatro minutas estruturalmente diferentes, uma
por garantia; outra tem uma base só, variando o fornecedor; uma terceira mistura
as duas coisas. Leia a matriz de similaridade do lote e decida a partir dela.
Quando o lote não encaixar em nenhum dos dois padrões — dois documentos com a
MESMA garantia e o MESMO fornecedor divergindo muito, ou um grupo cuja maior
divergência não é a cláusula de garantia — registre \`grouping_ambiguous\` com o
que você observou. Registrar o desvio é o comportamento correto; inventar uma
taxonomia fora dos valores canônicos, não.

### Eixos de matchCriteria permitidos aqui

\`garantia\` (obrigatória), \`fiadorPessoa\`, \`pessoa\`, \`admImobiliaria\`. Marque
um eixo além da garantia SOMENTE quando o documento o declarar sem ambiguidade —
um eixo marcado por engano DESCLASSIFICA o modelo em todo formulário que
escolher o outro valor, e o operador volta a trocar o template à mão.

Para \`admImobiliaria\`, a evidência é a linha \`administracao=\` de cada item
(\`imobiliaria\` → true, \`direta\` → false, \`?\` → deixe null): quem a
escreveu leu o documento inteiro, e o índice de blocos pode não trazer a
cláusula de pagamento. Documentos com \`administracao\` diferente NÃO são
duplicatas um do outro — são variantes do mesmo modelo, uma por valor do eixo.

### Slot permitido aqui

Apenas \`garantia\`.`,
};
