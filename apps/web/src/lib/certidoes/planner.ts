import { endpointInfo, TJRS_TIPOS } from "./endpoints";
import { comarcaForCidade } from "./comarcas-rj";
import { isSerasaConfigured } from "@/lib/serasa/client";
import type {
  ExtractionPlan,
  MissingField,
  PlannedJob,
  SkippedJob,
  TargetKind,
} from "./types";

/**
 * Phase B — declarative routing table: UF → civil endpoint on the TJ.
 * When a UF has multiple endpoints (TJSP 2-step, TJMS 2-step, TJRS 5 types),
 * the handler branch in the main loop handles those special cases; this
 * table only covers "simple" 1-etapa endpoints for the other TJs.
 *
 * UFs absent from this table fall back to "no TJ coverage" — planner emits
 * a SkippedJob so the due-diligence report lists it as manual pending.
 */
const CIVIL_ENDPOINT_BY_UF: Partial<Record<string, string>> = {
  BA: "tribunal/tjba/primeiro-grau",
  GO: "tribunal/tjgo/nada-consta",
  DF: "tribunal/tjdf/nada-consta",
  SC: "tribunal/tjsc/pedido-certidao",
  MT: "tribunal/tjmt/primeiro-grau-pf", // PF only — handler checks
};

/**
 * Phase B — UF → TRT regional for CEAT (Certidão Eletrônica de Ações
 * Trabalhistas). Each TRT covers 1-4 UFs. Only UFs where Infosimples has a
 * CEAT endpoint are listed.
 */
const CEAT_ENDPOINT_BY_UF: Partial<Record<string, string[]>> = {
  SP: ["tribunal/trt2/ceat", "tribunal/trt2/ceat-digital", "tribunal/trt15/ceat"],
  RJ: ["tribunal/trt1/ceat"],
  RS: ["tribunal/trt4/ceat"],
  MG: ["tribunal/trt3/ceat"],
  BA: ["tribunal/trt5/ceat"],
  PR: ["tribunal/trt9/ceat"],
  DF: ["tribunal/trt10/ceat", "tribunal/trt10/ceat-digital"],
  TO: ["tribunal/trt10/ceat", "tribunal/trt10/ceat-digital"],
  SC: ["tribunal/trt12/ceat"],
};

/**
 * Phase B — State debt (CND Estadual / Dívida Ativa PGE). Default to the
 * unified Sefaz endpoint that covers all 27 UFs, swapping to SP-specific
 * when available (cheaper + richer response).
 */
function stateDebtEndpointForUf(partyUf: string): string {
  // I.3 (Phase I, 2026-04-18) — `pge-sp/cndt` retornou code 602
  // ("serviço inválido") em 100% dos casos no QA 2026-04-18. Endpoint
  // depreciado pela Infosimples. Fallback para sefaz unificado que cobre
  // SP também. Quando provider confirmar nova URL, reativar.
  void partyUf;
  return "sefaz/certidao-debitos";
}

/**
 * Phase F.II-γ — UF → TRF individual (cível + criminal). Cobre 1ª e 2ª
 * instâncias da Justiça Federal regional. Usado em adição à `trf/cert-unificada`
 * (que só cobre cível 1ª instância dos 6 TRFs).
 */
const TRF_UF_MAP: Partial<Record<string, string>> = {
  AC: "tribunal/trf1/certidao",
  AM: "tribunal/trf1/certidao",
  AP: "tribunal/trf1/certidao",
  BA: "tribunal/trf1/certidao",
  DF: "tribunal/trf1/certidao",
  GO: "tribunal/trf1/certidao",
  MA: "tribunal/trf1/certidao",
  MT: "tribunal/trf1/certidao",
  PA: "tribunal/trf1/certidao",
  PI: "tribunal/trf1/certidao",
  RO: "tribunal/trf1/certidao",
  RR: "tribunal/trf1/certidao",
  TO: "tribunal/trf1/certidao",
  RJ: "tribunal/trf2/certidao",
  ES: "tribunal/trf2/certidao",
  SP: "tribunal/trf3/certidao-distr",
  MS: "tribunal/trf3/certidao-distr",
  RS: "tribunal/trf4/certidao",
  SC: "tribunal/trf4/certidao",
  PR: "tribunal/trf4/certidao",
  AL: "tribunal/trf5/certidao",
  CE: "tribunal/trf5/certidao",
  PB: "tribunal/trf5/certidao",
  PE: "tribunal/trf5/certidao",
  RN: "tribunal/trf5/certidao",
  SE: "tribunal/trf5/certidao",
  MG: "tribunal/trf6/certidao",
};

/**
 * TRFs individuais 1/2/4/5/6 — `tipo_certidao` é obrigatório. Disparamos Cível +
 * Criminal por pessoa (2 chamadas). `ELEITORAL` não interessa em transação
 * imobiliária. TRF3 é exceção: usa `tipo` numérico (1=Cível) e endpoint 2-step
 * `certidao-distr` — tratado em branch separado.
 *
 * ATENÇÃO — o valor de `tipo_certidao` varia por TRF:
 *   - TRF5 usa NUMÉRICO `"1"`(Cível)/`"2"`(Criminal). Evidência ao vivo
 *     (2026-05-25): enviar `"CIVEL"` retorna code 607 *"O campo 'tipo_certidao'
 *     informado é inválido. Informe os valores '1' ou '2'."*.
 *   - TRF2/TRF4/TRF6 seguem em `CIVEL`/`CRIMINAL` (default) — sem evidência de
 *     que mudaram; reavaliar no próximo lote real se aparecer 607.
 * `TRF_TIPOS_BY_ENDPOINT` permite o esquema por endpoint; o resto cai no default.
 */
const TRF_INDIVIDUAL_TIPOS: Array<{ tipo_certidao: string; label: string }> = [
  { tipo_certidao: "CIVEL", label: "Cível" },
  { tipo_certidao: "CRIMINAL", label: "Criminal" },
];

const TRF5_TIPOS_NUMERICOS: Array<{ tipo_certidao: string; label: string }> = [
  { tipo_certidao: "1", label: "Cível" },
  { tipo_certidao: "2", label: "Criminal" },
];

const TRF_TIPOS_BY_ENDPOINT: Record<
  string,
  Array<{ tipo_certidao: string; label: string }>
> = {
  "tribunal/trf5/certidao": TRF5_TIPOS_NUMERICOS,
};

/**
 * TJSP (migração 2026-05-23): o endpoint legado `tjsp/pedido-civel` é cível-only
 * (ignora `tipo_certidao`, devolve só "Ações Cíveis em Geral" do eproc). A
 * cobertura real vem do `tjsp/pedido-certidao` genérico, cujo `modelo` é um
 * NÚMERO (confirmado por sondagem na API + form e-SAJ):
 *   - modelo 4 = "Certidão de Distribuição Cível em Geral - SAJ SGC"
 *     (engloba cíveis + família + execuções fiscais — não há certidão online
 *      separada de família/execução-fiscal; são presenciais)
 *   - modelo 1 = "Cert Dist - Falências, Concordatas e Recuperações"
 * `pedido-certidao` EXIGE `rg` para PF (erro 606 sem). PJ usa cnpj+razao_social.
 * Ver memória certidoes_tjsp_pedido_civel_only.
 */
const TJSP_MODELOS: Array<{ modelo: number; label: string }> = [
  { modelo: 4, label: "Cível em Geral (SAJ SGC)" },
  { modelo: 1, label: "Falências, Concordatas e Recuperações" },
];

/**
 * Phase F.II-γ — TJRJ ainda dispara multi-tipo (não verificado se também é
 * cível-only; manter até confirmar no portal TJRJ).
 */
const TJRJ_TIPOS: Array<{ tipo_certidao: string; label: string }> = [
  { tipo_certidao: "civel", label: "Cível" },
  { tipo_certidao: "familia", label: "Família e Sucessões" },
  { tipo_certidao: "falencia", label: "Falência / Concordata / Rec. Judicial" },
  { tipo_certidao: "execucao-fiscal", label: "Execução Fiscal" },
];

/**
 * Phase L (2026-05-22) — Roteamento municipal por `UF|cidade-normalizada` →
 * endpoint(s) de IPTU/CND municipal cobertos pela Infosimples. Cada spec
 * declara o identificador exigido (`sql` em SP, `inscricao_municipal` nas
 * demais) e o nome do parâmetro enviado à Infosimples.
 *
 * NOTA QA (verificação 2026-05-22 via páginas públicas infosimples.com/consultas):
 *   - SP `sql` ✅ confirmado; RJ `inscricao` ✅ confirmado.
 *   - BH ✅ CORRIGIDO: param é `identificador` (+ `data_inicio`/`data_fim`); a
 *     janela de datas é best-guess (ano corrente) — confirmar a semântica logado.
 *   - Curitiba ✅ é CND por contribuinte (cpf/cnpj), não por imóvel: fora da
 *     trilha de imóvel, agora dispara na trilha de pessoa (MUNICIPAL_PESSOA_BY_KEY).
 *   - POA/Floripa/Cuiabá: `inscricao` é best-guess, NÃO verificado (doc pública
 *     não expõe os params) — validar logado antes de confiar (risco 606/612).
 * Endpoints `extraOnly` só entram via picker (expandAll) p/ não inflar o custo.
 */
interface MunicipalEndpointSpec {
  endpoint: string;
  requiresField: "sql" | "inscricao_municipal";
  paramName: string;
  extraOnly?: boolean;
  /** Args estáticos extras exigidos pelo endpoint (ex.: BH exige data_inicio/data_fim). */
  extraArgs?: () => Record<string, unknown>;
}

/** DD/MM/YYYY de uma data (formato aceito pela Infosimples). */
function formatDateBr(d: Date): string {
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${d.getFullYear()}`;
}

/** BH cndiptu/cnd exigem intervalo de datas. Janela do ano corrente. */
function bhDateRange(): Record<string, unknown> {
  const now = new Date();
  return { data_inicio: `01/01/${now.getFullYear()}`, data_fim: formatDateBr(now) };
}
const MUNICIPAL_BY_KEY: Record<string, MunicipalEndpointSpec[]> = {
  "SP|sao paulo": [
    { endpoint: "pref/sp/sao-paulo/iptu", requiresField: "sql", paramName: "sql" },
    { endpoint: "pref/sp/sao-paulo/debitos-iptu", requiresField: "sql", paramName: "sql", extraOnly: true },
    { endpoint: "pref/sp/sao-paulo/dados-imovel", requiresField: "sql", paramName: "sql", extraOnly: true },
  ],
  "RJ|rio de janeiro": [
    { endpoint: "pref/rj/rio-janeiro/cert-trib", requiresField: "inscricao_municipal", paramName: "inscricao" },
    { endpoint: "pref/rj/rio-janeiro/cnd", requiresField: "inscricao_municipal", paramName: "inscricao", extraOnly: true },
    { endpoint: "pref/rj/rio-janeiro/iptu", requiresField: "inscricao_municipal", paramName: "inscricao", extraOnly: true },
  ],
  // BH: o identificador do imóvel vai no param `identificador` (não
  // `indice_cadastral`) e a consulta exige um intervalo de datas (verificado na
  // doc pública 2026-05-22). A janela é best-guess (ano corrente) — confirmar.
  "MG|belo horizonte": [
    { endpoint: "pref/mg/belo-horizonte/cndiptu", requiresField: "inscricao_municipal", paramName: "identificador", extraArgs: bhDateRange },
    { endpoint: "pref/mg/belo-horizonte/cnd", requiresField: "inscricao_municipal", paramName: "identificador", extraOnly: true, extraArgs: bhDateRange },
  ],
  "RS|porto alegre": [
    { endpoint: "pref/rs/porto-alegre/cnd", requiresField: "inscricao_municipal", paramName: "inscricao" },
  ],
  // Curitiba `pref/pr/curitiba/cnd` é CND POR CONTRIBUINTE (cpf/cnpj), não por
  // imóvel (doc pública 2026-05-22) — fora da trilha de imóvel; agora dispara na
  // trilha de pessoa via MUNICIPAL_PESSOA_BY_KEY (parte de Curitiba).
  "SC|florianopolis": [
    { endpoint: "pref/sc/florianopolis/cnd", requiresField: "inscricao_municipal", paramName: "inscricao" },
  ],
  "MT|cuiaba": [
    { endpoint: "pref/mt/cuiaba/cnd", requiresField: "inscricao_municipal", paramName: "inscricao" },
  ],
};

/**
 * CND municipal emitida POR CONTRIBUINTE (cpf/cnpj), não por imóvel — ex.:
 * Curitiba. Roteada por `UF|cidade-normalizada` da PARTE: dispara quando a parte
 * é daquele município (ou todas em expandAll, via picker). Args = só cpf/cnpj.
 */
const MUNICIPAL_PESSOA_BY_KEY: Record<string, string[]> = {
  "PR|curitiba": ["pref/pr/curitiba/cnd"],
};

/** Normaliza cidade para a chave de roteamento municipal (sem acento, lower). */
function normalizeCidade(s: string | undefined | null): string {
  return (s ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
}

/** Heurística de imóvel rural: flag explícita ou presença de código rural. */
function isImovelRural(imovel: Imovel): boolean {
  const t = (imovel.tipo_imovel ?? "").toLowerCase();
  return (
    imovel.rural === true ||
    t.includes("rural") ||
    !!(imovel.codigo_incra && String(imovel.codigo_incra).trim()) ||
    !!(imovel.nirf && String(imovel.nirf).trim())
  );
}

// ---- deal shape helpers (mirror of DadosContrato) -----------------

interface Dependente {
  nome?: string;
  cpf?: string;
  rg?: string;
  data_nascimento?: string;
  nome_mae?: string;
  sexo?: string;
  uf?: string;
  cidade?: string;
  endereco_igual_ao_titular?: boolean;
}

interface Parte {
  tipo_pessoa?: "fisica" | "juridica";
  nome?: string;
  razao_social?: string;
  cpf?: string;
  cnpj?: string;
  data_nascimento?: string;
  // H.3 (Phase H, 2026-04-18) — nome da mãe é requerido pelo TJSP pedido-cível
  // para alguns tipos (código 606 "parâmetros obrigatórios" em 100% dos jobs PF
  // sem esse campo). OCR do RG traz `filiacao`/`mae` quando disponível.
  nome_mae?: string;
  // 2026-05-25 — sexo da parte (TJSP pedido-certidao exige `genero` p/ PF).
  // Valores livres ("M"/"F"/"masculino"/...); normalizado em normalizeSexo.
  sexo?: string;
  rg?: string;
  email?: string;
  uf?: string;
  cidade?: string;
  // Dependentes do vendedor — diligenciados junto por padrão (2026-05-22).
  conjuge?: Dependente;
  procurador?: Dependente;
  representante?: Dependente; // PF que assina por vendedor PJ
}

interface Imovel {
  rua?: string;
  cidade?: string;
  uf?: string;
  matricula?: string;
  inscricao_iptu?: string;
  sql?: string;
  inscricao_municipal?: string;
  // Phase L — registro de imóveis (ONR) + CCIR rural
  cartorio?: string;
  tipo_imovel?: string; // "urbano" | "rural" | livre
  rural?: boolean;
  codigo_incra?: string;
  nirf?: string;
}

interface DealDataLike {
  vendedores?: Parte[];
  compradores?: Parte[];
  imoveis?: Imovel[];
  // Phase K — modalidade da transação influencia quais certidões extras
  // disparam (ex: antecedentes criminais obrigatórios em financiamento).
  modalidade?: "a_vista" | "financiamento" | string;
}

// -------------------------------------------------------------------

const DEFAULT_FINALIDADE = "Instrucao de compra e venda de imovel";
// Fallback de ÚLTIMO caso: o caminho real passa o e-mail de login do operador
// (route.ts → dealEmail). O e-SAJ (TJSP/TJRJ) VALIDA a entregabilidade desse
// e-mail — domínio inexistente/sem MX é recusado com code 608 ("Favor preencher
// com um email válido"). O antigo "contato@contractmaker.com.br" era um domínio
// morto (NXDOMAIN, sem MX) pré-rebranding e quebrava 100% dos jobs de tribunal.
// Configurável por env caso exista uma caixa real com MX.
const DEFAULT_EMAIL =
  process.env.CERTIDOES_FALLBACK_EMAIL?.trim() || "contato@imobpro.ia.br";

/**
 * Validação básica de formato de e-mail. Usada para decidir se o `dealEmail`
 * recebido é aproveitável ou se caímos no DEFAULT_EMAIL.
 */
function isValidEmail(e: string | undefined | null): e is string {
  return typeof e === "string" && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e.trim());
}

/**
 * 2026-06-02 — e-SAJ (TJSP `pedido-certidao`) recusa com code 604 "mesmo email
 * múltiplas vezes num intervalo curto" quando vários pedidos do mesmo lote usam
 * o MESMO `email_envio`. Cada PF/PJ gera 2 pedidos (modelo 4 + 1), e com várias
 * partes isso colide. Solução: dar um `email_envio` ÚNICO por pedido via
 * plus-alias (`local+token@dominio`). O e-SAJ valida só a entregabilidade (MX),
 * e o plus-alias preserva o MX (entrega na mesma caixa do operador → não toma
 * 608), mas o servidor vê endereços distintos → sem 604. Token determinístico
 * (sem Math.random) por (documento, contexto, modelo) mantém estável entre
 * re-planejamentos. Ver docs/certidoes-known-issues.md (TJSP).
 */
function emailToken(...parts: Array<string | number | undefined | null>): string {
  const s = parts.filter((p) => p !== undefined && p !== null && p !== "").join("|");
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

function aliasEmail(base: string, token: string): string {
  const at = base.indexOf("@");
  const safe = token.replace(/[^a-z0-9]/gi, "").slice(0, 24).toLowerCase();
  if (at < 0 || !safe) return base;
  const local = base.slice(0, at).split("+")[0]; // descarta +alias pré-existente
  const domain = base.slice(at + 1);
  return `${local}+${safe}@${domain}`;
}

function onlyDigits(s: string | undefined | null): string {
  return typeof s === "string" ? s.replace(/\D/g, "") : "";
}

function normalizeCpf(cpf: string | undefined | null): string | null {
  const digits = onlyDigits(cpf);
  return digits.length === 11 ? digits : null;
}

function normalizeCnpj(cnpj: string | undefined | null): string | null {
  const digits = onlyDigits(cnpj);
  return digits.length === 14 ? digits : null;
}

function normalizeDate(d: string | undefined | null): string | null {
  if (!d) return null;
  // Accept "YYYY-MM-DD" or "DD/MM/YYYY"
  if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
  const br = d.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;
  return null;
}

function personLabel(p: Parte): string {
  // Phase F.IV — prioriza razao_social quando tipo_pessoa=juridica para
  // evitar que o nome residual do OCR de RG (PF) vaze para label de PJ
  if (p.tipo_pessoa === "juridica") {
    return p.razao_social || p.nome || "PJ sem razão social";
  }
  return p.nome || p.razao_social || "Sem nome";
}

function uf(p: Parte | Imovel | undefined): string {
  return (p?.uf || "").trim().toUpperCase();
}

/**
 * Mapeia o `sexo` da parte (form/OCR) para o valor `genero` exigido pelo TJSP
 * `pedido-certidao` para PF (modelo 1/2/4/5/6). Aceita entradas livres
 * ("M"/"F"/"masculino"/"feminino").
 *
 * Valor aceito pela Infosimples: "M"/"F" (confirmado no 1º lote QA real
 * 2026-06-01 — "MASCULINO"/"FEMININO" tomava 606 "o parâmetro 'genero' deve
 * ter os valores 'M' ou 'F'"). Retorna null quando ausente/ambíguo → o planner
 * faz skip pedindo o dado (zero crédito desperdiçado), em vez de tomar 606.
 */
function sexoToGenero(sexo: string | undefined | null): string | null {
  const s = (sexo || "").trim().toLowerCase();
  if (!s) return null;
  if (s.startsWith("m")) return "M"; // m, masc, masculino
  if (s.startsWith("f")) return "F"; // f, fem, feminino
  return null;
}

// -------------------------------------------------------------------

/**
 * F3: shape of a DiligentedPerson row as passed into the planner. Matches the
 * Prisma model but intentionally loose so tests can build fixtures without
 * loading Prisma. The route handler that reads from DB maps the fields.
 */
export interface DiligentedPersonInput {
  id?: string;
  tipoPessoa: "fisica" | "juridica";
  nome: string;
  cpf?: string | null;
  cnpj?: string | null;
  dataNascimento?: string | null;
  uf?: string | null;
  cidade?: string | null;
}

function diligenciadoToParte(d: DiligentedPersonInput): Parte {
  return {
    tipo_pessoa: d.tipoPessoa,
    nome: d.nome,
    cpf: d.cpf ?? undefined,
    cnpj: d.cnpj ?? undefined,
    data_nascimento: d.dataNascimento ?? undefined,
    uf: d.uf ?? undefined,
    cidade: d.cidade ?? undefined,
  };
}

/** Dependente tem documento útil (CPF) ou ao menos um nome p/ diligenciar. */
function hasIdentity(d: Dependente | undefined): d is Dependente {
  return !!d && !!((d.cpf && d.cpf.trim()) || (d.nome && d.nome.trim()));
}

/**
 * Converte um dependente do vendedor (cônjuge/procurador/representante) numa
 * `Parte` PF para o planner. Herda UF/cidade do titular quando o dependente
 * não tem endereço próprio (cônjuge com `endereco_igual_ao_titular`, ou
 * representante de PJ que mora "na" empresa). Procurador costuma não ter
 * data_nascimento → endpoints que a exigem (TJSP/PGFN/Receita CPF) caem em
 * SkippedJob "complete os dados", comportamento esperado.
 */
function dependenteToParte(dep: Dependente, titular: Parte): Parte {
  const usarEnderecoTitular = dep.endereco_igual_ao_titular !== false;
  const uf = (dep.uf && dep.uf.trim()) || (usarEnderecoTitular ? titular.uf : undefined) || titular.uf;
  const cidade =
    (dep.cidade && dep.cidade.trim()) ||
    (usarEnderecoTitular ? titular.cidade : undefined) ||
    titular.cidade;
  return {
    tipo_pessoa: "fisica",
    nome: dep.nome,
    cpf: dep.cpf,
    rg: dep.rg || undefined,
    data_nascimento: dep.data_nascimento || undefined,
    nome_mae: dep.nome_mae || undefined,
    sexo: dep.sexo || undefined,
    uf,
    cidade,
  };
}

/**
 * Enumera os dependentes diligenciáveis de um vendedor: cônjuge e procurador
 * (sempre que tiverem identidade) e, para vendedor PJ, o representante PF que
 * assina. `index` é o índice do vendedor titular (compartilhado no targetIndex
 * para agrupar na UI). Compradores NÃO chamam isto (decisão do usuário).
 */
function dependentesDoVendedor(
  vendedor: Parte,
  index: number
): Array<{ kind: TargetKind; index: number; parte: Parte }> {
  const out: Array<{ kind: TargetKind; index: number; parte: Parte }> = [];
  if (hasIdentity(vendedor.conjuge)) {
    out.push({ kind: "conjuge_vendedor", index, parte: dependenteToParte(vendedor.conjuge, vendedor) });
  }
  if (hasIdentity(vendedor.procurador)) {
    out.push({ kind: "procurador_vendedor", index, parte: dependenteToParte(vendedor.procurador, vendedor) });
  }
  if (vendedor.tipo_pessoa === "juridica" && hasIdentity(vendedor.representante)) {
    out.push({ kind: "representante_vendedor", index, parte: dependenteToParte(vendedor.representante, vendedor) });
  }
  return out;
}

/**
 * F1/F2: options for the planner.
 *   - `expandAll`: when true, generate jobs for endpoints in ALL UFs (not just
 *     the party/imovel's own UF). Used by the POST /certidoes route so the
 *     user can select "extras" from the picker — e.g. a SP vendedor can opt
 *     into TJRJ civel if wanted. The default plan (expandAll=false) preserves
 *     the R5 behavior: only matched-UF endpoints are auto-suggested.
 */
export interface PlannerOptions {
  expandAll?: boolean;
  /**
   * Phase F.II-γ — resultado do pre-flight GOV.BR (checkGovBrAuth).
   * Se `true`, endpoints com `requiresGovBrAuth` disparam normalmente.
   * Se `false` ou `undefined`, esses endpoints viram SkippedJob com
   * razão clara para o usuário renovar auth em Settings.
   */
  govBrActive?: boolean;
  /**
   * Phase L — resultado do pre-flight ONR/ARISP (checkOnrAuth). Se `true`,
   * endpoints com `requiresOnrAuth` (matrícula, pesquisa de bens) disparam.
   * Se ausente, viram SkippedJob orientando configurar credenciais ONR.
   */
  onrActive?: boolean;
  /**
   * Redesign 2026-05-26 — locais extras (UF/cidade) que o usuário adicionou na
   * popup ("+ Adicionar outro local"). Entram no conjunto de regiões padrão do
   * lado vendedor (certidões regionais disparam também nessas praças).
   */
  extraRegions?: Array<{ uf?: string; cidade?: string }>;
}

// ---- Redesign 2026-05-26: regiões + camadas (tier) -------------------------

import type { JobTier, JobRegion } from "./types";

const VENDEDOR_SIDE_KINDS = new Set<TargetKind>([
  "vendedor",
  "conjuge_vendedor",
  "procurador_vendedor",
  "representante_vendedor",
]);

/** Endpoints FEDERAIS (cobertura nacional) — region = "nacional", não regional. */
const FEDERAL_ENDPOINTS = new Set<string>([
  "receita-federal/cpf",
  "receita-federal/cnpj",
  "receita-federal/pgfn",
  "tribunal/tst/cndt",
  "tribunal/trf/cert-unificada",
  "caixa/regularidade",
  "antecedentes-criminais/pf/emit",
  "ieptb/protestos", // CENPROT Nacional
]);

/** Pesquisa de bens / patrimonial — camada "pesquisa". */
const PESQUISA_ENDPOINTS = new Set<string>(["onr/mapa-registro-imoveis"]);

/**
 * Camada de seleção de um job. Regra: vendedores (+ dependentes) = "padrao";
 * compradores e pessoas adicionadas manualmente (diligenciado) = "opcional";
 * jobs de imóvel/registro (IPTU/ONR matrícula) = "opcional"; pesquisa de bens
 * e extras = "pesquisa".
 */
function tierForJob(kind: TargetKind, endpoint: string): JobTier {
  if (PESQUISA_ENDPOINTS.has(endpoint) || endpoint.startsWith("serasa/")) return "pesquisa";
  if (kind === "imovel") return "imovel"; // IPTU/municipal, matrícula ONR (visualização), CCIR
  if (VENDEDOR_SIDE_KINDS.has(kind)) return "padrao";
  // comprador, diligenciado (outras pessoas)
  return "opcional";
}

/** Monta uma JobRegion a partir de uf/cidade. */
function makeRegion(
  kind: JobRegion["kind"],
  uf: string | undefined,
  cidade?: string | null
): JobRegion {
  const u = (uf || "").trim().toUpperCase();
  const c = (cidade || "").trim();
  return { kind, uf: u || undefined, cidade: c || undefined, label: c ? `${c}/${u}` : u };
}

/**
 * Regiões padrão de uma pessoa. Para o lado VENDEDOR: a região de cada imóvel
 * (+ locais extras pedidos) E a região do endereço da própria parte — dedupe
 * por UF|cidade (se vendedor mora na mesma praça do imóvel, vira uma só). Para
 * comprador/diligenciado: só a própria região. Imóvel-region vem primeiro
 * (vence o dedupe → rótulo "Região do imóvel").
 */
function computeRegionsForPerson(
  kind: TargetKind,
  parte: Parte,
  imoveis: Imovel[],
  extraRegions: Array<{ uf?: string; cidade?: string }>
): JobRegion[] {
  const out: JobRegion[] = [];
  const seen = new Set<string>();
  const add = (rkind: JobRegion["kind"], ufv?: string, cidade?: string | null) => {
    const r = makeRegion(rkind, ufv, cidade);
    if (!r.uf) return;
    const key = `${r.uf}|${normalizeCidade(r.cidade)}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(r);
  };
  if (VENDEDOR_SIDE_KINDS.has(kind)) {
    for (const im of imoveis) add("imovel", im.uf, im.cidade);
    for (const ex of extraRegions) add("outro", ex.uf, ex.cidade);
    add("endereco", parte.uf, parte.cidade);
  } else {
    add("endereco", parte.uf, parte.cidade);
  }
  return out;
}

export function planCertidoesForDeal(
  dealData: DealDataLike | null | undefined,
  dealEmail?: string,
  diligenciados?: DiligentedPersonInput[] | null,
  options?: PlannerOptions
): ExtractionPlan {
  const data = dealData ?? {};
  const jobs: PlannedJob[] = [];
  const skipped: SkippedJob[] = [];
  const email = isValidEmail(dealEmail) ? dealEmail.trim() : DEFAULT_EMAIL;
  const expandAll = options?.expandAll === true;
  const govBrActive = options?.govBrActive === true;
  const onrActive = options?.onrActive === true;
  const extraRegions = options?.extraRegions ?? [];
  const imoveis = (data.imoveis ?? []) as Imovel[];

  const pessoas: Array<{ kind: TargetKind; index: number; parte: Parte }> = [];
  (data.vendedores ?? []).forEach((p, i) => {
    pessoas.push({ kind: "vendedor", index: i, parte: p });
    // Dependentes do VENDEDOR são sempre diligenciados junto (decisão do
    // usuário 2026-05-22): cônjuge, procurador e — para vendedor PJ — o
    // representante PF que assina. Compradores e seus dependentes NÃO entram
    // por padrão (gerar à toa queima crédito Infosimples).
    for (const dep of dependentesDoVendedor(p, i)) {
      pessoas.push(dep);
    }
  });
  (data.compradores ?? []).forEach((p, i) =>
    pessoas.push({ kind: "comprador", index: i, parte: p })
  );
  // F3: diligenciados are treated like partes for personal certidões
  (diligenciados ?? []).forEach((d, i) =>
    pessoas.push({ kind: "diligenciado", index: i, parte: diligenciadoToParte(d) })
  );

  // Phase K (2026-04-18) — flag para ativar certidões extras quando a
  // transação é financiamento bancário (Mapeamento 2.1.4: antecedentes PF
  // obrigatório em financiamento, facultativo em particular).
  const isFinanciamento = data.modalidade === "financiamento";

  for (const { kind, index, parte } of pessoas) {
    const isPJ = parte.tipo_pessoa === "juridica";
    const label = personLabel(parte);
    const cpf = normalizeCpf(parte.cpf);
    const cnpj = normalizeCnpj(parte.cnpj);
    const partyUf = uf(parte);

    // Redesign 2026-05-26 — conjunto de regiões PADRÃO da pessoa. Lado vendedor
    // = região do(s) imóvel(eis) + locais extras + endereço da parte; comprador/
    // diligenciado = só a própria. Endpoints regionais (TJ/TRF/CEAT/dívida/
    // CENPROT-SP/municipal-pessoa) disparam por região; cada job ganha `region`.
    // `regionalDispatched` deduplica por endpoint+UF (UF-scoped) para não repetir
    // quando vendedor e imóvel compartilham a UF.
    const personRegions = computeRegionsForPerson(kind, parte, imoveis, extraRegions);
    const regionByUf = new Map<string, JobRegion>();
    for (const r of personRegions) if (r.uf && !regionByUf.has(r.uf)) regionByUf.set(r.uf, r);
    // UFs a disparar nos endpoints regionais: em expandAll mantém o comportamento
    // legado (todas as UFs cobertas, por endpoint); senão, as UFs das regiões.
    const personRegionUfs = Array.from(regionByUf.keys());
    const regionFor = (ufv: string): JobRegion =>
      regionByUf.get(ufv) ?? makeRegion("outro", ufv);
    const regionalDispatched = new Set<string>();
    const pushRegional = (j: PlannedJob, dedupKey: string, region: JobRegion) => {
      if (regionalDispatched.has(dedupKey)) return;
      regionalDispatched.add(dedupKey);
      j.region = region;
      jobs.push(j);
    };
    // UFs dos endpoints regionais no plano padrão (não-expandAll). Fallback pro
    // partyUf quando a pessoa não tem nenhuma região derivável.
    const regionalUfs = personRegionUfs.length
      ? personRegionUfs
      : partyUf
      ? [partyUf]
      : [];

    // ---- CPF situação cadastral (Phase K, Mapeamento 2.1.5) ----
    // Filtro inicial obrigatório para toda PF. CPF irregular bloqueia
    // minuta inteira. Endpoint informativo (retorna JSON, não PDF).
    if (!isPJ) {
      const ep = "receita-federal/cpf";
      if (!cpf) {
        skipped.push(
          buildSkip(ep, kind, index, label, "cpf", "CPF inválido ou vazio")
        );
      } else {
        const birthdate = normalizeDate(parte.data_nascimento);
        if (!birthdate) {
          skipped.push(
            buildSkip(
              ep,
              kind,
              index,
              label,
              "data_nascimento",
              "Receita CPF exige data de nascimento — complete os dados da parte"
            )
          );
        } else {
          jobs.push(buildJob(ep, kind, index, label, { cpf, birthdate }));
        }
      }
    }

    // ---- Antecedentes Criminais PF (Phase K, Mapeamento 2.1.4) ----
    // Opcional em transação entre particulares; obrigatório em financiamento.
    // Dispara apenas para PF quando `deal.modalidade === "financiamento"`.
    if (!isPJ && isFinanciamento) {
      const ep = "antecedentes-criminais/pf/emit";
      if (!cpf) {
        skipped.push(
          buildSkip(ep, kind, index, label, "cpf", "CPF inválido")
        );
      } else {
        const birthdate = normalizeDate(parte.data_nascimento);
        const nomeMae =
          typeof parte.nome_mae === "string" && parte.nome_mae.trim()
            ? parte.nome_mae.trim()
            : null;
        if (!birthdate || !nomeMae) {
          // PF antecedentes costuma exigir data_nascimento + nome_mae
          const missing: string[] = [];
          if (!birthdate) missing.push("data_nascimento");
          if (!nomeMae) missing.push("nome_mae");
          skipped.push(
            buildSkip(
              ep,
              kind,
              index,
              label,
              missing[0] ?? "nome_mae",
              `Antecedentes PF exige ${missing.join(" + ")} — complete os dados da parte`
            )
          );
        } else {
          // Per doc: token*, nome*, birthdate* obrigatórios. cpf/nome_mae opcionais.
          // Campo se chama `birthdate` (ISO 8601), não `data_nascimento`.
          jobs.push(
            buildJob(ep, kind, index, label, {
              cpf,
              nome: label,
              birthdate,
              nome_mae: nomeMae,
            })
          );
        }
      }
    }

    // ---- PGFN CND Federal ----
    {
      const ep = "receita-federal/pgfn";
      if (isPJ) {
        if (!cnpj) {
          skipped.push(buildSkip(ep, kind, index, label, "cnpj", "CNPJ invalido ou vazio"));
        } else {
          jobs.push(buildJob(ep, kind, index, label, { cnpj, preferencia_emissao: "2via" }));
        }
      } else {
        if (!cpf) {
          skipped.push(buildSkip(ep, kind, index, label, "cpf", "CPF invalido ou vazio"));
        } else {
          const birthdate = normalizeDate(parte.data_nascimento);
          if (!birthdate) {
            skipped.push(
              buildSkip(
                ep,
                kind,
                index,
                label,
                "data_nascimento",
                "PGFN exige data de nascimento da pessoa fisica"
              )
            );
          } else {
            jobs.push(
              buildJob(ep, kind, index, label, {
                cpf,
                birthdate,
                preferencia_emissao: "2via",
              })
            );
          }
        }
      }
    }

    // ---- CNDT ----
    {
      const ep = "tribunal/tst/cndt";
      if (isPJ && !cnpj) {
        skipped.push(buildSkip(ep, kind, index, label, "cnpj", "CNPJ invalido"));
      } else if (!isPJ && !cpf) {
        skipped.push(buildSkip(ep, kind, index, label, "cpf", "CPF invalido"));
      } else {
        jobs.push(
          buildJob(ep, kind, index, label, isPJ ? { cnpj } : { cpf })
        );
      }
    }

    // ---- TRF Cert Unificada + TRF Individual ----
    // J.1 (Phase J, 2026-04-18) — reverte I.4 skip default. Princípio:
    // TODA certidão solicitada é tentada. Falhas transitórias (600/615) são
    // retry automático pelo cron. Falha permanente (602 deprecated) vira
    // `failed_permanent` com `portalUrl` para extração manual.
    // `trf/cert-unificada` não emite PDF (retorna JSON agregado dos 6 TRFs)
    // — sai de CATEGORIES_REQUIRING_PDF (ver endpoints.ts).
    {
      const ep = "tribunal/trf/cert-unificada";
      if (isPJ && !cnpj) {
        skipped.push(buildSkip(ep, kind, index, label, "cnpj", "CNPJ invalido"));
      } else if (!isPJ && !cpf) {
        skipped.push(buildSkip(ep, kind, index, label, "cpf", "CPF invalido"));
      } else {
        jobs.push(
          buildJob(ep, kind, index, label, {
            tipo: 1,
            email,
            ...(isPJ ? { cnpj } : { cpf }),
          })
        );
      }
    }

    // TRF regional individual — retorna PDF.
    // TRFs 1/2/4/5/6 usam `tipo_certidao` (CIVEL/CRIMINAL/ELEITORAL),
    // disparamos 2 chamadas (Cível + Criminal) por pessoa.
    // TRF3 (SP/MS) é exceção: 2-step com `tipo` numérico — só dispara Cível
    // (`tipo: 1`) por enquanto; cron `poll-portal` busca o PDF no 2o passo.
    // Redesign: dispara o TRF individual em cada região (UF) do conjunto padrão
    // — dedup por endpoint (o slug já representa a corte, que cobre várias UFs).
    {
      const trfUfs = expandAll ? (partyUf ? [partyUf] : []) : regionalUfs;
      for (const ufv of trfUfs) {
        const ep = TRF_UF_MAP[ufv];
        if (!ep) continue;
        const region = regionFor(ufv);
        const isTrf3 = ep === "tribunal/trf3/certidao-distr";
        if (isPJ && !cnpj) {
          skipped.push(buildSkip(ep, kind, index, label, "cnpj", "CNPJ invalido"));
        } else if (!isPJ && !cpf) {
          skipped.push(buildSkip(ep, kind, index, label, "cpf", "CPF invalido"));
        } else if (isTrf3) {
          // TRF3: 1 chamada Cível (default). Per doc, cpf/cnpj e nome/razao_social
          // são MUTUAMENTE EXCLUSIVOS (607 quando ambos) — preferimos cpf/cnpj.
          pushRegional(
            buildJob(ep, kind, index, label, {
              tipo: 1,
              email,
              ...(isPJ ? { cnpj } : { cpf }),
            }),
            ep,
            region
          );
        } else {
          // TRFs 1/2/4/5/6: Cível + Criminal. tipo_certidao varia por TRF
          // (TRF5 = numérico "1"/"2"; demais = CIVEL/CRIMINAL).
          const tipos = TRF_TIPOS_BY_ENDPOINT[ep] ?? TRF_INDIVIDUAL_TIPOS;
          // TRF5 (e demais TRFs individuais) exigem `birthdate` quando o CPF é
          // usado para PF — sem ela o portal recusa com 606 "O parâmetro
          // 'birthdate' deve ser preenchido quando o campo 'CPF' for usado".
          // Antes o handler montava só cpf+nome (ao contrário de Receita/PGFN/
          // TJSP), então a certidão acusava "faltam dados" mesmo com a data no
          // formulário. Anexa quando a PF tem `data_nascimento`. (fix 2026-06-05)
          const trfBirthdate = !isPJ ? normalizeDate(parte.data_nascimento) : null;
          for (const t of tipos) {
            const trfArgs: Record<string, unknown> = {
              tipo_certidao: t.tipo_certidao,
              email,
              ...(isPJ ? { cnpj, razao_social: label } : { cpf, nome: label }),
            };
            if (trfBirthdate) trfArgs.birthdate = trfBirthdate;
            pushRegional(
              buildJob(ep, kind, index, `${label} - ${t.label}`, trfArgs),
              `${ep}|${t.tipo_certidao}`,
              region
            );
          }
        }
      }
    }

    // ---- CEAT (Trabalhista regional, Phase B) ----
    // Rota declarativa por UF. Em expandAll, dispara todas as UFs cobertas.
    // UF vazia no match natural cai em SP como default histórico (era o
    // comportamento anterior para partes sem UF declarada).
    const ceatUfsToDispatch: string[] = expandAll
      ? Object.keys(CEAT_ENDPOINT_BY_UF)
      : regionalUfs.length
      ? regionalUfs
      : ["SP"]; // fallback histórico p/ parte sem UF

    for (const targetUf of ceatUfsToDispatch) {
      const region = regionFor(targetUf);
      const endpointsList = CEAT_ENDPOINT_BY_UF[targetUf] ?? [];
      // UF sem cobertura CEAT → skip explicativo (pendência manual no relatório).
      if (!expandAll && endpointsList.length === 0) {
        skipped.push(
          buildSkip(
            "tribunal/trt-manual",
            kind,
            index,
            label,
            "cobertura",
            `TRT da UF ${targetUf} sem cobertura Infosimples — extrair manualmente no portal do TRT da região`
          )
        );
        continue;
      }
      for (const ep of endpointsList) {
        // TRT2 digital é o único que aceita cnpj_raiz (truncado 8 dígitos).
        if (ep === "tribunal/trt2/ceat-digital") {
          if (isPJ) {
            if (!cnpj) {
              skipped.push(buildSkip(ep, kind, index, label, "cnpj", "CNPJ invalido"));
            } else {
              pushRegional(buildJob(ep, kind, index, label, { cnpj_raiz: cnpj.slice(0, 8) }), ep, region);
            }
          } else if (!cpf) {
            skipped.push(buildSkip(ep, kind, index, label, "cpf", "CPF invalido"));
          } else {
            pushRegional(buildJob(ep, kind, index, label, { cpf }), ep, region);
          }
          continue;
        }
        // Todos os demais CEATs usam { nome?, cpf | cnpj }.
        if (isPJ && !cnpj) {
          skipped.push(buildSkip(ep, kind, index, label, "cnpj", "CNPJ invalido"));
        } else if (!isPJ && !cpf) {
          skipped.push(buildSkip(ep, kind, index, label, "cpf", "CPF invalido"));
        } else {
          pushRegional(
            buildJob(ep, kind, index, label, {
              nome: label,
              ...(isPJ ? { cnpj } : { cpf }),
            }),
            ep,
            region
          );
        }
      }
    }

    // ---- CND Estadual / Dívida Ativa PGE (Phase B) ----
    // Unificado via sefaz/certidao-debitos; SP usa endpoint dedicado.
    {
      const debtUfs = expandAll ? (partyUf ? [partyUf] : []) : regionalUfs;
      if (debtUfs.length === 0 && !expandAll) {
        skipped.push(
          buildSkip(
            "sefaz/certidao-debitos",
            kind,
            index,
            label,
            "uf",
            "CND Estadual exige UF da parte"
          )
        );
      }
      for (const ufv of debtUfs) {
        const stateEp = stateDebtEndpointForUf(ufv);
        const region = regionFor(ufv);
        if (isPJ && !cnpj) {
          skipped.push(buildSkip(stateEp, kind, index, label, "cnpj", "CNPJ invalido"));
        } else if (!isPJ && !cpf) {
          skipped.push(buildSkip(stateEp, kind, index, label, "cpf", "CPF invalido"));
        } else {
          const args: Record<string, unknown> = isPJ ? { cnpj } : { cpf };
          // SEFAZ unificada exige UF; SP-específico não precisa.
          if (stateEp === "sefaz/certidao-debitos") args.uf = ufv;
          pushRegional(buildJob(stateEp, kind, index, label, args), `${stateEp}|${ufv}`, region);
        }
      }
    }

    // ---- CND Municipal por contribuinte (Phase L+) — ex.: Curitiba ----
    // Alguns municípios emitem a CND municipal por CPF/CNPJ (não por imóvel).
    // Dispara quando a parte é daquele município (UF|cidade), ou todas em
    // expandAll (picker). Sem cidade casada, não dispara nada (sem ruído).
    if (expandAll) {
      const munPessoaEps = Array.from(
        new Set(Object.values(MUNICIPAL_PESSOA_BY_KEY).flat())
      );
      for (const ep of munPessoaEps) {
        if (isPJ && !cnpj) {
          skipped.push(buildSkip(ep, kind, index, label, "cnpj", "CNPJ invalido"));
        } else if (!isPJ && !cpf) {
          skipped.push(buildSkip(ep, kind, index, label, "cpf", "CPF invalido"));
        } else {
          jobs.push(buildJob(ep, kind, index, label, isPJ ? { cnpj } : { cpf }));
        }
      }
    } else {
      // Por região (UF|cidade): CND municipal por contribuinte só existe em
      // algumas praças (ex.: Curitiba). dedup por endpoint+uf+cidade.
      for (const r of personRegions) {
        const munPessoaKey = `${r.uf}|${normalizeCidade(r.cidade)}`;
        const munPessoaEps = MUNICIPAL_PESSOA_BY_KEY[munPessoaKey] ?? [];
        for (const ep of munPessoaEps) {
          if (isPJ && !cnpj) {
            skipped.push(buildSkip(ep, kind, index, label, "cnpj", "CNPJ invalido"));
          } else if (!isPJ && !cpf) {
            skipped.push(buildSkip(ep, kind, index, label, "cpf", "CPF invalido"));
          } else {
            pushRegional(
              buildJob(ep, kind, index, label, isPJ ? { cnpj } : { cpf }),
              `${ep}|${r.uf}|${normalizeCidade(r.cidade)}`,
              r
            );
          }
        }
      }
    }

    // ---- PJ-only: Cartão CNPJ + CRF FGTS (Phase B) ----
    // Sempre disparar para PJ (sem custo-benefício em skip).
    if (isPJ && cnpj) {
      jobs.push(buildJob("receita-federal/cnpj", kind, index, label, { cnpj }));
      jobs.push(buildJob("caixa/regularidade", kind, index, label, { cnpj }));
    }

    // ---- CENPROT SP (Phase F.II-α) — remapeado de imóvel para pessoa ----
    // Consulta por CPF/CNPJ da própria parte. Só dispara quando UF=SP (única
    // cobertura Infosimples sem GOV.BR).
    // H.4 (Phase H, 2026-04-18): adicionado `uf: "SP"` no payload — portal
    // CENPROT exige location hint; sem ele, code 612/605 em ~75% dos casos.
    // CENPROT-SP é REDUNDANTE com o CENPROT Nacional (ieptb/protestos) quando
    // este dispara (govBrActive) — o Nacional cobre SP e o detalhamento de
    // cartórios SP é encadeado via ieptb/protestos-detalhes-sp. Então só dispara
    // o SP-direto quando o Nacional NÃO está disponível (sem GOV.BR).
    const hasSpRegion = regionByUf.has("SP") || partyUf === "SP";
    if ((expandAll || hasSpRegion) && (cpf || cnpj) && !govBrActive) {
      const region = regionByUf.get("SP") ?? makeRegion("outro", "SP");
      pushRegional(
        buildJob("cenprot-sp/protestos", kind, index, label, {
          uf: "SP",
          ...(cnpj ? { cnpj } : { cpf: cpf! }),
        }),
        "cenprot-sp/protestos",
        region
      );
    }

    // ---- CENPROT Nacional (Phase F.II-γ) — exige GOV.BR ativo ----
    // Cobertura nacional de protestos (IEPTB/CENPROT) para TODAS as partes,
    // independente da UF (2026-05-21: API liberada com sessão GOV.BR ativa na
    // conta Infosimples). Partes de SP recebem também `cenprot-sp/protestos`
    // (consulta SP direta) e o detalhamento de cartórios SP é encadeado pelo
    // executor via `ieptb/protestos-detalhes-sp`. Se a sessão GOV.BR cair,
    // registra SkippedJob com instrução clara ao admin.
    if (cpf || cnpj) {
      const ep = "ieptb/protestos";
      if (govBrActive) {
        jobs.push(
          buildJob(ep, kind, index, label, cnpj ? { cnpj } : { cpf: cpf! })
        );
      } else {
        skipped.push(
          buildSkip(
            ep,
            kind,
            index,
            label,
            "govbr",
            "CENPROT Nacional requer autenticação GOV.BR ativa na conta Infosimples. Configure em Settings → Certidões → GOV.BR."
          )
        );
      }
    }

    // ---- Pesquisa de bens ONR (Phase L) — diligência patrimonial nacional ----
    // `onr/mapa-registro-imoveis` localiza imóveis em nome do CPF/CNPJ. Custo no
    // saldo do portal ONR. Camada "pesquisa" (NÃO marcada por padrão) → aparece
    // como opção opt-in na seção "Pesquisa adicional", sem inflar o custo padrão.
    // Restrito ao lado vendedor (diligência patrimonial dos vendedores). Quando
    // não há credencial ONR, vira skip explicando como habilitar.
    if ((cpf || cnpj) && VENDEDOR_SIDE_KINDS.has(kind)) {
      const ep = "onr/mapa-registro-imoveis";
      if (onrActive) {
        jobs.push(
          buildJob(ep, kind, index, label, cnpj ? { cnpj } : { cpf: cpf! })
        );
      } else {
        skipped.push(
          buildSkip(
            ep,
            kind,
            index,
            label,
            "onr",
            "Pesquisa de bens ONR requer credenciais ONR/ARISP. Configure em Settings → Certidões → ONR."
          )
        );
      }
    }
  }

  // ---- Imóveis (Phase L, 2026-05-22 — trilha reativada) ----
  // IPTU/CND municipal (por município coberto), matrícula ONR (two-step) e CCIR
  // (rural). Auto-dispara quando o imóvel tem os identificadores; sem eles emite
  // SkippedJob com missingFields para o fluxo "Completar campos".
  (data.imoveis ?? []).forEach((imovel, index) => {
    const kind: TargetKind = "imovel";
    const imUf = uf(imovel);
    const cidadeNorm = normalizeCidade(imovel.cidade);
    const label =
      [imovel.rua, imovel.cidade].filter(Boolean).join(", ") ||
      `Imóvel ${index + 1}`;

    // --- Municipal (IPTU / CND) ---
    const munKey = `${imUf}|${cidadeNorm}`;
    const munSpecs = MUNICIPAL_BY_KEY[munKey];
    if (munSpecs) {
      for (const spec of munSpecs) {
        if (spec.extraOnly && !expandAll) continue;
        const idValue =
          spec.requiresField === "sql"
            ? imovel.sql
            : imovel.inscricao_municipal || imovel.inscricao_iptu;
        if (!idValue || !String(idValue).trim()) {
          skipped.push(
            buildSkip(
              spec.endpoint,
              kind,
              index,
              label,
              spec.requiresField,
              spec.requiresField === "sql"
                ? "IPTU São Paulo exige o SQL (Setor-Quadra-Lote) do imóvel"
                : "Certidão municipal exige a inscrição municipal/imobiliária do imóvel"
            )
          );
        } else {
          jobs.push(
            buildJob(spec.endpoint, kind, index, label, {
              [spec.paramName]: String(idValue).trim(),
              ...(spec.extraArgs ? spec.extraArgs() : {}),
            })
          );
        }
      }
    } else if (imUf && imovel.cidade) {
      // Município sem cobertura Infosimples → pendência manual com portal.
      skipped.push(
        buildSkip(
          "pref/municipal-manual",
          kind,
          index,
          label,
          "cobertura",
          `IPTU/CND municipal de ${imovel.cidade}/${imUf} sem cobertura Infosimples — extrair manualmente no portal da prefeitura`
        )
      );
    }

    // --- Matrícula ONR (two-step) ---
    {
      const ep = "registradores/matric/pedido";
      const matricula = (imovel.matricula || "").trim();
      const cartorio = (imovel.cartorio || "").trim();
      if (!matricula) {
        skipped.push(
          buildSkip(
            ep,
            kind,
            index,
            label,
            "matricula",
            "Matrícula ONR exige o número da matrícula do imóvel"
          )
        );
      } else if (!onrActive) {
        skipped.push(
          buildSkip(
            ep,
            kind,
            index,
            label,
            "onr",
            "Matrícula ONR requer credenciais ONR/ARISP. Configure em Settings → Certidões → ONR."
          )
        );
      } else if (!cartorio && !(imUf && imovel.cidade)) {
        skipped.push(
          buildSkip(
            ep,
            kind,
            index,
            label,
            "cartorio",
            "Matrícula ONR exige o cartório (ou município + UF) do registro"
          )
        );
      } else {
        jobs.push(
          buildJob(ep, kind, index, label, {
            matricula,
            finalidade: DEFAULT_FINALIDADE,
            email,
            ...(cartorio ? { cartorio } : {}),
            ...(imovel.cidade ? { municipio: imovel.cidade } : {}),
            ...(imUf ? { uf: imUf } : {}),
          })
        );
      }
    }

    // --- CCIR (rural) ---
    if (isImovelRural(imovel)) {
      const ep = "sncr/ccir";
      const codigo = (imovel.codigo_incra || imovel.nirf || "").toString().trim();
      if (!codigo) {
        skipped.push(
          buildSkip(
            ep,
            kind,
            index,
            label,
            "codigo_incra",
            "CCIR exige o código do imóvel rural (INCRA/SNCR ou NIRF)"
          )
        );
      } else {
        jobs.push(buildJob(ep, kind, index, label, { codigo_imovel: codigo }));
      }
    }
  });

  // ---- TJ estadual por parte (segue UF da parte, ou todas com expandAll) ----
  for (const { kind, index, parte } of pessoas) {
    const partyUf = uf(parte);
    const label = personLabel(parte);
    const isPJ = parte.tipo_pessoa === "juridica";
    const cpf = normalizeCpf(parte.cpf);
    const cnpj = normalizeCnpj(parte.cnpj);

    // Redesign 2026-05-26 — TJ estadual segue o conjunto de regiões padrão
    // (imóvel + endereço do vendedor), não só a UF da parte. Cada job de TJ
    // ganha `region`; o tier é aplicado no pós-processamento.
    const tjRegions = computeRegionsForPerson(kind, parte, imoveis, extraRegions);
    const tjRegionByUf = new Map<string, JobRegion>();
    for (const r of tjRegions) if (r.uf && !tjRegionByUf.has(r.uf)) tjRegionByUf.set(r.uf, r);
    const tjRegionFor = (ufv: string): JobRegion =>
      tjRegionByUf.get(ufv) ?? makeRegion("outro", ufv);
    const tjRegionUfs = tjRegionByUf.size
      ? Array.from(tjRegionByUf.keys())
      : partyUf
      ? [partyUf]
      : [];
    const tjBefore = jobs.length;
    const tjSkipBefore = skipped.length;

    const tjShouldSP = expandAll || tjRegionByUf.has("SP");
    const tjShouldRJ = expandAll || tjRegionByUf.has("RJ");
    const tjShouldRS = expandAll || tjRegionByUf.has("RS");

    if (tjShouldSP) {
      // Migração 2026-05-23 — Certidão de Distribuição via `pedido-certidao`
      // (modelo numérico). modelo 4 = Cível em Geral SAJ SGC (engloba cíveis +
      // família + execuções fiscais), modelo 1 = Falências/Concordatas/Recuperações.
      //   - PJ: cnpj + razao_social (sem rg).
      //   - PF COM rg: 2 pedidos (modelo 4 + 1).
      //   - PF SEM rg: pedido-certidao não pode emitir (606 exige rg). Fallback
      //     para o legado `pedido-civel` (eproc, cível-only, dispensa rg) para não
      //     regredir a cobertura cível, + skip pedindo o RG para a certidão completa.
      // Auth GOV.BR é injetada centralmente em callInfosimples (não aqui).
      const epCert = "tribunal/tjsp/pedido-certidao";
      const epCivel = "tribunal/tjsp/pedido-civel";
      const partyRg = (parte.rg || "").trim();
      if ((!isPJ && !cpf) || (isPJ && !cnpj)) {
        skipped.push(
          buildSkip(epCert, kind, index, label, isPJ ? "cnpj" : "cpf", "documento invalido")
        );
      } else if (isPJ) {
        for (const m of TJSP_MODELOS) {
          jobs.push(
            buildJob(epCert, kind, index, `${label} - ${m.label}`, {
              modelo: m.modelo,
              cnpj: cnpj!,
              razao_social: label,
              // e-mail distinto por pedido → evita 604 throttle do e-SAJ.
              // kind+index no token: a MESMA pessoa em 2 papéis (ex.: PF vendedora
              // que também é representante de PJ) não compartilha alias.
              email_envio: aliasEmail(email, emailToken(cnpj, "tjsp", m.modelo, kind, index)),
            })
          );
        }
      } else if (partyRg && !sexoToGenero(parte.sexo)) {
        // PF com RG mas SEM sexo → pedido-certidao exige `genero` (606 sem).
        // Skip pedindo o dado em vez de disparar e queimar a chamada.
        skipped.push(
          buildSkip(
            epCert,
            kind,
            index,
            label,
            "sexo",
            "TJSP exige o sexo da parte — complete o cadastro"
          )
        );
      } else if (partyRg) {
        const dob = normalizeDate(parte.data_nascimento);
        const genero = sexoToGenero(parte.sexo)!;
        for (const m of TJSP_MODELOS) {
          const base: Record<string, unknown> = {
            modelo: m.modelo,
            cpf: cpf!,
            rg: partyRg,
            nome_completo: label,
            genero,
            // e-mail distinto por pedido → evita 604 throttle do e-SAJ.
            // kind+index no token: mesma pessoa em 2 papéis não compartilha alias.
            email_envio: aliasEmail(email, emailToken(cpf, "tjsp", m.modelo, kind, index)),
          };
          if (dob) base.birthdate = dob;
          if (parte.nome_mae) base.nome_mae = parte.nome_mae;
          jobs.push(buildJob(epCert, kind, index, `${label} - ${m.label}`, base));
        }
      } else {
        // PF sem RG → fallback cível legado (precisa de data_nascimento) + skip RG.
        if (!parte.data_nascimento) {
          skipped.push(
            buildSkip(
              epCivel,
              kind,
              index,
              label,
              "data_nascimento",
              "TJSP exige data de nascimento — complete os dados da parte"
            )
          );
        } else {
          // TJSP: usa a região SP (pode vir do imóvel, não só do endereço).
          const spRegion = tjRegionFor("SP");
          const partyMunicipio = (spRegion.cidade || parte.cidade || "").trim();
          const base: Record<string, unknown> = {
            // e-mail distinto por pedido → evita 604 throttle do e-SAJ
            email: aliasEmail(email, emailToken(cpf, "tjspcivel", kind, index)),
            finalidade: DEFAULT_FINALIDADE,
            instancia: 1,
            tipo_certidao: "civel",
            pais: "Brasil",
            uf: "SP",
            ...(partyMunicipio ? { municipio: partyMunicipio } : {}),
            cpf: cpf!,
            nome: label,
          };
          const dob = normalizeDate(parte.data_nascimento);
          if (dob) base.data_nascimento = dob;
          if (parte.nome_mae) base.nome_mae = parte.nome_mae;
          jobs.push(
            buildJob(epCivel, kind, index, `${label} - Cível (Ações Cíveis em Geral)`, base)
          );
        }
        // Sugere completar o RG para destravar a Certidão de Distribuição
        // completa (Cível-Geral SAJ SGC + Falências) via pedido-certidao.
        skipped.push(
          buildSkip(
            epCert,
            kind,
            index,
            label,
            "rg",
            "Adicione o RG da parte para emitir a Certidão de Distribuição completa (Cível-Geral SAJ SGC + Falências)"
          )
        );
      }

      // E-Proc SP — lista de processos eletrônicos (1ª/2ª instância), sempre.
      jobs.push(
        buildJob(
          "tribunal/tjsp/eproc-lista",
          kind,
          index,
          `${label} - E-Proc`,
          isPJ ? { cnpj: cnpj! } : { cpf: cpf! }
        )
      );
    }
    if (tjShouldRJ) {
      const ep = "tribunal/tjrj/pedido-cert";
      if ((!isPJ && !cpf) || (isPJ && !cnpj)) {
        skipped.push(
          buildSkip(ep, kind, index, label, isPJ ? "cnpj" : "cpf", "documento invalido")
        );
      } else {
        // Phase F.II-γ — multi-tipo TJRJ: cível, família, falência, execução fiscal.
        // Comarca segue a região RJ (pode vir do imóvel, não só do endereço).
        const rjRegion = tjRegionFor("RJ");
        const cidade = (rjRegion.cidade || parte.cidade || "").trim();
        const comarca = comarcaForCidade(cidade);
        for (const t of TJRJ_TIPOS) {
          const base: Record<string, unknown> = {
            nome: label,
            email,
            tipo_certidao: t.tipo_certidao,
            comarca,
            finalidade: DEFAULT_FINALIDADE,
            ...(isPJ ? { cnpj: cnpj! } : { cpf: cpf! }),
          };
          // H.3 — mesma política de TJSP: anexar data_nascimento/nome_mae para PF
          if (!isPJ) {
            const dob = normalizeDate(parte.data_nascimento);
            if (dob) base.data_nascimento = dob;
            if (parte.nome_mae) base.nome_mae = parte.nome_mae;
          }
          jobs.push(buildJob(ep, kind, index, `${label} - ${t.label}`, base));
        }
      }
    }
    if (tjShouldRS) {
      const ep = "tribunal/tjrs/primeiro-grau";
      if ((!isPJ && !cpf) || (isPJ && !cnpj)) {
        skipped.push(
          buildSkip(ep, kind, index, label, isPJ ? "cnpj" : "cpf", "documento invalido")
        );
      } else {
        for (const t of TJRS_TIPOS) {
          jobs.push(
            buildJob(ep, kind, index, `${label} - ${t.label}`, {
              tipo_certidao: t.tipo,
              nome: label,
              ...(isPJ ? { cnpj: cnpj! } : { cpf: cpf! }),
            })
          );
        }
      }
    }

    // Phase B — Cíveis adicionais (BA, GO, DF, SC, MS, MT). Usa tabela
    // declarativa CIVIL_ENDPOINT_BY_UF. Só dispara se a UF da parte está
    // coberta E não é SP/RJ/RS (tratados separadamente acima). Em expandAll,
    // dispara todas as UFs da tabela.
    const additionalUfsToTry: string[] = expandAll
      ? Object.keys(CIVIL_ENDPOINT_BY_UF)
      : tjRegionUfs.filter((u) => u in CIVIL_ENDPOINT_BY_UF);

    for (const tjUf of additionalUfsToTry) {
      const ep = CIVIL_ENDPOINT_BY_UF[tjUf];
      if (!ep) continue;
      // TJMT aceita apenas PF.
      if (ep === "tribunal/tjmt/primeiro-grau-pf" && isPJ) {
        skipped.push(
          buildSkip(
            ep,
            kind,
            index,
            label,
            "tipo_pessoa",
            "TJMT não emite certidão para pessoa jurídica via Infosimples — extrair manualmente"
          )
        );
        continue;
      }
      if ((!isPJ && !cpf) || (isPJ && !cnpj)) {
        skipped.push(
          buildSkip(ep, kind, index, label, isPJ ? "cnpj" : "cpf", "documento invalido")
        );
        continue;
      }
      // TJMS é two-step (só dispara o pedido; obter roda via cron). Outros
      // TJs são single-step.
      const args: Record<string, unknown> = {
        email,
        nome_razao_social: label,
        nome: label,
        finalidade: DEFAULT_FINALIDADE,
        ...(isPJ ? { cnpj: cnpj! } : { cpf: cpf! }),
      };
      if (parte.data_nascimento && !isPJ) {
        args.birthdate = normalizeDate(parte.data_nascimento);
      }
      jobs.push(buildJob(ep, kind, index, label, args));
    }

    // Phase B — UFs sem cobertura cível Infosimples: MG, PR, ES + demais.
    // Registrar skip informativo somente se expandAll=false E UF não está em
    // nenhuma das trilhas cobertas (SP/RJ/RS/BA/GO/DF/SC/MS/MT).
    const hasCivilCoverage =
      ["SP", "RJ", "RS"].includes(partyUf) ||
      partyUf in CIVIL_ENDPOINT_BY_UF;
    if (!expandAll && partyUf && !hasCivilCoverage) {
      skipped.push(
        buildSkip(
          "tribunal/tj-manual",
          kind,
          index,
          label,
          "cobertura",
          `TJ da UF ${partyUf} sem cobertura Infosimples — extrair manualmente no portal TJ${partyUf}`
        )
      );
    }

    // Tagueia `region` nos jobs/skips de TJ desta iteração pela UF da corte
    // (o slug codifica a corte). Fallback: região do partyUf / "outro".
    const tjUfForEndpoint = (ep: string): string | null => {
      if (ep.includes("/tjsp/")) return "SP";
      if (ep.includes("/tjrj/")) return "RJ";
      if (ep.includes("/tjrs/")) return "RS";
      for (const [u, e] of Object.entries(CIVIL_ENDPOINT_BY_UF)) if (e === ep) return u;
      return null;
    };
    for (let i = tjBefore; i < jobs.length; i++) {
      if (jobs[i].region) continue;
      const u = tjUfForEndpoint(jobs[i].endpoint);
      jobs[i].region = u ? tjRegionFor(u) : makeRegion("outro", partyUf);
    }
    for (let i = tjSkipBefore; i < skipped.length; i++) {
      if (skipped[i].region) continue;
      const u = tjUfForEndpoint(skipped[i].endpoint);
      skipped[i].region = u ? tjRegionFor(u) : makeRegion("outro", partyUf);
    }
  }

  // ---- Serasa Experian (score + restritivos) ----
  // Gate: roda APENAS em `expandAll` (i.e. quando o picker pede o catálogo
  // completo). O auto-plan default fica Infosimples-only pra evitar surpresa
  // de custo — usuário tem que marcar Serasa explicitamente no picker. Além
  // disso, exige `isSerasaConfigured()` (env vars set) e consentimento LGPD
  // checado na rota POST /certidoes (412 sem ele).
  //
  // Vínculos PJ↔PF (serasa/vinculos-pj-pf) NUNCA entra aqui — disparo só via
  // POST /api/deals/:id/serasa/expand-vinculos (opt-in manual, S4).
  if (expandAll && isSerasaConfigured()) {
    for (const { kind, index, parte } of pessoas) {
      const isPJ = parte.tipo_pessoa === "juridica";
      const label = personLabel(parte);
      const cpf = normalizeCpf(parte.cpf);
      const cnpj = normalizeCnpj(parte.cnpj);
      const scoreEp = isPJ ? "serasa/score-pj" : "serasa/score-pf";
      const restritivosEp = isPJ ? "serasa/restritivos-pj" : "serasa/restritivos-pf";
      if (isPJ) {
        if (!cnpj) {
          skipped.push(buildSkip(scoreEp, kind, index, label, "cnpj", "CNPJ invalido"));
          skipped.push(buildSkip(restritivosEp, kind, index, label, "cnpj", "CNPJ invalido"));
        } else {
          jobs.push(buildJob(scoreEp, kind, index, label, { cnpj }));
          jobs.push(buildJob(restritivosEp, kind, index, label, { cnpj }));
        }
      } else {
        if (!cpf) {
          skipped.push(buildSkip(scoreEp, kind, index, label, "cpf", "CPF invalido"));
          skipped.push(buildSkip(restritivosEp, kind, index, label, "cpf", "CPF invalido"));
        } else {
          jobs.push(buildJob(scoreEp, kind, index, label, { cpf }));
          jobs.push(buildJob(restritivosEp, kind, index, label, { cpf }));
        }
      }
    }
  }

  // ---- Pós-processamento: tier (todos) + região default (federais/imóvel) ----
  const imovelRegionForIndex = (idx: number): JobRegion => {
    const im = imoveis[idx];
    return makeRegion("imovel", im?.uf, im?.cidade);
  };
  const applyTierRegion = (j: PlannedJob | SkippedJob) => {
    j.tier = tierForJob(j.targetKind, j.endpoint);
    if (!j.region) {
      if (j.targetKind === "imovel") j.region = imovelRegionForIndex(j.targetIndex);
      else j.region = { kind: "nacional", label: "Nacional" }; // federais/pesquisa pessoa
    }
  };
  jobs.forEach(applyTierRegion);
  skipped.forEach(applyTierRegion);

  const totalCostCents = jobs.reduce((acc, j) => acc + j.costCents, 0);
  return { jobs, skipped, totalCostCents };
}

// ---- builders -----------------------------------------------------

function buildJob(
  endpoint: string,
  kind: TargetKind,
  index: number,
  partyOrImmLabel: string,
  args: Record<string, unknown>
): PlannedJob {
  const info = endpointInfo(endpoint);
  return {
    endpoint,
    label: `${info.label} - ${partyOrImmLabel}`,
    targetKind: kind,
    targetIndex: index,
    requestPayload: args,
    costCents: info.costCents,
  };
}

function buildSkip(
  endpoint: string,
  kind: TargetKind,
  index: number,
  partyLabel: string,
  missingField: string,
  reason: string
): SkippedJob {
  const info = endpointInfo(endpoint);
  const basePath =
    kind === "imovel"
      ? `imoveis.${index}`
      : kind === "diligenciado"
      ? `diligenciados.${index}`
      : kind === "conjuge_vendedor"
      ? `vendedores.${index}.conjuge`
      : kind === "procurador_vendedor"
      ? `vendedores.${index}.procurador`
      : kind === "representante_vendedor"
      ? `vendedores.${index}.representante`
      : `${kind}es.${index}`;
  const missingFields: MissingField[] = buildMissingFieldsForSkip(
    missingField,
    basePath,
    partyLabel
  );
  return {
    endpoint,
    label: `${info.label} - ${partyLabel}`,
    targetKind: kind,
    targetIndex: index,
    reason,
    missingField,
    missingFields,
  };
}

/**
 * Maps the shorthand `missingField` string used inside the planner into
 * one or more `MissingField` structured entries for the complement-data UI.
 * Falls back to a single generic text field if no specific mapping exists.
 */
function buildMissingFieldsForSkip(
  missingField: string,
  basePath: string,
  partyLabel: string
): MissingField[] {
  switch (missingField) {
    case "data_nascimento":
      return [
        {
          path: `${basePath}.data_nascimento`,
          label: `Data de nascimento — ${partyLabel}`,
          type: "date",
          placeholder: "AAAA-MM-DD",
        },
      ];
    case "rg":
      return [
        {
          path: `${basePath}.rg`,
          label: `RG — ${partyLabel}`,
          type: "text",
          placeholder: "00.000.000-0",
        },
      ];
    case "sql":
      return [
        {
          path: `${basePath}.sql`,
          label: `SQL (Setor-Quadra-Lote) — ${partyLabel}`,
          type: "text",
          placeholder: "000.000.0000-0",
        },
      ];
    case "inscricao_municipal":
      return [
        {
          path: `${basePath}.inscricao_municipal`,
          label: `Inscrição Municipal — ${partyLabel}`,
          type: "text",
          placeholder: "00000000",
        },
      ];
    case "matricula":
      return [
        {
          path: `${basePath}.matricula`,
          label: `Matrícula — ${partyLabel}`,
          type: "text",
          placeholder: "000000",
        },
      ];
    case "cartorio":
      return [
        {
          path: `${basePath}.cartorio`,
          label: `Cartório de Registro de Imóveis — ${partyLabel}`,
          type: "text",
          placeholder: "Ex.: 1º RI da Comarca",
        },
      ];
    case "codigo_incra":
      return [
        {
          path: `${basePath}.codigo_incra`,
          label: `Código do imóvel rural (INCRA/NIRF) — ${partyLabel}`,
          type: "text",
          placeholder: "000.000.000.000-0",
        },
      ];
    case "cidade":
      return [
        {
          path: `${basePath}.cidade`,
          label: `Cidade — ${partyLabel}`,
          type: "text",
          placeholder: "Nome da cidade",
        },
      ];
    default:
      return [
        {
          path: `${basePath}.${missingField}`,
          label: `${missingField} — ${partyLabel}`,
          type: "text",
        },
      ];
  }
}
