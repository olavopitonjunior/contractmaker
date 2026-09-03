/**
 * Rótulos PT-BR de paths do formulário — fonte ÚNICA de quem traduz
 * `vendedores.1.cpf` em "Vendedor 2 — CPF".
 *
 * Dois consumidores que não se enxergavam: a tela de configuração
 * (/settings/formulario, que lista os campos com checkbox) e os toasts de
 * pendência dos wizards. Venda nem tinha o segundo — o toast dizia só
 * "Preencha os campos obrigatórios da etapa 3", e o cliente ficava caçando qual
 * campo é numa etapa com 20. Locação tinha um mapa próprio, inline no wizard.
 *
 * Client-safe (sem prisma) — os wizards são componentes de cliente.
 */

import {
  KNOWN_FORM_PATH_LIST,
  KNOWN_LOCACAO_PATH_LIST,
} from "@/lib/forms/presets";

export interface FieldCatalogGroup {
  step: number;
  label: string;
  paths: ReadonlyArray<{ path: string; label: string }>;
}


/** Rótulo por NOME DE CAMPO (último segmento) — fallback comum às 2 esteiras. */
const FIELD_LABELS: Record<string, string> = {
  // Paths GUARDA-CHUVA das listas: chegam sem índice quando a lista está vazia
  // (subtoken por parte, ou `missingRequired` do finalize). Sem estes, o toast
  // dizia "Preencha: Locadores" — humanizado do path, com o acento perdido.
  vendedores: "Vendedor",
  compradores: "Comprador",
  locadores: "Locador",
  locatarios: "Locatário",
  nome: "Nome",
  razao_social: "Razão social",
  cpf: "CPF",
  cnpj: "CNPJ",
  rg: "RG",
  data_nascimento: "Data de nascimento",
  nome_mae: "Nome da mãe",
  nacionalidade: "Nacionalidade",
  naturalidade: "Naturalidade",
  estado_civil: "Estado civil",
  profissao: "Profissão",
  sexo: "Sexo",
  email: "E-mail",
  mobile_phone: "Celular",
  telefone: "Telefone",
  endereco: "Endereço",
  rua: "Logradouro",
  numero: "Número",
  complemento: "Complemento",
  bairro: "Bairro",
  cidade: "Cidade",
  uf: "UF",
  cep: "CEP",
  matricula: "Matrícula",
  cartorio: "Cartório de registro",
  inscricao_iptu: "Inscrição IPTU",
  sql: "SQL (Setor-Quadra-Lote)",
  inscricao_municipal: "Inscrição municipal",
  descricao: "Descrição do imóvel",
  modalidade: "Modalidade",
  valor_total: "Valor total",
  sinal_arras: "Sinal/Arras",
  vigencia_inicio: "Início da vigência",
  dia_vencimento: "Dia de vencimento",
  indice_reajuste: "Índice de reajuste",
  adm_imobiliaria: "Administração pela imobiliária",
  encargos_repasse: "Tratamento dos encargos (paga e retém / repassa integral)",
  taxa_admin_percent: "Taxa de administração",
  contas_consumo_individualizadas: "Contas de consumo individualizadas",
  contas_no_condominio: "Contas no boleto do condomínio",
  clausula_rescisoria: "Cláusula rescisória",
  multa_rescisoria_meses: "Multa rescisória (nº de aluguéis)",
  // --- Imóvel ---
  kind: "Tipo do imóvel",
  destinacao: "Destinação (ramo de atividade)",
  area: "Área (m²)",
  vagas_garagem: "Vagas de garagem",
  condominio_nome: "Nome do condomínio",
  // --- Aluguel ---
  encargos: "Encargos mensais (total)",
  iptu_mensal: "IPTU mensal",
  condominio_mensal: "Condomínio mensal",
  outros_encargos: "Outros encargos",
  meio_pagamento: "Meio de pagamento",
  vigencia_meses: "Vigência (meses)",
  // --- Garantia ---
  provider: "Seguradora / provedora",
  cobertura_meses: "Cobertura (meses)",
  caucao_meses: "Caução (nº de aluguéis)",
  titulo_valor: "Título de capitalização (valor)",
  titulo_proposta: "Título de capitalização (nº da proposta)",
  seguro_tomador: "Tomador da apólice",
  seguro_vigencia: "Vigência da apólice",
  // --- Pessoas / renda ---
  renda_mensal: "Renda mensal declarada",
  faturamento_mensal: "Faturamento mensal",
  // --- Recebimento (PIX / conta) ---
  pix_chave: "Chave PIX",
  pix_tipo_chave: "Tipo da chave PIX",
  banco: "Banco",
  agencia: "Agência",
  conta: "Conta",
  tipo_conta: "Tipo de conta",
  // --- Pagamento (venda) ---
  recursos_proprios: "Recursos próprios",
  fgts: "FGTS",
  cessao_consorcio: "Cessão de consórcio",
  alienacao_fiduciaria: "Financiamento (alienação fiduciária)",
  outras_formas: "Outras formas",
  banco_financiamento: "Banco do financiamento",
  // --- Comissão ---
  creci: "CRECI",
  percentual: "Percentual",
  valor: "Valor",
  taxa_locacao_percent: "Taxa de locação (%)",
  taxa_locacao_valor: "Taxa de locação (R$)",
  observacoes: "Observações gerais",
  // --- Rótulos por PATH: o mesmo campo muda de nome conforme a seção ---
  "aluguel.valor": "Valor do aluguel",
  "comissao.valor": "Valor da comissão",
  "garantia.tipo": "Tipo de garantia",
  "garantia.fiador.nome": "Nome do fiador",
  "garantia.fiador.razao_social": "Razão social do fiador",
  "imovel.kind": "Tipo do imóvel",
};

/** Nome singular da lista de partes, pro prefixo "Vendedor 2 — …". */
const PARTY_SINGULAR: Record<string, string> = {
  vendedores: "Vendedor",
  compradores: "Comprador",
  locadores: "Locador",
  locatarios: "Locatário",
  imoveis: "Imóvel",
};

const LIST_PATH_RE = /^([a-z_]+)\.(\d+)\.(.+)$/;

/** Humaniza um segmento sem rótulo: `algum_campo_novo` → "Algum campo novo". */
function humanize(segment: string): string {
  const spaced = segment.replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * `vendedores.1.cpf` → "Vendedor 2 — CPF"; `pagamento.sinal_arras` → "Sinal/
 * Arras". Serve as duas esteiras: o que muda entre elas é só o vocabulário das
 * listas, já coberto por PARTY_SINGULAR.
 */
export function describeFormPath(path: string): string {
  const m = LIST_PATH_RE.exec(path);
  if (m) {
    const [, list, idx, rest] = m;
    const who = PARTY_SINGULAR[list] ?? humanize(list);
    const field = rest.split(".").pop() ?? rest;
    const label = FIELD_LABELS[field] ?? humanize(field);
    // Índice só aparece a partir do 2º — "Vendedor — CPF" some com o "1" que
    // não acrescenta nada quando há uma parte só.
    const n = Number(idx);
    return n > 0 ? `${who} ${n + 1} — ${label}` : `${who} — ${label}`;
  }
  const last = path.split(".").pop() ?? path;
  return FIELD_LABELS[path] ?? FIELD_LABELS[last] ?? humanize(last);
}

/** Alias histórico — a locação já chamava assim. */
export const describeLocacaoPath = describeFormPath;
export const describeVendaPath = describeFormPath;

/**
 * Frase pronta do toast: nomeia até `max` campos e resume o resto.
 * Ex.: "Preencha: Vendedor — CPF, Comprador — E-mail e mais 3".
 */
export function describeMissingPaths(paths: readonly string[], max = 4): string {
  const labels = paths.slice(0, max).map(describeFormPath);
  const extra = paths.length - labels.length;
  return `${labels.join(", ")}${extra > 0 ? ` e mais ${extra}` : ""}`;
}

/**
 * Etapa do wizard a que cada path pertence, por PREFIXO. É o único ponto que
 * precisa saber a numeração das etapas; o catálogo em si é derivado da
 * allowlist.
 */
const VENDA_STEP_BY_PREFIX: ReadonlyArray<[RegExp, number]> = [
  [/^vendedores/, 1],
  [/^compradores/, 2],
  [/^imoveis/, 3],
  [/^(modalidade$|pagamento.)/, 5],
  [/^(comissao.|testemunhas.|observacoes$)/, 6],
];

const LOCACAO_STEP_BY_PREFIX: ReadonlyArray<[RegExp, number]> = [
  [/^locadores/, 1],
  [/^locatarios/, 2],
  [/^imovel./, 3],
  [/^aluguel./, 4],
  [/^(garantia.|observacoes$)/, 5],
  [/^comissao./, 6],
];

const VENDA_STEP_LABELS: Record<number, string> = {
  1: "Vendedor",
  2: "Comprador",
  3: "Imóvel",
  5: "Pagamento",
  6: "Comissão, testemunhas e observações",
};

const LOCACAO_STEP_LABELS_CATALOG: Record<number, string> = {
  1: "Locador",
  2: "Locatário",
  3: "Imóvel",
  4: "Aluguel e reajuste",
  5: "Garantia e observações",
  6: "Comissão",
};

/** Prefixos de sub-objeto que viram parte do rótulo ("Cônjuge — CPF"). */
const SUB_OBJECT_LABELS: Record<string, string> = {
  conjuge: "Cônjuge",
  procurador: "Procurador",
  representante: "Representante",
  recebimento: "Recebimento",
  comissionados: "Comissionado",
  angariadores: "Angariador",
  testemunhas: "Testemunha",
};

/**
 * Rótulo do path DENTRO da etapa: o grupo já diz de quem é o campo, então aqui
 * fica só o campo — com o sub-objeto na frente quando existe.
 */
function labelWithinStep(path: string): string {
  const segs = path.split(".").filter((seg) => !/^\d+$/.test(seg));
  const field = segs[segs.length - 1];
  // Path completo primeiro: `comissao.valor` é "Valor da comissão", enquanto
  // `aluguel.valor` é "Valor do aluguel" — o nome do campo sozinho não decide.
  const porPath = FIELD_LABELS[path] ?? FIELD_LABELS[segs.join(".")];
  const base = porPath ?? FIELD_LABELS[field] ?? humanize(field);
  if (porPath) return base;
  // O primeiro segmento é a lista/seção (já no título do grupo); o penúltimo,
  // quando é um sub-objeto conhecido, qualifica o campo.
  const sub = segs.length > 2 ? SUB_OBJECT_LABELS[segs[segs.length - 2]] : undefined;
  if (sub) return `${sub} — ${base}`;
  // Lista no topo do path (testemunhas.0.nome, comissao.comissionados.0.cpf)
  const raiz = SUB_OBJECT_LABELS[segs[0]];
  if (raiz && segs.length > 1) return `${raiz} — ${base}`;
  return base;
}

/**
 * Monta o catálogo a partir da ALLOWLIST — a mesma lista que a rota
 * `PATCH /api/org/form-settings` valida.
 *
 * Antes havia duas listas mantidas à mão, e a da tela era um subconjunto: a
 * etapa Comissão inteira, os encargos e a garantia de locação, o endereço do
 * cônjuge e o recebimento das partes eram aceitos pela API e invisíveis para o
 * admin. Derivando, a tela oferece exatamente o que a rota aceita — nem mais
 * (path sem campo na tela vira pendência insolúvel), nem menos.
 */
function buildCatalog(
  paths: readonly string[],
  stepByPrefix: ReadonlyArray<[RegExp, number]>,
  stepLabels: Record<number, string>
): FieldCatalogGroup[] {
  const porStep = new Map<number, { path: string; label: string }[]>();
  for (const path of paths) {
    // Path guarda-chuva da lista ("vendedores") = "tem ao menos uma parte";
    // é exigência de preset, não checkbox de campo.
    if (!path.includes(".")) {
      if (path !== "modalidade" && path !== "observacoes") continue;
    }
    const hit = stepByPrefix.find(([re]) => re.test(path));
    if (!hit) continue;
    const step = hit[1];
    if (!porStep.has(step)) porStep.set(step, []);
    porStep.get(step)!.push({ path, label: labelWithinStep(path) });
  }
  return [...porStep.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([step, list]) => ({
      step,
      label: stepLabels[step] ?? `Etapa ${step + 1}`,
      paths: list.sort((a, b) => a.label.localeCompare(b.label, "pt-BR")),
    }));
}

export const VENDA_FIELD_CATALOG: ReadonlyArray<FieldCatalogGroup> = buildCatalog(
  KNOWN_FORM_PATH_LIST,
  VENDA_STEP_BY_PREFIX,
  VENDA_STEP_LABELS
);

export const LOCACAO_FIELD_CATALOG: ReadonlyArray<FieldCatalogGroup> = buildCatalog(
  KNOWN_LOCACAO_PATH_LIST,
  LOCACAO_STEP_BY_PREFIX,
  LOCACAO_STEP_LABELS_CATALOG
);
