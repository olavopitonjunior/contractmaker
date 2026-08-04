/**
 * Ponte PURA entre o formulário de proposta (página de criação/edição) e o
 * `dataJson` + `signers` que a API persiste.
 *
 * Existe separado do componente por três motivos:
 *  1. criação e edição usam a MESMA tradução — `build` e `parse` são inversos,
 *     então reabrir uma proposta em /editar devolve exatamente os campos que a
 *     criaram (sem "campo some ao editar");
 *  2. é testável sem montar React;
 *  3. o shape do `dataJson` é contrato com o template Handlebars, o
 *     `deriveTemplateFacts` (seleção de variante) e o `convertProposalToDeal` —
 *     mudar isso no meio de um componente de 700 linhas é como o shape
 *     divergiu antes.
 *
 * Client-safe: sem prisma, sem React.
 */

import { parseMoneyBR } from "@/lib/format/money";
import { GARANTIA_TIPOS, type GarantiaTipo } from "@/lib/contracts/template-category";
import { computeDedupeKey } from "./signer-dedupe";
import { DEFAULT_PROPOSAL_VALIDITY_DAYS } from "./create-schema";

/**
 * Modelos (schemaType) oferecidos por tipo de proposta. O 1º é o default da
 * criação. Espelha o enum `SCHEMA_TYPES` de POST /api/proposals — o servidor
 * rejeita qualquer outro.
 */
export const PROPOSAL_SCHEMA_OPTIONS: Record<
  "venda" | "locacao",
  { label: string; value: string }[]
> = {
  venda: [{ label: "Compra e venda", value: "compra_venda_v1" }],
  locacao: [
    { label: "Locação residencial", value: "locacao_residencial_v1" },
    { label: "Locação comercial", value: "locacao_comercial_v1" },
  ],
};

export type TipoPessoa = "fisica" | "juridica";

/** Uma parte do formulário (proponente, vendedor ou fiador). */
export interface PartyInput {
  tipoPessoa: TipoPessoa;
  /** PF: nome completo. PJ: razão social. */
  nome: string;
  /** PF: CPF. PJ: CNPJ. Só-texto aqui; a formatação é da UI. */
  documento: string;
  email: string;
  phone: string;
  /** Canal de notificação da assinatura: "email" | "whatsapp". */
  canal: string;
}

export interface WitnessInput {
  name: string;
  email: string;
  /** CPF só-dígitos (shape do WitnessPicker). */
  documentation: string;
  phone: string;
}

export interface IlistSnapshot {
  endereco: string;
  listingCode?: string;
  preco?: number;
  ilistId: string;
}

export interface GarantiaInput {
  tipo: GarantiaTipo;
  /** Seguradora / subscritora / provedora (seguro fiança, título, digital). */
  provider: string;
  /** Caução: nº de aluguéis depositados (art. 38 §2º — máx 3). */
  caucaoMeses: string;
  fiador: PartyInput;
}

export interface ProposalFormValues {
  kind: "venda" | "locacao";
  schemaType: string;
  proponentes: PartyInput[];
  vendedores: PartyInput[];
  imovelEndereco: string;
  ilistSnapshot: IlistSnapshot | null;
  valor: string;
  validadeDias: string;
  comissao: boolean;
  esconderComissao: boolean;
  /** Só usada em locação (o schema de venda não tem garantia). */
  garantia: GarantiaInput;
  witnesses: WitnessInput[];
}

export interface SignerInput {
  role: "proponente" | "vendedor" | "testemunha";
  name: string;
  email: string | null;
  cpf: string | null;
  phone: string | null;
  notifyChannel: string;
  signingGroup: number;
}

export const emptyParty = (): PartyInput => ({
  tipoPessoa: "fisica",
  nome: "",
  documento: "",
  email: "",
  phone: "",
  canal: "email",
});

export const emptyGarantia = (): GarantiaInput => ({
  tipo: "caucao",
  provider: "",
  caucaoMeses: "",
  fiador: emptyParty(),
});

export function emptyProposalForm(
  kind: "venda" | "locacao",
  schemaType: string
): ProposalFormValues {
  return {
    kind,
    schemaType,
    proponentes: [emptyParty()],
    vendedores: [],
    imovelEndereco: "",
    ilistSnapshot: null,
    valor: "",
    // Mesmo padrão que o servidor aplica quando o prazo não vem (create-schema.ts)
    // — a UI mandava 5 e divergia em silêncio do que a API/agente cria.
    validadeDias: String(DEFAULT_PROPOSAL_VALIDITY_DAYS),
    comissao: false,
    esconderComissao: false,
    garantia: emptyGarantia(),
    witnesses: [],
  };
}

const trim = (v: string | null | undefined) => (v ?? "").trim();
const digits = (v: string | null | undefined) => (v ?? "").replace(/\D/g, "");

/** Partes com nome preenchido — as únicas que viram dado e signatário. */
export function validParties(list: PartyInput[]): PartyInput[] {
  return list.filter((p) => trim(p.nome).length > 0);
}

/**
 * Parte → objeto do `dataJson`.
 *
 * PJ escreve `razao_social` E `nome`: `razao_social` é o campo canônico dos
 * schemas de locação (e o que o template imprime), mas `nome` é lido pelo
 * resumo da listagem, pelo `deriveDealMetadata` e pelo título — sem ele a
 * proposta de PJ aparecia sem proponente na tela.
 */
export function partyToData(p: PartyInput): Record<string, unknown> {
  const nome = trim(p.nome);
  const doc = digits(p.documento);
  const base: Record<string, unknown> = {
    tipo_pessoa: p.tipoPessoa,
    nome,
    email: trim(p.email),
    telefone: trim(p.phone),
  };
  if (p.tipoPessoa === "juridica") {
    base.razao_social = nome;
    if (doc) base.cnpj = doc;
  } else if (doc) {
    base.cpf = doc;
  }
  return base;
}

/** Inverso de `partyToData` (prefill da edição). */
export function partyFromData(raw: unknown, canal = "email"): PartyInput {
  const d = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const isPj = d.tipo_pessoa === "juridica" || str(d.cnpj).length > 0;
  return {
    tipoPessoa: isPj ? "juridica" : "fisica",
    nome: str(d.razao_social) || str(d.nome),
    documento: isPj ? str(d.cnpj) : str(d.cpf),
    email: str(d.email),
    phone: str(d.telefone),
    canal,
  };
}

/** Formatação determinística "1.500,00" (o ICU varia Node×browser → React #418). */
export function formatAmountInput(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n) || n === 0) return "";
  const [int, dec] = Math.abs(n).toFixed(2).split(".");
  return `${n < 0 ? "-" : ""}${int.replace(/\B(?=(\d{3})+(?!\d))/g, ".")},${dec}`;
}

function isGarantiaTipo(v: unknown): v is GarantiaTipo {
  return (GARANTIA_TIPOS as readonly string[]).includes(v as string);
}

/**
 * Formulário → `dataJson`.
 *
 * Escreve os DOIS shapes de valor/imóvel de propósito:
 *  - `imoveis[]` + `locacao.valor_aluguel` são o que a listagem, o
 *    `summarize` do detalhe e o `convertProposalToDeal` já leem;
 *  - `imovel.*` + `aluguel.valor` são o que os TEMPLATES de proposta de locação
 *    leem (a ficha da RE/MAX Ativa imprime `imovel.rua` e `aluguel.valor`).
 * Escrever só um deixava metade da tela ou metade do documento em branco.
 */
export function buildProposalDataJson(v: ProposalFormValues): Record<string, unknown> {
  const isVenda = v.kind === "venda";
  const proponentes = validParties(v.proponentes).map(partyToData);
  const vendedores = validParties(v.vendedores).map(partyToData);
  const endereco = trim(v.imovelEndereco);
  const valorNum = v.valor ? parseMoneyBR(v.valor) : null;

  const imovelEntry: Record<string, unknown> =
    v.ilistSnapshot && v.ilistSnapshot.endereco === endereco
      ? { ...v.ilistSnapshot }
      : endereco
        ? { endereco }
        : {};

  const data: Record<string, unknown> = {
    imoveis: Object.keys(imovelEntry).length > 0 ? [imovelEntry] : [],
  };
  if (endereco) data.imovel = { rua: endereco };

  if (isVenda) {
    data.compradores = proponentes;
    data.vendedores = vendedores;
    if (valorNum != null) data.pagamento = { valor_total: valorNum };
  } else {
    data.locatarios = proponentes;
    data.locadores = vendedores;
    if (valorNum != null) {
      data.locacao = { valor_aluguel: valorNum };
      data.aluguel = { valor: valorNum };
    }
    data.garantia = buildGarantia(v.garantia);
  }
  return data;
}

function buildGarantia(g: GarantiaInput): Record<string, unknown> {
  const out: Record<string, unknown> = { tipo: g.tipo };
  if (trim(g.provider)) out.provider = trim(g.provider);
  if (g.tipo === "caucao" && trim(g.caucaoMeses)) {
    const meses = Number(g.caucaoMeses);
    if (Number.isFinite(meses) && meses > 0) out.caucao_meses = meses;
  }
  // `fiador` só entra quando a garantia É fiador — senão `deriveTemplateFacts`
  // leria `fiadorPessoa` de um bloco morto e escolheria a variante errada.
  if (g.tipo === "fiador" && trim(g.fiador.nome)) {
    out.fiador = partyToData(g.fiador);
  }
  return out;
}

/**
 * Formulário → linhas de `ProposalSigner`.
 *
 * Dedupe AUTORITATIVO aqui com o MESMO `computeDedupeKey` do servidor: sem ele
 * uma testemunha que também é vendedor estoura o `@@unique([proposalId,
 * dedupeKey])` (P2002) e derruba a proposta inteira. Testemunha sem e-mail é
 * descartada — o canal dela é e-mail e o preflight barraria o envio.
 */
export function buildProposalSigners(v: ProposalFormValues): SignerInput[] {
  const mk = (
    p: PartyInput,
    role: "proponente" | "vendedor",
    group: number
  ): SignerInput => ({
    role,
    name: trim(p.nome),
    email: trim(p.email) || null,
    cpf: digits(p.documento) || null,
    phone: trim(p.phone) || null,
    notifyChannel: p.canal,
    signingGroup: group,
  });

  const signers: SignerInput[] = [
    ...validParties(v.proponentes).map((p) => mk(p, "proponente", 1)),
    ...validParties(v.vendedores).map((p) => mk(p, "vendedor", 2)),
  ];

  const seen = new Set(
    signers.map((s) =>
      computeDedupeKey({ name: s.name, email: s.email, cpf: s.cpf, phone: s.phone })
    )
  );
  for (const w of v.witnesses) {
    if (!trim(w.email)) continue;
    const key = computeDedupeKey({
      name: w.name,
      email: w.email,
      cpf: w.documentation || null,
      phone: w.phone || null,
    });
    if (seen.has(key)) continue;
    seen.add(key);
    signers.push({
      role: "testemunha",
      name: w.name,
      email: w.email,
      cpf: w.documentation || null,
      phone: w.phone || null,
      notifyChannel: "email",
      signingGroup: 2,
    });
  }
  return signers;
}

/** Título derivado (1º proponente — imóvel), igual ao da criação original. */
export function buildProposalTitle(v: ProposalFormValues): string {
  const first = validParties(v.proponentes)[0];
  const endereco = trim(v.imovelEndereco);
  return `${first ? trim(first.nome) : "Proposta"}${endereco ? ` — ${endereco}` : ""}`;
}

/**
 * `hiddenPaths` da via reduzida. Esconder a comissão só faz sentido com comissão
 * incluída E com proprietário assinando (é ele quem recebe a 2ª via reduzida).
 */
export function buildHiddenPaths(v: ProposalFormValues): string[] {
  const hide =
    v.comissao && v.esconderComissao && validParties(v.vendedores).length > 0;
  return hide ? ["comissao"] : [];
}

export function buildValidUntil(v: ProposalFormValues): string | undefined {
  const dias = Number(v.validadeDias);
  if (!Number.isFinite(dias) || dias <= 0) return undefined;
  return new Date(Date.now() + dias * 86_400_000).toISOString();
}

/**
 * `dataJson` (+ metadados persistidos) → formulário. Inverso de
 * `buildProposalDataJson` — é o prefill da página /editar.
 *
 * O canal de notificação não vive no `dataJson`, vem das linhas de
 * `ProposalSigner` na MESMA ordem em que `buildProposalSigners` as escreveu.
 */
export function parseProposalForm(input: {
  kind: string;
  schemaType: string;
  dataJson: unknown;
  validUntil?: string | null;
  createdAt?: string | null;
  comissaoIncluida?: boolean;
  hiddenPaths?: string[];
  signers?: {
    role: string;
    name?: string;
    email?: string | null;
    cpf?: string | null;
    phone?: string | null;
    notifyChannel: string | null;
  }[];
}): ProposalFormValues {
  const kind = input.kind === "locacao" ? "locacao" : "venda";
  const d = (input.dataJson && typeof input.dataJson === "object"
    ? input.dataJson
    : {}) as Record<string, unknown>;

  const canaisPor = (role: string) =>
    (input.signers ?? []).filter((s) => s.role === role).map((s) => s.notifyChannel ?? "email");
  const canaisProp = canaisPor("proponente");
  const canaisVend = canaisPor("vendedor");

  const arr = (v: unknown) => (Array.isArray(v) ? v : []);
  const proponentesRaw = arr(kind === "venda" ? d.compradores : d.locatarios);
  const vendedoresRaw = arr(kind === "venda" ? d.vendedores : d.locadores);

  const imoveis = arr(d.imoveis) as Array<Record<string, unknown>>;
  const im = imoveis[0] ?? {};
  const imovelObj = (d.imovel ?? {}) as Record<string, unknown>;
  const endereco =
    (typeof im.endereco === "string" ? im.endereco : "") ||
    (typeof imovelObj.rua === "string" ? imovelObj.rua : "");

  const pag = (d.pagamento ?? {}) as { valor_total?: unknown };
  const loc = (d.locacao ?? {}) as { valor_aluguel?: unknown };
  const alu = (d.aluguel ?? {}) as { valor?: unknown };
  const valorNum =
    kind === "venda"
      ? Number(pag.valor_total ?? 0)
      : Number(loc.valor_aluguel ?? alu.valor ?? 0);

  const g = (d.garantia ?? {}) as Record<string, unknown>;
  const garantia: GarantiaInput = {
    tipo: isGarantiaTipo(g.tipo) ? g.tipo : "caucao",
    provider: typeof g.provider === "string" ? g.provider : "",
    caucaoMeses: g.caucao_meses != null ? String(g.caucao_meses) : "",
    fiador: g.fiador ? partyFromData(g.fiador) : emptyParty(),
  };

  // Validade guardada como INSTANTE (validUntil); o form pede DIAS. Reconstitui
  // a partir de agora — arredondando pra cima pra não perder um dia por causa
  // das horas já corridas desde a criação.
  let validadeDias = String(DEFAULT_PROPOSAL_VALIDITY_DAYS);
  if (input.validUntil) {
    const diff = new Date(input.validUntil).getTime() - Date.now();
    const dias = Math.max(0, Math.ceil(diff / 86_400_000));
    validadeDias = String(dias);
  }

  return {
    kind,
    schemaType: input.schemaType,
    proponentes:
      proponentesRaw.length > 0
        ? proponentesRaw.map((p, i) => partyFromData(p, canaisProp[i] ?? "email"))
        : [emptyParty()],
    vendedores: vendedoresRaw.map((p, i) => partyFromData(p, canaisVend[i] ?? "email")),
    imovelEndereco: endereco,
    ilistSnapshot:
      typeof im.ilistId === "string" && typeof im.endereco === "string"
        ? {
            ilistId: im.ilistId,
            endereco: im.endereco,
            listingCode: typeof im.listingCode === "string" ? im.listingCode : undefined,
            preco: typeof im.preco === "number" ? im.preco : undefined,
          }
        : null,
    valor: formatAmountInput(valorNum),
    validadeDias,
    comissao: input.comissaoIncluida === true,
    esconderComissao: (input.hiddenPaths ?? []).includes("comissao"),
    garantia,
    // Testemunhas vivem SÓ nas linhas de signer (não no dataJson). Reidratá-las
    // aqui é obrigatório: o PATCH substitui o conjunto de signatários, então uma
    // edição que voltasse `witnesses: []` apagaria as testemunhas da proposta.
    witnesses: (input.signers ?? [])
      .filter((s) => s.role === "testemunha")
      .map((s) => ({
        name: s.name ?? "",
        email: s.email ?? "",
        documentation: s.cpf ?? "",
        phone: s.phone ?? "",
      })),
  };
}
