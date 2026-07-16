/**
 * Resumo consolidado do formulário de venda (compra_venda_v1) a partir do
 * `dataJson` (DadosContratoForm). Puro: não chama rede nem DB. Estende
 * `buildNegotiationSummary` (que cobre Pagamento/Comissão/Condições) com as
 * seções faltantes — Partes, Imóveis, Config e Documentos anexados — pra virar
 * um PDF consolidado enviável por e-mail.
 *
 * Escopo v1: SÓ venda. Locação tem dataJson de estrutura diferente
 * (locador/locatario/fiador) e rota própria — `buildConsolidatedFormSummary`
 * retorna [] pra qualquer schemaType != "compra_venda_v1".
 *
 * Defensivo: todo acesso é opcional, então funciona com forms parciais.
 */

import {
  buildNegotiationSummary,
  type SummarySection,
  type SummaryRow,
} from "@/lib/forms/negotiation-summary";

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
  return [
    str(p.nome),
    cpf(p.cpf) && `CPF ${cpf(p.cpf)}`,
    str(p.rg) && `RG ${str(p.rg)}`,
    str(p.profissao),
    dateBR(p.data_nascimento) && `nasc. ${dateBR(p.data_nascimento)}`,
    str(p.email),
    str(p.mobile_phone),
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

function partySection(parte: AnyObj, title: string): SummarySection | null {
  const rows: SummaryRow[] = [];
  const tipo = str(parte.tipo_pessoa);

  if (tipo === "juridica") {
    pushIf(rows, "Razão social", str(parte.razao_social));
    pushIf(rows, "CNPJ", cnpj(parte.cnpj));
    pushIf(rows, "Endereço", endereco(parte));
    pushIf(rows, "Recebimento", recebimentoValue(parte));
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
    pushIf(rows, "Nome da mãe", str(parte.nome_mae));
    pushIf(rows, "Naturalidade", str(parte.naturalidade));
    pushIf(rows, "E-mail", str(parte.email));
    pushIf(rows, "Telefone", str(parte.mobile_phone));
    pushIf(rows, "Endereço", endereco(parte));
    pushIf(rows, "Recebimento", recebimentoValue(parte));
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

function imovelSection(imovel: AnyObj, title: string): SummarySection | null {
  const rows: SummaryRow[] = [];
  pushIf(rows, "Endereço", endereco(imovel));
  pushIf(rows, "Matrícula", str(imovel.matricula));
  pushIf(rows, "Cartório", str(imovel.cartorio));
  pushIf(rows, "Inscrição IPTU", str(imovel.inscricao_iptu));
  pushIf(rows, "SQL", str(imovel.sql));
  pushIf(rows, "Inscrição municipal", str(imovel.inscricao_municipal));
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
 * Monta o resumo consolidado. Retorna [] pra schemaType != compra_venda_v1
 * (feature venda-only na v1).
 */
export function buildConsolidatedFormSummary(
  formData: Record<string, unknown> | null | undefined,
  opts: BuildConsolidatedOptions = {}
): SummarySection[] {
  const schemaType = opts.schemaType ?? "compra_venda_v1";
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
      const valor = typeof parc.valor === "number" ? parc.valor : Number(parc.valor);
      const valorF = Number.isFinite(valor) && valor > 0
        ? `R$ ${valor.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`
        : "";
      const desc = [str(parc.tipo_texto) || str(parc.tipo), str(parc.momento) && `(${str(parc.momento)})`]
        .filter(Boolean)
        .join(" ");
      return { label: `Parcela ${i + 1}`, value: [valorF, desc].filter(Boolean).join(" — ") || "—" };
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
  const pct = (v: unknown) => {
    const n = typeof v === "number" ? v : Number(v);
    return Number.isFinite(n) && n > 0 ? `${n}%` : "";
  };
  const dias = (v: unknown) => {
    const n = typeof v === "number" ? v : Number(v);
    return Number.isFinite(n) && n > 0 ? `${n} dia(s)` : "";
  };
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
  const attachments = opts.attachments ?? [];
  if (attachments.length > 0) {
    const rows: SummaryRow[] = attachments.map((a, i) => {
      const cat = a.category ? CATEGORY_LABEL[a.category] ?? a.category : "";
      return {
        label: cat || `Documento ${i + 1}`,
        value: a.filename || "—",
      };
    });
    sections.push({ title: "Documentos anexados", rows });
  }

  return sections;
}
