/**
 * Resumo consolidado do formulário a partir do `dataJson`. Puro: não chama
 * rede nem DB.
 *
 * Venda (compra_venda_v1): estende `buildNegotiationSummary` (Pagamento/
 * Comissão/Condições) com Partes, Imóveis, Config e Documentos anexados.
 * Locação (locacao_residencial_v1 / locacao_comercial_v1, 2026-08): seções
 * próprias — Partes, Imóvel, Aluguel e Reajuste, Garantia, Observações,
 * Documentos — porque o dataJson tem outra estrutura (locadores/locatarios/
 * garantia/aluguel). SchemaType desconhecido → [].
 *
 * Defensivo: todo acesso é opcional, então funciona com forms parciais.
 */

import {
  buildNegotiationSummary,
  type SummarySection,
  type SummaryRow,
} from "@/lib/forms/negotiation-summary";
import { GARANTIA_LABELS, normalizeGarantiaTipo } from "@/lib/contracts/template-category";
import { rendaOrigemLabel } from "@/lib/fichacerta/renda-origens";
import { LOCACAO_SCHEMA_TYPES } from "@/lib/forms/validation-locacao";
import { TIPO_IMOVEL_TEXTO } from "@/lib/locacao/enrich";

type AnyObj = Record<string, unknown>;
const obj = (v: unknown): AnyObj => (v && typeof v === "object" ? (v as AnyObj) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

const onlyDigits = (v: unknown): string => str(v).replace(/\D/g, "");

/**
 * Valor em BRL. Zero e não-numérico viram "" de propósito: quase todo campo de
 * dinheiro do form tem `.default(0)` no Zod, então zero significa "não
 * preenchido" e não "R$ 0,00" — imprimir o zero encheria o resumo de linhas
 * que são artefato de schema.
 */
function brl(v: unknown): string {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n) || n === 0) return "";
  return `R$ ${n.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`;
}

/** Código da tabela de origem de renda → rótulo; código desconhecido sai cru. */
function origemRenda(v: unknown): string {
  if (v === undefined || v === null || v === "") return "";
  return rendaOrigemLabel(v as number | string) ?? String(v);
}

/**
 * Renda/faturamento de uma parte de LOCAÇÃO — insumo da análise de crédito
 * (renda × aluguel, origem da renda na Ficha Certa). Uma função só para
 * locatário, locador e fiador: os três mostravam a renda por código repetido
 * e a origem e a "outra renda" (2026-09) entrariam em um e faltariam no outro.
 */
function rendaRows(parte: AnyObj): SummaryRow[] {
  const rows: SummaryRow[] = [];
  pushIf(rows, "Renda mensal declarada", brl(parte.renda_mensal));
  pushIf(rows, "Origem da renda", origemRenda(parte.renda_origem));
  pushIf(rows, "Outra renda", brl(parte.renda_outra_valor));
  pushIf(rows, "Origem da outra renda", origemRenda(parte.renda_outra_origem));
  pushIf(rows, "Faturamento mensal", brl(parte.faturamento_mensal));
  return rows;
}

function cpf(v: unknown): string {
  const d = onlyDigits(v);
  if (d.length !== 11) return str(v);
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

function cnpj(v: unknown): string {
  const d = onlyDigits(v);
  if (d.length !== 14) return str(v);
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

function cep(v: unknown): string {
  const d = onlyDigits(v);
  if (d.length !== 8) return str(v);
  return `${d.slice(0, 5)}-${d.slice(5)}`;
}

/**
 * dd/mm/yyyy a partir de "YYYY-MM-DD". Ancora ao meio-dia pra não deslizar um
 * dia em UTC-3 (memória feedback_date_parse_timezone).
 */
function dateBR(v: unknown): string {
  const s = str(v);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return s;
  const [, y, mo, d] = m;
  return `${d}/${mo}/${y}`;
}

/**
 * Rótulos dos enums que o formulário grava como slug. Sem eles o resumo imprime
 * "comercial_sala", "paga_e_retem", "retem_imobiliaria" — exatamente o defeito
 * que o TEXTO do contrato já tinha corrigido via `enrichLocacaoData`, e que
 * seguia visível na tela e no PDF. Valor fora do mapa cai no próprio slug com
 * os underscores trocados por espaço, nunca em vazio.
 */
export const ENUM_LABELS: Record<string, Record<string, string>> = {
  indice_reajuste: { IGPM: "IGP-M", IPCA: "IPCA", outro: "Outro" },
  meio_pagamento_aluguel: { pix: "PIX", boleto: "Boleto bancário", qualquer: "PIX ou boleto" },
  encargos_repasse: {
    paga_e_retem: "Imobiliária paga e retém no repasse",
    repasse_integral: "Repassados integralmente no boleto do locatário",
  },
  seguro_tomador: { inquilino: "Locatário", proprietario: "Locador" },
  seguro_vigencia: { anual_renovavel: "Anual renovável", prazo_contrato: "Prazo do contrato" },
  regime_ir: {
    nao_retem: "Não retém",
    retem_sem_controle: "Retém (sem controle)",
    retem_imobiliaria: "Retido pela imobiliária",
    retem_inquilino: "Retido pelo locatário",
  },
  regime_cobranca: { mes_vencido: "Mês vencido", mes_a_vencer: "Mês a vencer" },
  repasse_garantido: {
    nao: "Não",
    alguns_meses: "Alguns meses",
    todo_contrato: "Todo o contrato",
  },
  tipo_conta: { corrente: "Conta corrente", poupanca: "Poupança" },
  parcela_momento: {
    assinatura: "na assinatura",
    escritura: "na escritura",
    registro: "no registro",
    data_exata: "em data definida",
    contrato_financiamento: "no contrato de financiamento",
  },
  parcela_meio: {
    pix: "PIX",
    ted: "TED",
    transferencia: "Transferência",
    dinheiro: "Dinheiro",
    cheque: "Cheque",
    boleto: "Boleto",
  },
};

function enumLabel(group: string, v: unknown): string {
  const raw = str(v);
  if (!raw) return "";
  return ENUM_LABELS[group]?.[raw] ?? raw.replace(/_/g, " ");
}

/** Tipo do imóvel com a inicial maiúscula — o mapa é escrito para o meio da frase. */
function tipoImovelLabel(v: unknown): string {
  const raw = str(v);
  if (!raw) return "";
  const texto = TIPO_IMOVEL_TEXTO[raw] ?? raw.replace(/_/g, " ");
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

/** "Sim"/"Não" só quando o booleano existe — ausente é form antigo, não "Não". */
function boolLabel(v: unknown): string {
  if (v === true) return "Sim";
  if (v === false) return "Não";
  return "";
}

function pct(v: unknown): string {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) && n > 0 ? `${n}%` : "";
}

function dias(v: unknown): string {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) && n > 0 ? `${n} dia(s)` : "";
}

function meses(v: unknown, unidade = "mês(es)"): string {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) && n > 0 ? `${n} ${unidade}` : "";
}

/**
 * Esteira do formulário. `partySection`/`imovelSection` são compartilhadas, e sem
 * a variante empurravam linhas de campos que o schema da OUTRA esteira não tem
 * (nome da mãe/naturalidade/SQL/inscrição municipal em locação) — linhas mortas
 * que nunca renderizavam nada mas mascaravam o que faltava de verdade.
 */
type SummaryVariant = "venda" | "locacao";

function endereco(o: AnyObj): string {
  const rua = str(o.endereco) || str(o.rua);
  const numero = str(o.numero);
  const bairro = str(o.bairro);
  const cidade = str(o.cidade);
  const uf = str(o.uf);
  const complemento = str(o.complemento);
  const linha1 = [rua, numero].filter(Boolean).join(", ");
  const cidUf = [cidade, uf].filter(Boolean).join("/");
  const cepF = cep(o.cep);
  return [linha1, complemento, bairro, cidUf, cepF].filter(Boolean).join(" · ");
}

function pushIf(rows: SummaryRow[], label: string, value: string) {
  if (value) rows.push({ label, value });
}

/**
 * Dados de recebimento (PIX / conta bancária) da parte. É o que a imobiliária
 * usa pra pagar o vendedor, então não pode faltar no resumo.
 */
function recebimentoValue(parte: AnyObj): string {
  const rec = obj(parte.recebimento);
  const parts: string[] = [];
  const pixChave = str(rec.pix_chave);
  if (pixChave) {
    const tipo = str(rec.pix_tipo_chave);
    parts.push(`PIX ${tipo ? `(${tipo}) ` : ""}${pixChave}`);
  }
  const banco = str(rec.banco);
  if (banco) {
    const agencia = str(rec.agencia);
    const conta = str(rec.conta);
    const tipoConta = str(rec.tipo_conta);
    const bankLine = [
      banco,
      agencia && `Ag. ${agencia}`,
      conta && `Conta ${conta}`,
      tipoConta,
    ]
      .filter(Boolean)
      .join(" · ");
    parts.push(bankLine);
  }
  return parts.join(" | ");
}

/**
 * Bloco de pessoa vinculada (cônjuge / procurador / representante). Antes
 * saíam só nome + CPF, o que perdia RG, e-mail, telefone e nascimento — dados
 * que o form coleta e a imobiliária precisa (o cônjuge costuma ser signatário).
 */
function relatedPersonValue(p: AnyObj): string {
  // Endereço PRÓPRIO: `endereco_igual_ao_titular === true` significa "vale o do
  // titular", e repetir o endereço dele aqui seria informação inventada. O
  // PROCURADOR não tem essa flag no schema — comparar com `false` fazia o
  // endereço dele nunca aparecer, embora o formulário o colete.
  const enderecoProprio =
    p.endereco_igual_ao_titular !== true ? endereco(p) : "";
  return [
    str(p.nome),
    cpf(p.cpf) && `CPF ${cpf(p.cpf)}`,
    str(p.rg) && `RG ${str(p.rg)}`,
    str(p.nacionalidade),
    str(p.estado_civil),
    str(p.profissao),
    dateBR(p.data_nascimento) && `nasc. ${dateBR(p.data_nascimento)}`,
    // Cônjuge é pretendente na análise de crédito (2026-09): renda e origem.
    brl(p.renda_mensal) && `renda ${brl(p.renda_mensal)}`,
    origemRenda(p.renda_origem) && `origem da renda ${origemRenda(p.renda_origem)}`,
    str(p.nome_mae) && `mãe: ${str(p.nome_mae)}`,
    str(p.naturalidade),
    str(p.email),
    str(p.mobile_phone),
    enderecoProprio,
  ]
    .filter(Boolean)
    .join(" · ");
}

/**
 * Uma parte só entra no resumo se tem IDENTIDADE (nome/razão social ou
 * documento). `withPartyDefaults` no wizard injeta `estado_civil` em toda linha
 * PF — inclusive nas vazias — e o auto-save persiste isso, então sem este guard
 * uma linha em branco vira uma seção "Vendedor 4" contendo só "Estado civil".
 */
function hasIdentity(parte: AnyObj): boolean {
  return Boolean(
    str(parte.nome) ||
      str(parte.razao_social) ||
      onlyDigits(parte.cpf) ||
      onlyDigits(parte.cnpj)
  );
}

function partySection(
  parte: AnyObj,
  title: string,
  variant: SummaryVariant = "venda"
): SummarySection | null {
  const rows: SummaryRow[] = [];
  const tipo = str(parte.tipo_pessoa);
  // Só venda tem `recebimento` (PIX/conta de quem recebe) e os campos de
  // certidão PF (nome da mãe, naturalidade) no schema da parte.
  const isVenda = variant === "venda";

  if (tipo === "juridica") {
    pushIf(rows, "Razão social", str(parte.razao_social));
    pushIf(rows, "CNPJ", cnpj(parte.cnpj));
    pushIf(rows, "Endereço", endereco(parte));
    if (isVenda) pushIf(rows, "Recebimento", recebimentoValue(parte));
    const rep = obj(parte.representante);
    if (str(rep.nome)) pushIf(rows, "Representante", relatedPersonValue(rep));
  } else {
    // PF (default quando tipo_pessoa ausente)
    pushIf(rows, "Nome", str(parte.nome));
    pushIf(rows, "CPF", cpf(parte.cpf));
    pushIf(rows, "RG", str(parte.rg));
    pushIf(rows, "Nacionalidade", str(parte.nacionalidade));
    pushIf(rows, "Estado civil", str(parte.estado_civil));
    pushIf(rows, "Profissão", str(parte.profissao));
    pushIf(rows, "Nascimento", dateBR(parte.data_nascimento));
    // Locação PF ganhou os dois em 2026-09-03 (certidões); venda já os tinha.
    pushIf(
      rows,
      "Sexo",
      parte.sexo === "M" ? "Masculino" : parte.sexo === "F" ? "Feminino" : str(parte.sexo)
    );
    pushIf(rows, "Nome da mãe", str(parte.nome_mae));
    if (isVenda) pushIf(rows, "Naturalidade", str(parte.naturalidade));
    pushIf(rows, "E-mail", str(parte.email));
    pushIf(rows, "Telefone", str(parte.mobile_phone));
    pushIf(rows, "Endereço", endereco(parte));
    if (isVenda) pushIf(rows, "Recebimento", recebimentoValue(parte));
    const conj = obj(parte.conjuge);
    if (str(conj.nome)) pushIf(rows, "Cônjuge", relatedPersonValue(conj));
    const proc = obj(parte.procurador);
    if (str(proc.nome)) pushIf(rows, "Procurador", relatedPersonValue(proc));
  }

  if (rows.length === 0) return null;
  return { title, rows };
}

function partyName(parte: AnyObj): string {
  return str(parte.razao_social) || str(parte.nome);
}

/**
 * "A ser solicitada" / "Anexada (arquivo X)" / vazio no form legado.
 * O filename vem gravado junto do id no dataJson justamente pra este resumo
 * (e o card do deal) não precisarem resolver o anexo.
 */
function matriculaSituacaoLabel(imovel: AnyObj): string {
  const situacao = str(imovel.matricula_situacao);
  if (situacao === "solicitar") return "A ser solicitada";
  if (situacao !== "possui") return "";
  const arquivo = str(imovel.matricula_attachment_filename);
  return arquivo ? `Anexada (${arquivo})` : "Anexada ao formulário";
}

function imovelSection(
  imovel: AnyObj,
  title: string,
  variant: SummaryVariant = "venda"
): SummarySection | null {
  const rows: SummaryRow[] = [];
  pushIf(rows, "Endereço", endereco(imovel));
  pushIf(rows, "Matrícula", str(imovel.matricula));
  pushIf(rows, "Cartório", str(imovel.cartorio));
  // Situação da matrícula ATUALIZADA. Entra no resumo porque é a informação
  // que decide se a diligência pode seguir: sem matrícula atualizada e negativa
  // de ônus, a escritura não sai. Ausente (form legado) não gera linha.
  pushIf(rows, "Matrícula atualizada", matriculaSituacaoLabel(imovel));
  pushIf(rows, "Inscrição IPTU", str(imovel.inscricao_iptu));
  if (variant === "venda") {
    // `sql` e `inscricao_municipal` só existem no imóvel de VENDA.
    pushIf(rows, "SQL", str(imovel.sql));
    pushIf(rows, "Inscrição municipal", str(imovel.inscricao_municipal));
  }
  pushIf(rows, "Descrição", str(imovel.descricao));
  if (rows.length === 0) return null;
  return { title, rows };
}

const CATEGORY_LABEL: Record<string, string> = {
  rg: "RG",
  cpf: "CPF",
  cnh: "CNH",
  matricula: "Matrícula",
  iptu: "IPTU",
  escritura: "Escritura",
  procuracao: "Procuração",
  comprovante_residencia: "Comprovante de residência",
  certidao_casamento: "Certidão de casamento",
  ficha_resumo: "Ficha resumo",
  outro: "Outro",
};

export interface FormSummaryAttachment {
  filename: string;
  category?: string | null;
}

export interface BuildConsolidatedOptions {
  schemaType?: string | null;
  attachments?: FormSummaryAttachment[];
}

/**
 * Monta o resumo consolidado. Venda e locação têm builders próprios;
 * schemaType desconhecido retorna [].
 */
export function buildConsolidatedFormSummary(
  formData: Record<string, unknown> | null | undefined,
  opts: BuildConsolidatedOptions = {}
): SummarySection[] {
  const schemaType = opts.schemaType ?? "compra_venda_v1";
  if ((LOCACAO_SCHEMA_TYPES as readonly string[]).includes(schemaType)) {
    return buildLocacaoConsolidatedSummary(formData, opts);
  }
  if (schemaType !== "compra_venda_v1") return [];
  if (!formData) return [];
  const data = formData as AnyObj;
  const sections: SummarySection[] = [];

  // ---- Partes ----
  const vendedores = arr(data.vendedores);
  vendedores.forEach((v, i) => {
    const parte = obj(v);
    if (!hasIdentity(parte)) return;
    const nome = partyName(parte);
    const title = vendedores.length > 1 ? `Vendedor ${i + 1}${nome ? ` — ${nome}` : ""}` : `Vendedor${nome ? ` — ${nome}` : ""}`;
    const sec = partySection(parte, title);
    if (sec) sections.push(sec);
  });
  const compradores = arr(data.compradores);
  compradores.forEach((c, i) => {
    const parte = obj(c);
    if (!hasIdentity(parte)) return;
    const nome = partyName(parte);
    const title = compradores.length > 1 ? `Comprador ${i + 1}${nome ? ` — ${nome}` : ""}` : `Comprador${nome ? ` — ${nome}` : ""}`;
    const sec = partySection(parte, title);
    if (sec) sections.push(sec);
  });

  // ---- Imóveis ----
  const imoveis = arr(data.imoveis);
  imoveis.forEach((im, i) => {
    const imovel = obj(im);
    const title = imoveis.length > 1 ? `Imóvel ${i + 1}` : "Imóvel";
    const sec = imovelSection(imovel, title);
    if (sec) sections.push(sec);
  });

  // ---- Pagamento / Comissão / Condições ---- (reuso)
  sections.push(...buildNegotiationSummary(formData));

  // ---- Parcelas (detalhe) ----
  const parcelas = arr(obj(data.pagamento).parcelas);
  if (parcelas.length > 0) {
    const rows: SummaryRow[] = parcelas.map((p, i) => {
      const parc = obj(p);
      const valorF = brl(parc.valor);
      // `tipo_outros_texto`/`permuta_descricao` são o que dá sentido a "outros" e
      // "permuta_*" — sem eles a linha dizia só "outros".
      const tipoBase = str(parc.tipo_texto) || str(parc.tipo);
      const tipoDetalhe =
        str(parc.tipo_outros_texto) || str(parc.permuta_descricao);
      const tipoF = [tipoBase, tipoDetalhe && `(${tipoDetalhe})`]
        .filter(Boolean)
        .join(" ");
      // Quando/como: momento nomeado, data exata, prazo em dias e meio de
      // pagamento — tudo já coletado no formulário e invisível no resumo.
      const quando = [
        enumLabel("parcela_momento", parc.momento),
        dateBR(parc.data_exata),
        dias(parc.dias),
      ]
        .filter(Boolean)
        .join(" · ");
      const meio = enumLabel("parcela_meio", parc.meio_pagamento);
      const pix = obj(parc.pix);
      const bancarios = obj(parc.bancarios);
      const destino = str(pix.chave)
        ? `PIX ${str(pix.tipo_chave) ? `(${str(pix.tipo_chave)}) ` : ""}${str(pix.chave)}${
            str(pix.titular_nome) ? ` — ${str(pix.titular_nome)}` : ""
          }`
        : [
            str(bancarios.banco),
            str(bancarios.agencia) && `Ag. ${str(bancarios.agencia)}`,
            str(bancarios.conta) && `Conta ${str(bancarios.conta)}`,
            enumLabel("tipo_conta", bancarios.tipo_conta),
            str(bancarios.titular_nome),
          ]
            .filter(Boolean)
            .join(" · ");
      const value =
        [valorF, tipoF, quando, meio, destino, str(parc.banco_financiamento)]
          .filter(Boolean)
          .join(" — ") || "—";
      return { label: `Parcela ${i + 1}`, value };
    });
    sections.push({ title: "Parcelas", rows });
  }

  // ---- Comissionados (detalhe) ----
  // `buildNegotiationSummary` só diz "N envolvidos" (e só quando >1). Quem lê o
  // resumo precisa saber QUEM recebe e QUANTO — é o que vira split de cobrança.
  const comissao = obj(data.comissao);
  const comissionados = arr(comissao.comissionados).map(obj).filter(hasIdentity);
  if (comissionados.length > 0) {
    const rows: SummaryRow[] = comissionados.map((c, i) => {
      const doc = onlyDigits(c.cnpj) ? cnpj(c.cnpj) : cpf(c.cpf);
      const fatia = [
        typeof c.percentual === "number" && c.percentual > 0 ? `${c.percentual}%` : "",
        brl(c.valor),
      ]
        .filter(Boolean)
        .join(" · ");
      const value = [
        str(c.nome) || str(c.razao_social),
        doc,
        str(c.creci) && `CRECI ${str(c.creci)}`,
        fatia,
        str(c.email),
        str(c.mobile_phone),
      ]
        .filter(Boolean)
        .join(" · ");
      return {
        label: str(c.papel_texto) || str(c.papel) || `Comissionado ${i + 1}`,
        value: value || "—",
      };
    });
    sections.push({ title: "Comissionados", rows });
  }

  // ---- Corretora / intermediação ----
  const corretoraRows: SummaryRow[] = [];
  pushIf(corretoraRows, "Imobiliária", str(comissao.imobiliaria_nome));
  pushIf(corretoraRows, "CNPJ", cnpj(comissao.imobiliaria_cnpj));
  pushIf(corretoraRows, "CRECI", str(comissao.creci));
  pushIf(corretoraRows, "E-mail", str(comissao.imobiliaria_email));
  pushIf(corretoraRows, "Forma de pagamento", str(comissao.forma_pagamento_preferida));
  const prazoApos = Number(comissao.prazo_dias_apos_marco);
  if (Number.isFinite(prazoApos) && prazoApos > 0) {
    corretoraRows.push({ label: "Prazo", value: `${prazoApos} dia(s) após o marco` });
  }
  if (corretoraRows.length > 0) {
    sections.push({ title: "Intermediação", rows: corretoraRows });
  }

  // ---- Posse, propriedade e entrega (step 6) ----
  // Etapa inteira que nunca chegava ao resumo.
  const posseRows: SummaryRow[] = [];
  pushIf(posseRows, "Situação da propriedade", str(data.status_propriedade));
  pushIf(posseRows, "Ocupação do imóvel", str(data.ocupacao));
  const locacao = obj(data.locacao);
  const locacaoInfo = [str(locacao.situacao), str(locacao.data_preferencia)]
    .filter(Boolean)
    .join(" · ");
  pushIf(posseRows, "Locação vigente", locacaoInfo);
  const entregaPosse = obj(data.entrega_posse);
  pushIf(
    posseRows,
    "Entrega da posse",
    str(entregaPosse.momento_texto) || str(entregaPosse.momento)
  );
  const titulo = obj(data.titulo_definitivo);
  const tituloPrazo = Number(titulo.prazo_dias);
  pushIf(
    posseRows,
    "Título definitivo",
    [
      str(titulo.opcao),
      Number.isFinite(tituloPrazo) && tituloPrazo > 0 ? `${tituloPrazo} dias` : "",
    ]
      .filter(Boolean)
      .join(" · ")
  );
  // `buildNegotiationSummary` já emite "Regularizações" com a descrição, mas o
  // PRAZO ficava só no schema — e é ele que a imobiliária cobra.
  const regularizacoes = obj(data.regularizacoes);
  if (regularizacoes.tem === true) {
    pushIf(posseRows, "Prazo das regularizações", dias(regularizacoes.prazo_dias));
  }
  if (posseRows.length > 0) {
    sections.push({ title: "Posse e propriedade", rows: posseRows });
  }

  // ---- Testemunhas ----
  const testemunhas = arr(data.testemunhas).map(obj).filter(hasIdentity);
  if (testemunhas.length > 0) {
    sections.push({
      title: "Testemunhas",
      rows: testemunhas.map((t, i) => ({
        label: `Testemunha ${i + 1}`,
        value:
          [str(t.nome), cpf(t.cpf) && `CPF ${cpf(t.cpf)}`, str(t.email)]
            .filter(Boolean)
            .join(" · ") || "—",
      })),
    });
  }

  // ---- Config (multas/juros) ----
  const config = obj(data.config);
  const cfgRows: SummaryRow[] = [];
  pushIf(cfgRows, "Multa moratória", pct(config.multa_penal_moratoria));
  pushIf(cfgRows, "Base de cálculo da multa", str(config.base_calculo_multa));
  pushIf(cfgRows, "Juros mensais", pct(config.juros_mensais_atraso));
  pushIf(cfgRows, "Multa compensatória", pct(config.multa_penal_compensatoria));
  pushIf(cfgRows, "Atualização monetária", str(config.atualizacao_monetaria));
  pushIf(cfgRows, "Prazo de atraso p/ rescisão", dias(config.prazo_atraso_rescisao));
  pushIf(cfgRows, "Prazo da multa rescisória", dias(config.prazo_multa_rescisoria));
  pushIf(cfgRows, "Multa cominatória diária", brl(config.multa_cominatoria_diaria));
  pushIf(cfgRows, "Foro", str(data.foro));
  const desistencia = obj(data.desistencia);
  if (desistencia.permite === true) {
    const prazo = dias(desistencia.prazo_dias);
    cfgRows.push({
      label: "Cláusula de desistência",
      value: prazo ? `Permitida — prazo de ${prazo}` : "Permitida",
    });
  } else if (desistencia.permite === false) {
    cfgRows.push({ label: "Cláusula de desistência", value: "Não permitida" });
  }
  const assinatura = obj(data.assinatura);
  const local = [str(assinatura.cidade), str(assinatura.uf)].filter(Boolean).join("/");
  pushIf(cfgRows, "Local de assinatura", local);
  pushIf(cfgRows, "Data de assinatura", dateBR(assinatura.data));
  if (cfgRows.length > 0) sections.push({ title: "Configuração contratual", rows: cfgRows });

  // ---- Observações gerais ----
  const observacoes = str(data.observacoes);
  if (observacoes) {
    sections.push({
      title: "Observações gerais",
      rows: [{ label: "Anotações", value: observacoes }],
    });
  }

  // ---- Documentos anexados ----
  pushAttachmentsSection(sections, opts.attachments);

  return sections;
}

function pushAttachmentsSection(
  sections: SummarySection[],
  attachments: FormSummaryAttachment[] | undefined
) {
  if (!attachments || attachments.length === 0) return;
  const rows: SummaryRow[] = attachments.map((a, i) => {
    const cat = a.category ? CATEGORY_LABEL[a.category] ?? a.category : "";
    return {
      label: cat || `Documento ${i + 1}`,
      value: a.filename || "—",
    };
  });
  sections.push({ title: "Documentos anexados", rows });
}

/**
 * Resumo consolidado de LOCAÇÃO (residencial e comercial). Estrutura própria:
 * locadores/locatarios (shape de parte espelhado de venda, + renda mensal),
 * `imovel` objeto único, `aluguel` (valor/encargos/reajuste/vigência),
 * `garantia` (enum + fiador) e `observacoes`.
 */
function buildLocacaoConsolidatedSummary(
  formData: Record<string, unknown> | null | undefined,
  opts: BuildConsolidatedOptions
): SummarySection[] {
  if (!formData) return [];
  const data = formData as AnyObj;
  const sections: SummarySection[] = [];

  // ---- Partes ----
  const pushParties = (list: unknown[], singular: string) => {
    list.forEach((raw, i) => {
      const parte = obj(raw);
      if (!hasIdentity(parte)) return;
      const nome = partyName(parte);
      const title =
        list.length > 1
          ? `${singular} ${i + 1}${nome ? ` — ${nome}` : ""}`
          : `${singular}${nome ? ` — ${nome}` : ""}`;
      const sec = partySection(parte, title, "locacao");
      if (!sec) return;
      // Renda/faturamento — insumo da análise de crédito, só existe em locação.
      sec.rows.push(...rendaRows(parte));
      sections.push(sec);
    });
  };
  pushParties(arr(data.locadores), "Locador");
  pushParties(arr(data.locatarios), "Locatário");

  // ---- Imóvel ----
  const imovel = obj(data.imovel);
  const imovelSec = imovelSection(imovel, "Imóvel", "locacao");
  const extraImovelRows: SummaryRow[] = [];
  pushIf(extraImovelRows, "Tipo", tipoImovelLabel(imovel.kind));
  pushIf(extraImovelRows, "Destinação", str(imovel.destinacao));
  const area = Number(imovel.area);
  if (Number.isFinite(area) && area > 0) {
    extraImovelRows.push({ label: "Área", value: `${area} m²` });
  }
  const vagas = Number(imovel.vagas_garagem);
  if (Number.isFinite(vagas) && vagas > 0) {
    extraImovelRows.push({ label: "Vagas de garagem", value: String(vagas) });
  }
  pushIf(extraImovelRows, "Condomínio", str(imovel.condominio_nome));
  if (imovelSec) {
    imovelSec.rows.push(...extraImovelRows);
    sections.push(imovelSec);
  } else if (extraImovelRows.length > 0) {
    sections.push({ title: "Imóvel", rows: extraImovelRows });
  }

  // ---- Aluguel e reajuste ----
  const aluguel = obj(data.aluguel);
  const fiscal = obj(data.fiscal);
  const aluguelRows: SummaryRow[] = [];
  pushIf(aluguelRows, "Aluguel mensal", brl(aluguel.valor));
  pushIf(aluguelRows, "Encargos mensais (total)", brl(aluguel.encargos));
  pushIf(aluguelRows, "· Condomínio", brl(aluguel.condominio_mensal));
  pushIf(aluguelRows, "· IPTU mensal", brl(aluguel.iptu_mensal));
  pushIf(aluguelRows, "· Outros encargos", brl(aluguel.outros_encargos));
  const diaVenc = Number(aluguel.dia_vencimento);
  if (Number.isFinite(diaVenc) && diaVenc > 0) {
    aluguelRows.push({ label: "Vencimento", value: `Dia ${diaVenc}` });
  }
  pushIf(aluguelRows, "Índice de reajuste", enumLabel("indice_reajuste", aluguel.indice_reajuste));
  pushIf(aluguelRows, "Início da vigência", dateBR(aluguel.vigencia_inicio));
  const vigencia = Number(aluguel.vigencia_meses);
  if (Number.isFinite(vigencia) && vigencia > 0) {
    aluguelRows.push({ label: "Vigência", value: `${vigencia} meses` });
  }
  pushIf(aluguelRows, "Meio de pagamento", enumLabel("meio_pagamento_aluguel", aluguel.meio_pagamento));
  // Administração/despesas decididas no form (2026-08). Booleans explícitos —
  // ausente = form antigo, sem linha.
  if (typeof aluguel.adm_imobiliaria === "boolean") {
    aluguelRows.push({
      label: "Administração pela imobiliária",
      value: aluguel.adm_imobiliaria ? "Sim" : "Não",
    });
  }
  // A taxa de administração NÃO pode depender de `adm_imobiliaria === true`:
  // esse booleano só existe em forms de 2026-08 pra frente, então em todo
  // formulário anterior a taxa simplesmente sumia do resumo. E a fonte
  // preferencial é `fiscal.*` — é lá que o operador acerta a relação
  // imobiliária ↔ proprietário, e era o que a TELA já lia enquanto o PDF lia só
  // o form (as duas superfícies podiam mostrar números diferentes).
  const taxaAdmValor = Number(
    Number(fiscal.taxa_admin_percent) > 0
      ? fiscal.taxa_admin_percent
      : aluguel.taxa_admin_percent
  );
  if (Number.isFinite(taxaAdmValor) && taxaAdmValor > 0) {
    aluguelRows.push({ label: "Taxa de administração", value: `${taxaAdmValor}%` });
  }
  pushIf(
    aluguelRows,
    "Encargos",
    enumLabel("encargos_repasse", aluguel.encargos_repasse)
  );
  if (typeof aluguel.contas_consumo_individualizadas === "boolean") {
    aluguelRows.push({
      label: "Contas de consumo",
      value: aluguel.contas_consumo_individualizadas
        ? "Individualizadas"
        : `No boleto do condomínio${
            Array.isArray(aluguel.contas_no_condominio) &&
            aluguel.contas_no_condominio.length > 0
              ? ` (${(aluguel.contas_no_condominio as unknown[]).join(", ")})`
              : ""
          }`,
    });
  }
  if (aluguelRows.length > 0) {
    sections.push({ title: "Aluguel e reajuste", rows: aluguelRows });
  }

  // ---- Garantia ----
  const garantia = obj(data.garantia);
  const garantiaRows: SummaryRow[] = [];
  const tipoGarantia = str(garantia.tipo);
  if (tipoGarantia) {
    garantiaRows.push({
      label: "Modalidade",
      value: (() => {
        const canonico = normalizeGarantiaTipo(tipoGarantia);
        return canonico ? GARANTIA_LABELS[canonico] : tipoGarantia;
      })(),
    });
  }
  pushIf(garantiaRows, "Seguradora / provedora", str(garantia.provider));
  const caucaoMeses = Number(garantia.caucao_meses);
  if (tipoGarantia === "caucao" && Number.isFinite(caucaoMeses) && caucaoMeses > 0) {
    garantiaRows.push({
      label: "Caução",
      value: `${caucaoMeses} ${caucaoMeses === 1 ? "aluguel" : "aluguéis"}`,
    });
  }
  pushIf(garantiaRows, "Cobertura", meses(garantia.cobertura_meses));
  pushIf(garantiaRows, "Título de capitalização", brl(garantia.titulo_valor));
  pushIf(garantiaRows, "Nº da proposta do título", str(garantia.titulo_proposta));
  pushIf(
    garantiaRows,
    "Tomador da apólice",
    enumLabel("seguro_tomador", garantia.seguro_tomador)
  );
  pushIf(
    garantiaRows,
    "Vigência da apólice",
    enumLabel("seguro_vigencia", garantia.seguro_vigencia)
  );
  const fiador = obj(garantia.fiador);
  if (hasIdentity(fiador)) {
    const fiadorSec = partySection(fiador, "Fiador", "locacao");
    if (fiadorSec) {
      garantiaRows.push({
        label: "Fiador",
        value: partyName(fiador) || "—",
      });
      if (garantiaRows.length > 0) {
        sections.push({ title: "Garantia locatícia", rows: garantiaRows });
      }
      fiadorSec.title = `Fiador${partyName(fiador) ? ` — ${partyName(fiador)}` : ""}`;
      // A capacidade financeira do fiador é o que sustenta a fiança — sem ela o
      // resumo mostrava o fiador sem o dado que justifica aceitá-lo.
      fiadorSec.rows.push(...rendaRows(fiador));
      sections.push(fiadorSec);
    }
  } else if (garantiaRows.length > 0) {
    sections.push({ title: "Garantia locatícia", rows: garantiaRows });
  }

  // ---- Foro / assinatura ----
  const cfgRows: SummaryRow[] = [];
  const cfg = obj(data.config);
  if (cfg.clausula_rescisoria === false) {
    cfgRows.push({ label: "Cláusula rescisória", value: "Não (contrato sem multa rescisória)" });
  } else if (cfg.clausula_rescisoria === true) {
    const mesesMulta = Number(cfg.multa_rescisoria_meses);
    cfgRows.push({
      label: "Cláusula rescisória",
      value:
        Number.isFinite(mesesMulta) && mesesMulta > 0
          ? `Sim — multa de ${mesesMulta} ${mesesMulta === 1 ? "aluguel" : "aluguéis"}`
          : "Sim",
    });
  }
  pushIf(cfgRows, "Multa por atraso", pct(cfg.multa_atraso_percent));
  pushIf(cfgRows, "Juros mensais por atraso", pct(cfg.juros_mensais_atraso));
  pushIf(cfgRows, "Foro", str(data.foro));
  const assinatura = obj(data.assinatura);
  const local = [str(assinatura.cidade), str(assinatura.uf)].filter(Boolean).join("/");
  pushIf(cfgRows, "Local de assinatura", local);
  pushIf(cfgRows, "Data de assinatura", dateBR(assinatura.data));
  pushIf(cfgRows, "Vistoria de referência", str(data.vistoria_ref));
  if (cfgRows.length > 0) sections.push({ title: "Configuração contratual", rows: cfgRows });

  // ---- Administração (fiscal) ----
  // Preenchida pelo OPERADOR e não renderizada no contrato, mas o resumo é
  // dossiê INTERNO da imobiliária: é onde se confere IR, regime de cobrança e
  // repasse antes de gerar as cobranças.
  const fiscalRows: SummaryRow[] = [];
  pushIf(fiscalRows, "Retenção de IR", enumLabel("regime_ir", fiscal.regime_ir));
  pushIf(
    fiscalRows,
    "Regime de cobrança",
    enumLabel("regime_cobranca", fiscal.regime_cobranca)
  );
  pushIf(fiscalRows, "Emite NFS-e", boolLabel(fiscal.emitir_nfse));
  pushIf(fiscalRows, "Isenção de multa", meses(fiscal.isencao_multa_meses));
  const repasseGarantido = enumLabel("repasse_garantido", fiscal.repasse_garantido);
  if (repasseGarantido && str(fiscal.repasse_garantido) !== "nao") {
    const qtd = meses(fiscal.repasse_garantido_meses);
    fiscalRows.push({
      label: "Repasse garantido",
      value: qtd ? `${repasseGarantido} (${qtd})` : repasseGarantido,
    });
  }
  if (fiscalRows.length > 0) {
    sections.push({ title: "Administração", rows: fiscalRows });
  }

  // ---- Comissão ----
  // Faltava: venda já trazia "Comissionados" e "Intermediação", e o resumo de
  // locação chegava à imobiliária sem dizer quanto ela ia receber nem quem
  // captou o imóvel.
  const comissaoRows: SummaryRow[] = [];
  const comissao = obj(data.comissao);
  const formaTaxa =
    comissao.forma_taxa_locacao === "valor_fixo" ? "valor_fixo" : "percentual";
  if (formaTaxa === "valor_fixo") {
    const valorTaxa = Number(comissao.taxa_locacao_valor);
    if (Number.isFinite(valorTaxa) && valorTaxa > 0) {
      comissaoRows.push({
        label: "Taxa de intermediação",
        value: `${brl(valorTaxa)} (valor fixo)`,
      });
    }
  } else {
    const percentTaxa = Number(comissao.taxa_locacao_percent);
    if (Number.isFinite(percentTaxa) && percentTaxa > 0) {
      const aluguelValor = Number(obj(data.aluguel).valor);
      const emReais =
        Number.isFinite(aluguelValor) && aluguelValor > 0
          ? ` — ${brl((aluguelValor * percentTaxa) / 100)}`
          : "";
      comissaoRows.push({
        label: "Taxa de intermediação",
        value: `${percentTaxa}% do 1º aluguel${emReais}`,
      });
    }
  }
  for (const [i, raw] of arr(comissao.angariadores).entries()) {
    const a = obj(raw);
    const nome = str(a.nome) || `Angariador ${i + 1}`;
    const valorFixo = Number(a.valor_fixo);
    const percentual = Number(a.percentual);
    const quanto =
      a.forma_comissao === "valor_fixo"
        ? Number.isFinite(valorFixo) && valorFixo > 0
          ? `${brl(valorFixo)}/mês`
          : ""
        : Number.isFinite(percentual) && percentual > 0
          ? `${percentual}% do aluguel`
          : "";
    const meses = Number(a.meses_comissao);
    const duracao =
      Number.isFinite(meses) && meses > 0 ? ` por ${meses} mês(es)` : " (todo o contrato)";
    // Documento/CRECI/contato: o angariador vira SplitRecipient e recebe
    // repasse — quem confere o resumo precisa saber QUEM é, não só quanto leva.
    const doc = onlyDigits(a.cnpj) ? cnpj(a.cnpj) : cpf(a.cpf);
    const qualificacao = [
      doc,
      str(a.creci) && `CRECI ${str(a.creci)}`,
      str(a.email),
      str(a.mobile_phone),
    ]
      .filter(Boolean)
      .join(" · ");
    const fatia = quanto ? `${quanto}${duracao}` : "";
    // Parte do 1º aluguel: é o que a cláusula de rateio imprime no contrato
    // (`{{rateio_primeiro_aluguel}}`), e sai do valor que cabe à imobiliária —
    // quem confere o resumo precisa ver esse recorte, não só a mensalidade.
    const primeiro = Number(a.valor_primeiro_aluguel);
    const doPrimeiro =
      Number.isFinite(primeiro) && primeiro > 0 ? `${brl(primeiro)} do 1º aluguel` : "";
    comissaoRows.push({
      label: `Angariador — ${nome}`,
      value: [fatia, doPrimeiro, qualificacao].filter(Boolean).join(" — ") || "—",
    });
  }
  if (comissaoRows.length > 0) sections.push({ title: "Comissão", rows: comissaoRows });

  // ---- Observações gerais ----
  const observacoes = str(data.observacoes);
  if (observacoes) {
    sections.push({
      title: "Observações gerais",
      rows: [{ label: "Anotações", value: observacoes }],
    });
  }

  // ---- Documentos anexados ----
  pushAttachmentsSection(sections, opts.attachments);

  return sections;
}
