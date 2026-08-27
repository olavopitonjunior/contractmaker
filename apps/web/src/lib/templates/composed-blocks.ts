import { renderContratoHTML } from "@/lib/render/handlebars";

// ============================================================================
// Blocos compostos pra templates engine="google_docs": resolvem loops e
// condicionais SERVER-SIDE e viram TEXTO PLANO (o replaceAllText do Docs
// insere texto, não HTML; `\n` vira quebra de parágrafo herdando o estilo do
// parágrafo onde o token estava — exatamente o que preserva o layout do
// modelo da imobiliária).
//
// Os blocos são snippets Handlebars extraídos LITERALMENTE dos templates v3
// (locacao_residencial_v3.hbs) e renderizados com os mesmos helpers — a
// paridade texto é travada por teste (template-parity.test.ts).
// ============================================================================

/** Converte o HTML mínimo dos snippets (<p>, <br>) em texto plano. */
export function htmlToPlainText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>\s*<p[^>]*>/gi, "\n")
    .replace(/<\/?p[^>]*>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function renderBlock(src: string, data: Record<string, unknown>): string {
  return htmlToPlainText(renderContratoHTML(src, data));
}

// Fragmento de qualificação por pessoa — idêntico ao preâmbulo dos v3.
const PESSOA_HBS = `{{#if (eq this.tipo_pessoa "fisica")}}{{this.nome}}{{#if (existe this.nacionalidade)}}, {{this.nacionalidade}}{{/if}}{{#if (existe this.estado_civil)}}, {{this.estado_civil}}{{/if}}{{#if (existe this.profissao)}}, {{this.profissao}}{{/if}}{{#if (existe this.rg)}}, portador(a) da cédula de identidade RG nº {{this.rg}}{{/if}}{{#if (existe this.cpf)}}, inscrito(a) no CPF/MF sob nº {{cpf this.cpf}}{{/if}}{{#if (existe this.endereco)}}, residente e domiciliado(a) na {{this.endereco}}, nº {{this.numero}}{{#if this.complemento}}, {{this.complemento}}{{/if}}{{#if this.bairro}}, {{this.bairro}}{{/if}}{{#if (existe this.cep)}}, CEP {{cep this.cep}}{{/if}}{{#if (existe this.cidade)}}, {{this.cidade}}/{{this.uf}}{{/if}}{{/if}}{{#if (existe this.email)}}, endereço eletrônico e-mail {{this.email}}{{/if}}{{else}}{{this.razao_social}}, pessoa jurídica de direito privado, inscrita no CNPJ/MF sob nº {{cnpj this.cnpj}}{{#if (existe this.endereco)}}, com sede na {{this.endereco}}, nº {{this.numero}}{{#if this.complemento}}, {{this.complemento}}{{/if}}{{#if this.bairro}}, {{this.bairro}}{{/if}}{{#if (existe this.cep)}}, CEP {{cep this.cep}}{{/if}}{{#if (existe this.cidade)}}, {{this.cidade}}/{{this.uf}}{{/if}}{{/if}}{{#if this.representante.nome}}, neste ato representada por {{this.representante.nome}}, inscrito(a) no CPF/MF sob nº {{cpf this.representante.cpf}}{{/if}}{{/if}}`;

// Outorga uxória — sufixo apenso DEPOIS do bloco PF/PJ (PJ nunca tem
// `conjuge.nome`, então o `if` fecha vazio lá). Desde 2026-07-24 vale também
// pra locação: antes só venda qualificava o cônjuge, e um locador casado
// assinava sem a anuência do consorte. Precisa ser idêntico ao sufixo que os
// `.hbs` v3 usam — `placeholder-map.test.ts` exige que a saída de
// `qualificacaoPessoas` seja substring do contrato renderizado.
// O gate por estado civil evita que um ex-cônjuge deixado no dataJson volte a
// ser qualificado — trocar o estado civil no form esconde os campos mas não
// apaga o sub-objeto. Usa o helper `temConjuge`, que compartilha a
// implementação com os mappers ClickSign (lib/forms/estado-civil.ts): manter a
// regra escrita em Handlebars literal fazia as camadas discordarem sobre quem
// é casado, e o cônjuge assinava um contrato onde não era qualificado.
const TEM_CONJUGE_HBS = (p: string) => `{{#if (temConjuge ${p}.estado_civil)}}`;

/**
 * Exportado pra `placeholder-map.test.ts` travar a paridade com os `.hbs`:
 * o teste de substring do render passaria mesmo se as duas fontes divergissem
 * em ordem de condições.
 */
export const CONJUGE_SUFFIX_HBS = `{{#if this.conjuge.nome}}${TEM_CONJUGE_HBS("this")}, casado(a) com {{this.conjuge.nome}}{{#if (existe this.conjuge.cpf)}}, inscrito(a) no CPF/MF sob nº {{cpf this.conjuge.cpf}}{{/if}}{{/if}}{{/if}}`;

const PESSOA_COM_CONJUGE_HBS = `${PESSOA_HBS}${CONJUGE_SUFFIX_HBS}`;

const PESSOAS_HBS = `{{#each pessoas}}${PESSOA_COM_CONJUGE_HBS}{{#unless @last}}; {{/unless}}{{/each}}`;

/** Qualificação narrativa de uma lista de partes (PF/PJ), separada por "; ". */
export function qualificacaoPessoas(pessoas: unknown[]): string {
  if (!Array.isArray(pessoas) || pessoas.length === 0) return "";
  return renderBlock(PESSOAS_HBS, { pessoas });
}

// Venda e locação convergiram no mesmo fragmento; a função separada continua
// existindo porque `placeholder-map.ts` usa nomes distintos por módulo.
const PESSOAS_VENDA_HBS = PESSOAS_HBS;

export function qualificacaoPessoasVenda(pessoas: unknown[]): string {
  if (!Array.isArray(pessoas) || pessoas.length === 0) return "";
  return renderBlock(PESSOAS_VENDA_HBS, { pessoas });
}

const FIADOR_HBS = `{{#if (eq garantia.tipo "fiador")}}{{#if (eq garantia.fiador.tipo_pessoa "juridica")}}{{garantia.fiador.razao_social}}, pessoa jurídica de direito privado, inscrita no CNPJ/MF sob nº {{cnpj garantia.fiador.cnpj}}{{else}}{{garantia.fiador.nome}}{{#if (existe garantia.fiador.nacionalidade)}}, {{garantia.fiador.nacionalidade}}{{/if}}{{#if (existe garantia.fiador.estado_civil)}}, {{garantia.fiador.estado_civil}}{{/if}}{{#if (existe garantia.fiador.rg)}}, portador(a) da cédula de identidade RG nº {{garantia.fiador.rg}}{{/if}}{{#if (existe garantia.fiador.cpf)}}, inscrito(a) no CPF/MF sob nº {{cpf garantia.fiador.cpf}}{{/if}}{{#if (existe garantia.fiador.endereco)}}, residente e domiciliado(a) na {{garantia.fiador.endereco}}, nº {{garantia.fiador.numero}}, {{garantia.fiador.cidade}}/{{garantia.fiador.uf}}{{/if}}{{#if garantia.fiador.conjuge.nome}}${TEM_CONJUGE_HBS("garantia.fiador")}, casado(a) com {{garantia.fiador.conjuge.nome}}{{#if (existe garantia.fiador.conjuge.cpf)}}, inscrito(a) no CPF/MF sob nº {{cpf garantia.fiador.conjuge.cpf}}{{/if}}{{/if}}{{/if}}{{/if}}{{/if}}`;

export function qualificacaoFiador(data: Record<string, unknown>): string {
  return renderBlock(FIADOR_HBS, data);
}

// Cláusula de garantia — switch idêntico ao 8.x do locacao_residencial_v3.hbs.
const GARANTIA_HBS = `{{#if (eq garantia.tipo "titulo_capitalizacao")}}
<p>8.1. Para garantir as obrigações assumidas neste contrato, a PARTE LOCATÁRIA, por ser de seu interesse, dá neste ato, em caução à PARTE LOCADORA o Título de Capitalização{{#if (gt garantia.titulo_valor 0)}} no valor nominal de {{moeda garantia.titulo_valor}} ({{extenso garantia.titulo_valor}}){{/if}}{{#if garantia.provider}} subscrito pela {{garantia.provider}}{{/if}}{{#if (existe garantia.titulo_proposta)}}, representado pela proposta/formulário n.º {{garantia.titulo_proposta}}{{/if}}.</p>
<p>8.2. Ao término do prazo de vigência do Título, a PARTE LOCATÁRIA autoriza a {{#if garantia.provider}}{{garantia.provider}}{{else}}Sociedade de Capitalização{{/if}}, a REAPLICAR o valor de resgate, sempre em seu nome, dando origem a novo Título com as mesmas Condições Gerais dos Títulos inicialmente adquirido, sendo que este permanecerá como caução à locação supra referida até a efetiva desocupação do imóvel e entrega das chaves.</p>
<p>8.3. A PARTE LOCATÁRIA se responsabiliza em comunicar qualquer alteração cadastral ou então se manifestar contrariamente à reaplicação do título, com no mínimo 15 (quinze) dias de antecedência da data do vencimento do título.</p>
<p>8.4. Ao término do prazo de locação, desde que cumpridas pela PARTE LOCATÁRIA todas as obrigações decorrentes deste contrato, inclusive, a desocupação do imóvel e entrega das chaves sem a existência de qualquer débito, será liberado junto à {{#if garantia.provider}}{{garantia.provider}}{{else}}Sociedade de Capitalização{{/if}} a caução do(s) Título(s), apresentando(s). Para tanto, deverá ser apresentado documento rescisório da locação firmado pela PARTE LOCADORA e PARTE LOCATÁRIA, com o reconhecimento de firma das assinaturas, bem como outros documentos requeridos pela Sociedade de Capitalização.</p>
<p>8.5. Se a PARTE LOCATÁRIA não observar quaisquer das cláusulas do presente contrato, fica, desde já, a PARTE LOCADORA autorizada a resgatar o(s) Título(s) caucionado(s), a qualquer momento, mesmo antes do prazo final de capitalização, inclusive com a correção devida, independentemente de interpelação judicial ou extrajudicial, a fim de que o valor do resgate quite eventual importância que lhe seja devida em razão de débitos oriundos deste contrato, respeitando os termos descritos nas condições gerais do título de capitalização.</p>
<p>8.6. Se por acaso a PARTE LOCATÁRIA contestar o valor apresentado e ajuizar a competente ação cautelar de prestação de contas, correrão por conta dos mesmos todas as despesas consequentes, inclusive custas e honorários advocatícios.</p>
{{else if (eq garantia.tipo "fiador")}}
<p>8.1. Para garantir as obrigações assumidas neste contrato, o(a) FIADOR(A) qualificado(a) no preâmbulo assume responsabilidade solidária com a PARTE LOCATÁRIA, com expressa renúncia ao benefício de ordem (arts. 827 e 838 do Código Civil), respondendo até a efetiva entrega das chaves, ainda que a locação se prorrogue por prazo indeterminado.</p>
{{else if (eq garantia.tipo "caucao")}}
<p>8.1. Para garantir as obrigações assumidas neste contrato, a PARTE LOCATÁRIA dá neste ato, a título de caução, o equivalente a {{garantia.caucao_meses}} ({{numeroExtenso garantia.caucao_meses}}) aluguéis, nos termos do art. 38 da Lei nº 8.245/91, a ser restituído ao final da locação, deduzidos eventuais débitos e danos apurados em vistoria.</p>
{{else if (eq garantia.tipo "seguro_fianca")}}
<p>8.1. Para garantir as obrigações assumidas neste contrato, a locação é garantida por seguro de fiança locatícia{{#if garantia.provider}} contratado junto a {{garantia.provider}}{{/if}}, cujas condições e apólice integram este contrato.</p>
{{else if (eq garantia.tipo "garantia_onerosa")}}
<p>8.1. Para garantir as obrigações assumidas neste contrato, a locação é garantida por garantia locatícia onerosa{{#if garantia.provider}} prestada por {{garantia.provider}}{{/if}}, na forma do respectivo termo de adesão, que integra este contrato.</p>
{{else if (eq garantia.tipo "sem_garantia")}}
<p>8.1. As partes ajustam a presente locação sem modalidade de garantia, nos termos do art. 37 da Lei nº 8.245/91.</p>
{{else}}
<p>8.1. A locação é garantida na modalidade ajustada entre as partes, observado o art. 37 da Lei nº 8.245/91.</p>
{{/if}}`;

/** Cláusula de garantia integral (multi-parágrafo) conforme o tipo. */
export function clausulaGarantia(data: Record<string, unknown>): string {
  return renderBlock(GARANTIA_HBS, data);
}

/**
 * A MESMA cláusula, em HTML (sem o achatamento pra texto plano).
 *
 * É o fallback do slot de garantia (`lib/templates/clause-slots.ts`) quando o
 * template consolidado declara `{{{slot_garantia}}}` mas o acervo do tenant não
 * tem cláusula pra opção escolhida no form: o contrato sai com a condicional
 * embutida do canônico, exatamente como antes de existir slot.
 */
export function clausulaGarantiaHtml(data: Record<string, unknown>): string {
  return renderContratoHTML(GARANTIA_HBS, data);
}

const ADMINISTRADORA_HBS = `{{#if (existe config.administradora_nome)}}
<p>Os aluguéis e demais encargos da locação deverão ser pagos pela PARTE LOCATÁRIA até o dia {{aluguel.dia_vencimento}} ({{numeroExtenso aluguel.dia_vencimento}}) de cada mês vencido para {{config.administradora_nome}}{{#if (existe config.administradora_creci)}}, regularmente inscrita no CRECI sob nº {{config.administradora_creci}}{{/if}}{{#if (existe config.administradora_endereco)}}, com sede na {{config.administradora_endereco}}{{/if}}, empresa nomeada para exercer a administração da presente locação (doravante "ADMINISTRADORA").</p>
{{else}}
<p>Os aluguéis e demais encargos da locação deverão ser pagos pela PARTE LOCATÁRIA até o dia {{aluguel.dia_vencimento}} ({{numeroExtenso aluguel.dia_vencimento}}) de cada mês vencido, diretamente à PARTE LOCADORA ou a quem esta indicar.</p>
{{/if}}`;

export function blocoAdministradora(data: Record<string, unknown>): string {
  return renderBlock(ADMINISTRADORA_HBS, data);
}

// Linha de assinatura do cônjuge logo abaixo da do titular — outorga uxória.
// Os `.hbs` v3 têm o equivalente com o papel explícito ("CÔNJUGE DA PARTE
// LOCATÁRIA") e com `style`; aqui não há paridade literal exigida, porque
// `blocoAssinaturas` só alimenta os templates de engine `google_docs` (o texto
// é achatado por htmlToPlainText antes de virar placeholder).
const ASSINATURA_CONJUGE_HBS = `{{#if this.conjuge.nome}}${TEM_CONJUGE_HBS("this")}<p>____________________________________________<br>{{this.conjuge.nome}}<br>CÔNJUGE</p>{{/if}}{{/if}}`;

const ASSINATURAS_HBS = `{{#each locatarios}}<p>____________________________________________<br>{{#if (eq this.tipo_pessoa "fisica")}}{{this.nome}}{{else}}{{this.razao_social}}{{/if}}<br>PARTE LOCATÁRIA</p>${ASSINATURA_CONJUGE_HBS}{{/each}}{{#each locadores}}<p>____________________________________________<br>{{#if (eq this.tipo_pessoa "fisica")}}{{this.nome}}{{else}}{{this.razao_social}}{{/if}}<br>PARTE LOCADORA</p>${ASSINATURA_CONJUGE_HBS}{{/each}}{{#if (eq garantia.tipo "fiador")}}<p>____________________________________________<br>{{#if (eq garantia.fiador.tipo_pessoa "juridica")}}{{garantia.fiador.razao_social}}{{else}}{{garantia.fiador.nome}}{{/if}}<br>FIADOR(A)</p>{{#if garantia.fiador.conjuge.nome}}${TEM_CONJUGE_HBS("garantia.fiador")}<p>____________________________________________<br>{{garantia.fiador.conjuge.nome}}<br>CÔNJUGE DO(A) FIADOR(A)</p>{{/if}}{{/if}}{{/if}}<p>____________________________________________<br>Nome:<br>CPF:<br>Testemunha</p><p>____________________________________________<br>Nome:<br>CPF:<br>Testemunha</p>`;

export function blocoAssinaturas(data: Record<string, unknown>): string {
  return renderBlock(ASSINATURAS_HBS, data);
}

// Parcelas de venda — uma linha por parcela com letra/numero conforme enrich.
const PARCELAS_HBS = `{{#each pagamento.parcelas}}<p>{{#if this.letra}}{{this.letra}}){{else}}{{#if this.numero}}Parcela {{this.numero}}.{{/if}}{{/if}} {{moeda this.valor}} ({{extenso this.valor}}){{#if (existe this.tipo_texto)}} — {{this.tipo_texto}}{{/if}}{{#if (existe this.momento_texto)}}, {{this.momento_texto}}{{/if}}{{#if (existe this.momento_data_texto)}}, {{this.momento_data_texto}}{{/if}}{{#if (existe this.meio_pagamento_texto)}}, mediante {{this.meio_pagamento_texto}}{{/if}}{{#if (existe this.destino_texto)}} ({{this.destino_texto}}){{/if}}.</p>{{/each}}`;

export function parcelasPagamento(data: Record<string, unknown>): string {
  return renderBlock(PARCELAS_HBS, data);
}

/** Avalia uma expressão Handlebars simples contra os dados (usa os helpers
 *  BR registrados — moeda, extenso, cep, dataExtenso…). */
export function hbsExpr(expr: string, data: Record<string, unknown>): string {
  return htmlToPlainText(renderContratoHTML(`{{${expr}}}`, data));
}
