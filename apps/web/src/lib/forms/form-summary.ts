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

function partySection(parte: AnyObj, title: string): SummarySection | null {
  const rows: SummaryRow[] = [];
  const tipo = str(parte.tipo_pessoa);

  if (tipo === "juridica") {
    pushIf(rows, "Razão social", str(parte.razao_social));
    pushIf(rows, "CNPJ", cnpj(parte.cnpj));
    pushIf(rows, "Endereço", endereco(parte));
    const rep = obj(parte.representante);
    const repNome = str(rep.nome);
    if (repNome) {
      const repInfo = [repNome, cpf(rep.cpf) && `CPF ${cpf(rep.cpf)}`]
        .filter(Boolean)
        .join(" · ");
      pushIf(rows, "Representante", repInfo);
    }
  } else {
    // PF (default quando tipo_pessoa ausente)
    pushIf(rows, "Nome", str(parte.nome));
    pushIf(rows, "CPF", cpf(parte.cpf));
    pushIf(rows, "RG", str(parte.rg));
    pushIf(rows, "Estado civil", str(parte.estado_civil));
    pushIf(rows, "Nascimento", dateBR(parte.data_nascimento));
    pushIf(rows, "E-mail", str(parte.email));
    pushIf(rows, "Endereço", endereco(parte));
    const conj = obj(parte.conjuge);
    const conjNome = str(conj.nome);
    if (conjNome) {
      const conjInfo = [conjNome, cpf(conj.cpf) && `CPF ${cpf(conj.cpf)}`]
        .filter(Boolean)
        .join(" · ");
      pushIf(rows, "Cônjuge", conjInfo);
    }
    const proc = obj(parte.procurador);
    const procNome = str(proc.nome);
    if (procNome) {
      pushIf(rows, "Procurador", [procNome, cpf(proc.cpf) && `CPF ${cpf(proc.cpf)}`].filter(Boolean).join(" · "));
    }
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
    const nome = partyName(parte);
    const title = vendedores.length > 1 ? `Vendedor ${i + 1}${nome ? ` — ${nome}` : ""}` : `Vendedor${nome ? ` — ${nome}` : ""}`;
    const sec = partySection(parte, title);
    if (sec) sections.push(sec);
  });
  const compradores = arr(data.compradores);
  compradores.forEach((c, i) => {
    const parte = obj(c);
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

  // ---- Config (multas/juros) ----
  const config = obj(data.config);
  const cfgRows: SummaryRow[] = [];
  const pct = (v: unknown) => {
    const n = typeof v === "number" ? v : Number(v);
    return Number.isFinite(n) && n > 0 ? `${n}%` : "";
  };
  pushIf(cfgRows, "Multa moratória", pct(config.multa_penal_moratoria));
  pushIf(cfgRows, "Juros mensais", pct(config.juros_mensais_atraso));
  pushIf(cfgRows, "Multa compensatória", pct(config.multa_penal_compensatoria));
  pushIf(cfgRows, "Atualização monetária", str(config.atualizacao_monetaria));
  pushIf(cfgRows, "Foro", str(data.foro));
  if (cfgRows.length > 0) sections.push({ title: "Configuração contratual", rows: cfgRows });

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
