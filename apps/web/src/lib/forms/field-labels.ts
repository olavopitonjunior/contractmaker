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

export interface FieldCatalogGroup {
  step: number;
  label: string;
  paths: ReadonlyArray<{ path: string; label: string }>;
}

// Catálogo dos paths editáveis no override fino de obrigatoriedade. Não é
// exaustivo — só os campos onde faz sentido permitir override por org. Paths
// fora desta lista podem ser adicionados manualmente via API se necessário.
export const VENDA_FIELD_CATALOG: ReadonlyArray<FieldCatalogGroup> = [
  {
    step: 1,
    label: "Vendedor",
    paths: [
      { path: "vendedores.0.cpf", label: "CPF" },
      { path: "vendedores.0.rg", label: "RG" },
      { path: "vendedores.0.data_nascimento", label: "Data de nascimento" },
      { path: "vendedores.0.nome_mae", label: "Nome da mãe (TJSP/PGFN)" },
      { path: "vendedores.0.estado_civil", label: "Estado civil" },
      { path: "vendedores.0.profissao", label: "Profissão" },
      { path: "vendedores.0.email", label: "Email" },
      { path: "vendedores.0.mobile_phone", label: "Celular" },
      { path: "vendedores.0.endereco", label: "Endereço (rua)" },
      { path: "vendedores.0.cidade", label: "Cidade" },
      { path: "vendedores.0.uf", label: "UF" },
      { path: "vendedores.0.cep", label: "CEP" },
    ],
  },
  {
    step: 2,
    label: "Comprador",
    paths: [
      { path: "compradores.0.cpf", label: "CPF" },
      { path: "compradores.0.rg", label: "RG" },
      { path: "compradores.0.data_nascimento", label: "Data de nascimento" },
      { path: "compradores.0.nome_mae", label: "Nome da mãe (TJSP/PGFN)" },
      { path: "compradores.0.estado_civil", label: "Estado civil" },
      { path: "compradores.0.profissao", label: "Profissão" },
      { path: "compradores.0.email", label: "Email" },
      { path: "compradores.0.mobile_phone", label: "Celular" },
      { path: "compradores.0.endereco", label: "Endereço (rua)" },
      { path: "compradores.0.cidade", label: "Cidade" },
      { path: "compradores.0.uf", label: "UF" },
      { path: "compradores.0.cep", label: "CEP" },
    ],
  },
  {
    step: 3,
    label: "Imóvel",
    paths: [
      { path: "imoveis.0.numero", label: "Número" },
      { path: "imoveis.0.bairro", label: "Bairro" },
      { path: "imoveis.0.cep", label: "CEP" },
      { path: "imoveis.0.matricula", label: "Matrícula" },
      { path: "imoveis.0.cartorio", label: "Cartório" },
      { path: "imoveis.0.inscricao_iptu", label: "Inscrição IPTU" },
      { path: "imoveis.0.sql", label: "SQL (Setor.Quadra.Lote)" },
    ],
  },
  {
    step: 5,
    label: "Pagamento",
    paths: [
      { path: "modalidade", label: "Modalidade (à vista / financiamento)" },
      { path: "pagamento.sinal_arras", label: "Sinal/Arras" },
    ],
  },
];

// Steps do wizard de locação (LOCACAO_STEP_LABELS). Garantia fica de fora: o
// fiador só existe quando a garantia é fiança, e a exigência dele já é
// condicional no servidor (collectLocacaoFinalizeIssues).
export const LOCACAO_FIELD_CATALOG: ReadonlyArray<FieldCatalogGroup> = [
  {
    step: 1,
    label: "Locador",
    paths: [
      { path: "locadores.0.cpf", label: "CPF / CNPJ" },
      { path: "locadores.0.rg", label: "RG" },
      { path: "locadores.0.data_nascimento", label: "Data de nascimento" },
      { path: "locadores.0.nacionalidade", label: "Nacionalidade" },
      { path: "locadores.0.estado_civil", label: "Estado civil" },
      { path: "locadores.0.profissao", label: "Profissão" },
      { path: "locadores.0.email", label: "E-mail" },
      { path: "locadores.0.mobile_phone", label: "Celular" },
      { path: "locadores.0.endereco", label: "Endereço (rua)" },
      { path: "locadores.0.numero", label: "Número" },
      { path: "locadores.0.bairro", label: "Bairro" },
      { path: "locadores.0.cidade", label: "Cidade" },
      { path: "locadores.0.uf", label: "UF" },
      { path: "locadores.0.cep", label: "CEP" },
    ],
  },
  {
    step: 2,
    label: "Locatário",
    paths: [
      { path: "locatarios.0.cpf", label: "CPF / CNPJ" },
      { path: "locatarios.0.rg", label: "RG" },
      { path: "locatarios.0.data_nascimento", label: "Data de nascimento" },
      { path: "locatarios.0.nacionalidade", label: "Nacionalidade" },
      { path: "locatarios.0.estado_civil", label: "Estado civil" },
      { path: "locatarios.0.profissao", label: "Profissão" },
      { path: "locatarios.0.email", label: "E-mail" },
      { path: "locatarios.0.mobile_phone", label: "Celular" },
      { path: "locatarios.0.endereco", label: "Endereço (rua)" },
      { path: "locatarios.0.numero", label: "Número" },
      { path: "locatarios.0.bairro", label: "Bairro" },
      { path: "locatarios.0.cidade", label: "Cidade" },
      { path: "locatarios.0.uf", label: "UF" },
      { path: "locatarios.0.cep", label: "CEP" },
    ],
  },
  {
    step: 3,
    label: "Imóvel",
    paths: [
      { path: "imovel.numero", label: "Número" },
      { path: "imovel.bairro", label: "Bairro" },
      { path: "imovel.cep", label: "CEP" },
      { path: "imovel.matricula", label: "Matrícula" },
      { path: "imovel.cartorio", label: "Cartório" },
      { path: "imovel.inscricao_iptu", label: "Inscrição IPTU" },
    ],
  },
  {
    step: 4,
    label: "Aluguel e Reajuste",
    paths: [
      { path: "aluguel.vigencia_inicio", label: "Início da vigência" },
      { path: "aluguel.dia_vencimento", label: "Dia de vencimento" },
      { path: "aluguel.indice_reajuste", label: "Índice de reajuste" },
    ],
  },
];

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
  valor: "Valor do aluguel",
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
