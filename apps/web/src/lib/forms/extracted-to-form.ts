import type { UseFormReturn } from "react-hook-form";

/**
 * Granularidade de atribuição de cada documento na Etapa 0:
 * - vendedor / comprador: titular PF ou PJ
 * - conjuge_vendedor / conjuge_comprador: cônjuge inline da parte titular
 * - representante_vendedor / representante_comprador: representante legal de
 *   parte PJ (subobjeto `representante`)
 * - imovel: endereço/matrícula
 * - outro: documento avulso (sem aplicar campos)
 */
export type DocumentKind =
  | "vendedor"
  | "comprador"
  | "conjuge_vendedor"
  | "conjuge_comprador"
  | "representante_vendedor"
  | "representante_comprador"
  // Locação (módulo aditivo): Assignment é compartilhado pelo DocumentCard e
  // pelo PATCH de classificação dos anexos, então os papéis vivem no mesmo
  // union. O mapeamento de campos de locação fica em extracted-to-form-locacao.
  | "locador"
  | "locatario"
  | "fiador"
  | "representante_locador"
  | "representante_locatario"
  | "imovel"
  | "outro";

export interface ExtractedDoc {
  category: string | null;
  fields: Record<string, unknown>;
  confidence?: number;
}

export interface Assignment {
  kind: DocumentKind;
  index: number;
}

// Exportados pro módulo de locação (extracted-to-form-locacao.ts) — mesma
// classificação de categorias e helpers de sanitização, basePaths diferentes.
export const PERSON_CATEGORIES = new Set([
  "rg",
  "cpf",
  "cnh",
  "procuracao",
  "comprovante_residencia",
  "certidao_casamento",
]);
export const PROPERTY_CATEGORIES = new Set(["matricula", "iptu", "escritura"]);

const TITULAR_KINDS = new Set<DocumentKind>(["vendedor", "comprador"]);
const CONJUGE_KINDS = new Set<DocumentKind>([
  "conjuge_vendedor",
  "conjuge_comprador",
]);
const REPRESENTANTE_KINDS = new Set<DocumentKind>([
  "representante_vendedor",
  "representante_comprador",
]);

/** Kinds de VENDA cujo basePath é uma pessoa (titular, cônjuge ou representante). */
const PERSON_KINDS_VENDA = new Set<DocumentKind>([
  ...TITULAR_KINDS,
  ...CONJUGE_KINDS,
  ...REPRESENTANTE_KINDS,
]);

/**
 * Campos que provam que o OCR leu um documento de IDENTIDADE de pessoa, mesmo
 * quando a categoria não está no catálogo do classificador (ex.: carteira da
 * OAB, CRM, carteira de trabalho → `category: "outro"`).
 *
 * Sem isso, um doc pessoal fora do catálogo caía nos dois lados do gate por
 * categoria (nem PERSON_CATEGORIES nem PROPERTY_CATEGORIES) e o "Aplicar aos
 * campos" preenchia ZERO campos silenciosamente.
 */
const PERSON_IDENTITY_FIELDS = ["nome_completo", "cpf_numero", "rg_numero"] as const;

export function hasPersonIdentityEvidence(
  fields: Record<string, unknown> | null | undefined
): boolean {
  if (!fields || typeof fields !== "object") return false;
  return PERSON_IDENTITY_FIELDS.some((key) => {
    const value = fields[key];
    if (typeof value === "string") return value.trim().length > 0;
    return value !== null && value !== undefined && value !== "";
  });
}

/**
 * Categoria fora das duas whitelists (tipicamente "outro"): tratamos como doc
 * pessoal SÓ quando há evidência de identidade nos campos. Deliberadamente NÃO
 * existe o análogo pra imóvel — aplicar endereço de um doc não catalogado no
 * slot do imóvel sujaria a matrícula com o endereço da parte.
 */
export function isUncatalogedPersonDoc(
  category: string | null,
  fields: Record<string, unknown> | null | undefined
): boolean {
  if (!category) return false;
  if (PERSON_CATEGORIES.has(category) || PROPERTY_CATEGORIES.has(category)) return false;
  // Ficha-resumo tem fluxo próprio (applyFichaResumo) — nunca vira doc pessoal.
  if (category === "ficha_resumo") return false;
  return hasPersonIdentityEvidence(fields);
}

// Maps the free-text "regime de bens" string extracted from a marriage
// certificate to the estado civil dropdown value used by the form. Accepts
// "Comunhao parcial", "Comunhao universal", "Separacao total", etc.
function inferEstadoCivilFromRegime(regime: unknown): string | null {
  if (typeof regime !== "string" || !regime.trim()) return null;
  // Anything that mentions "comunhao" or "separacao de bens" implies married
  const lower = regime
    .toLowerCase()
    .normalize("NFD")
    // eslint-disable-next-line no-misleading-character-class
    .replace(new RegExp("[\\u0300-\\u036f]", "g"), "");
  if (
    lower.includes("comunhao") ||
    lower.includes("separacao de bens") ||
    lower.includes("separacao total") ||
    lower.includes("separacao parcial") ||
    lower.includes("participacao final")
  ) {
    return "Casado(a)";
  }
  return null;
}

export const FIELD_MAP_PERSON: Record<string, string> = {
  nome_completo: "nome",
  titular_nome: "nome",
  rg_numero: "rg",
  cpf_numero: "cpf",
  data_nascimento: "data_nascimento",
  naturalidade: "naturalidade",
  // OCR de RG/CNH traz o sexo — exigido pelo TJSP pedido-certidao (genero).
  sexo: "sexo",
  // OCR retorna `filiacao_mae` em RG/CNH; schema do form usa `nome_mae`.
  // Exigido por TJSP pedido-cível (code 606), PGFN PF, Antecedentes PF.
  filiacao_mae: "nome_mae",
  mae: "nome_mae",
  nome_mae: "nome_mae",
  bairro: "bairro",
  cidade: "cidade",
  uf: "uf",
  cep: "cep",
};

const FIELD_MAP_IMOVEL: Record<string, string> = {
  matricula_numero: "matricula",
  cartorio: "cartorio",
  bairro: "bairro",
  cidade: "cidade",
  uf: "uf",
  cep: "cep",
  descricao_imovel: "descricao",
  inscricao_iptu: "inscricao_iptu",
  sql: "sql",
  inscricao_municipal: "inscricao_municipal",
  area_total: "area_total",
};

const ADDRESS_FIELDS = new Set([
  "endereco",
  "numero",
  "complemento",
  "bairro",
  "cidade",
  "uf",
  "cep",
]);

function onlyDigits(s: unknown): string {
  return typeof s === "string" ? s.replace(/\D/g, "") : "";
}

export function sanitizeCpf(s: unknown): string | null {
  const d = onlyDigits(s);
  return d.length === 11 ? d : null;
}

export function sanitizeUf(s: unknown): string | null {
  if (typeof s !== "string") return null;
  const upper = s.trim().toUpperCase().slice(0, 2);
  return /^[A-Z]{2}$/.test(upper) ? upper : null;
}

export function parseEndereco(value: unknown): { rua?: string; numero?: string } {
  if (typeof value !== "string" || !value.trim()) return {};
  const match = value.match(/^(.+?),?\s*(\d+[A-Za-z]?)(?:\s*[-,]\s*(.*))?$/);
  if (match) {
    return { rua: match[1].trim(), numero: match[2].trim() };
  }
  return { rua: value.trim() };
}

export function coerce(field: string, value: unknown): unknown {
  if (value === null || value === undefined || value === "") return undefined;
  if (field === "cpf") return sanitizeCpf(value);
  if (field === "uf") return sanitizeUf(value);
  if (field === "rg") return typeof value === "string" ? value.trim() : undefined;
  return typeof value === "string" ? value.trim() : value;
}

/**
 * Resolve o basePath onde aplicar os campos extraídos com base no kind do
 * doc. Cônjuge e representante apontam pra subobjeto da parte pai.
 */
function resolveBasePath(assignment: Assignment): string | null {
  switch (assignment.kind) {
    case "vendedor":
      return `vendedores.${assignment.index}`;
    case "comprador":
      return `compradores.${assignment.index}`;
    case "conjuge_vendedor":
      return `vendedores.${assignment.index}.conjuge`;
    case "conjuge_comprador":
      return `compradores.${assignment.index}.conjuge`;
    case "representante_vendedor":
      return `vendedores.${assignment.index}.representante`;
    case "representante_comprador":
      return `compradores.${assignment.index}.representante`;
    case "imovel":
      return `imoveis.${assignment.index}`;
    default:
      return null;
  }
}

export function mapExtractedToForm(
  extraction: ExtractedDoc,
  assignment: Assignment,
  form: UseFormReturn<Record<string, unknown>>,
  options: { skipIfDirty?: boolean; forceBasePath?: string } = {}
): number {
  const { skipIfDirty = true, forceBasePath } = options;
  const { category, fields } = extraction;
  if (!category || !fields) return 0;

  // `forceBasePath` é usado por subtokens (PR 4): mesmo se a heurística do
  // OCR classificar o doc como cross-role (ex: vendedor sobe matrícula com
  // o próprio nome dele e o classificador acharia que é doc pessoal),
  // forçamos o basePath garantindo isolamento de dados entre partes.
  // Caller é responsável por validar que o kind faz sentido pro role.
  const basePath = forceBasePath ?? resolveBasePath(assignment);
  if (!basePath) return 0;

  const isTitular = TITULAR_KINDS.has(assignment.kind);
  const isConjuge = CONJUGE_KINDS.has(assignment.kind);
  // Categoria conhecida decide como antes. Categoria fora do catálogo (ex.:
  // carteira da OAB → "outro") entra pelo caminho de PESSOA por EVIDÊNCIA:
  // o slot destino é de pessoa E os campos têm identidade (nome/cpf/rg).
  // Os ramos específicos de categoria abaixo (certidao_casamento, averbação de
  // cônjuge em rg/cnh) continuam presos à categoria, então não rodam aqui.
  const isPerson =
    PERSON_CATEGORIES.has(category) ||
    (PERSON_KINDS_VENDA.has(assignment.kind) &&
      isUncatalogedPersonDoc(category, fields));
  const isProperty = PROPERTY_CATEGORIES.has(category);
  let filled = 0;

  // Quando o doc é do cônjuge e a flag "endereço igual ao do titular" está
  // ligada (default true), pular campos de endereço pra não sujar o subobjeto
  // — o helper getEnderecoEfetivo lê do titular automaticamente.
  let skipAddressForConjuge = false;
  if (isConjuge) {
    const flagPath = `${basePath}.endereco_igual_ao_titular`;
    const flagValue = form.getValues(flagPath);
    skipAddressForConjuge = flagValue !== false;
  }

  const applyField = (formField: string, raw: unknown) => {
    if (skipAddressForConjuge && ADDRESS_FIELDS.has(formField)) return;
    const value = coerce(formField, raw);
    if (value === undefined || value === null || value === "") return;
    const fullPath = `${basePath}.${formField}`;
    if (skipIfDirty) {
      const current = form.getValues(fullPath);
      if (current !== undefined && current !== null && current !== "") return;
    }
    form.setValue(fullPath, value as never, { shouldDirty: true, shouldTouch: true });
    filled += 1;
  };

  if (isPerson) {
    for (const [ocrKey, formField] of Object.entries(FIELD_MAP_PERSON)) {
      if (ocrKey in fields) applyField(formField, fields[ocrKey]);
    }
    const enderecoRaw = fields.endereco_completo ?? fields.endereco;
    if (enderecoRaw) {
      const parsed = parseEndereco(enderecoRaw);
      if (parsed.rua) applyField("endereco", parsed.rua);
      if (parsed.numero) applyField("numero", parsed.numero);
    }

    // Os blocos de qualificação de cônjuge embutida (certidao_casamento,
    // RG/CNH com averbação "casado(a) com") só fazem sentido quando o doc
    // é DO TITULAR. Se o usuário atribuiu o doc como kind conjuge_* ou
    // representante_*, esses ramos não devem rodar.
    if (isTitular && category === "certidao_casamento") {
      const regime = fields.regime_bens;
      const estadoCivil = inferEstadoCivilFromRegime(regime);
      if (estadoCivil) applyField("estado_civil", estadoCivil);

      // The primary person on this form slot is conjuge1; conjuge2 becomes
      // the "conjuge" sub-object. We only fill if the slot's conjuge is empty.
      const conjuge2Nome = fields.conjuge2_nome;
      const conjuge2Cpf = sanitizeCpf(fields.conjuge2_cpf);
      if (conjuge2Nome && typeof conjuge2Nome === "string") {
        const curr = form.getValues(`${basePath}.conjuge.nome`);
        if (!curr) {
          form.setValue(
            `${basePath}.conjuge.nome`,
            conjuge2Nome.trim() as never,
            { shouldDirty: true, shouldTouch: true }
          );
          filled += 1;
        }
      }
      if (conjuge2Cpf) {
        const curr = form.getValues(`${basePath}.conjuge.cpf`);
        if (!curr) {
          form.setValue(`${basePath}.conjuge.cpf`, conjuge2Cpf as never, {
            shouldDirty: true,
            shouldTouch: true,
          });
          filled += 1;
        }
      }
    }

    if (
      isTitular &&
      (category === "rg" || category === "cnh" || category === "comprovante_residencia")
    ) {
      const conjugeNome = fields.conjuge_nome;
      const conjugeCpf = sanitizeCpf(fields.conjuge_cpf);
      if (conjugeNome && typeof conjugeNome === "string") {
        const curr = form.getValues(`${basePath}.conjuge.nome`);
        if (!curr) {
          form.setValue(
            `${basePath}.conjuge.nome`,
            conjugeNome.trim() as never,
            { shouldDirty: true, shouldTouch: true }
          );
          filled += 1;
        }
      }
      if (conjugeCpf) {
        const curr = form.getValues(`${basePath}.conjuge.cpf`);
        if (!curr) {
          form.setValue(`${basePath}.conjuge.cpf`, conjugeCpf as never, {
            shouldDirty: true,
            shouldTouch: true,
          });
          filled += 1;
        }
      }
    }
  }

  if (isProperty) {
    for (const [ocrKey, formField] of Object.entries(FIELD_MAP_IMOVEL)) {
      if (ocrKey in fields) applyField(formField, fields[ocrKey]);
    }

    const enderecoRaw = fields.endereco_completo ?? fields.endereco;
    const parsed = parseEndereco(enderecoRaw);
    if (parsed.rua) applyField("rua", parsed.rua);
    if (parsed.numero) applyField("numero", parsed.numero);
  }

  return filled;
}

interface FormSnapshot {
  vendedores?: Array<Record<string, unknown>>;
  compradores?: Array<Record<string, unknown>>;
  imoveis?: Array<Record<string, unknown>>;
}

/**
 * A sibling document already processed in the same form session. When
 * suggesting an assignment for a new person doc, the UI looks at these
 * siblings to distinguish "same person" (same CPF → same slot) from
 * "different person" (different CPF → next slot or the comprador list).
 */
export interface ProcessedDocHint {
  category: string | null;
  fields: Record<string, unknown> | null;
  assignment: Assignment;
}

function matchPersonIndex(
  list: Array<Record<string, unknown>> | undefined,
  fields: Record<string, unknown>
): number | null {
  if (!list) return null;
  const extractedCpf = sanitizeCpf(fields.cpf_numero);
  const extractedNome =
    typeof fields.nome_completo === "string"
      ? fields.nome_completo.trim().toLowerCase()
      : null;
  for (let i = 0; i < list.length; i++) {
    const p = list[i] || {};
    const pCpf = sanitizeCpf(p.cpf);
    if (extractedCpf && pCpf && extractedCpf === pCpf) return i;
    if (extractedNome && typeof p.nome === "string") {
      if (p.nome.trim().toLowerCase() === extractedNome) return i;
    }
  }
  return null;
}

/** Match contra parte.conjuge.cpf/nome em vendedores ou compradores. */
function matchConjugeIndex(
  list: Array<Record<string, unknown>> | undefined,
  fields: Record<string, unknown>
): number | null {
  if (!list) return null;
  const extractedCpf = sanitizeCpf(fields.cpf_numero);
  const extractedNome =
    typeof fields.nome_completo === "string"
      ? fields.nome_completo.trim().toLowerCase()
      : null;
  for (let i = 0; i < list.length; i++) {
    const c = (list[i]?.conjuge ?? {}) as Record<string, unknown>;
    const cCpf = sanitizeCpf(c.cpf);
    if (extractedCpf && cCpf && extractedCpf === cCpf) return i;
    if (
      extractedNome &&
      typeof c.nome === "string" &&
      c.nome.trim().toLowerCase() === extractedNome
    ) {
      return i;
    }
  }
  return null;
}

/** Match contra parte.representante.cpf/nome em vendedores/compradores PJ. */
function matchRepresentanteIndex(
  list: Array<Record<string, unknown>> | undefined,
  fields: Record<string, unknown>
): number | null {
  if (!list) return null;
  const extractedCpf = sanitizeCpf(fields.cpf_numero);
  const extractedNome =
    typeof fields.nome_completo === "string"
      ? fields.nome_completo.trim().toLowerCase()
      : null;
  for (let i = 0; i < list.length; i++) {
    if (list[i]?.tipo_pessoa !== "juridica") continue;
    const r = (list[i]?.representante ?? {}) as Record<string, unknown>;
    const rCpf = sanitizeCpf(r.cpf);
    if (extractedCpf && rCpf && extractedCpf === rCpf) return i;
    if (
      extractedNome &&
      typeof r.nome === "string" &&
      r.nome.trim().toLowerCase() === extractedNome
    ) {
      return i;
    }
  }
  return null;
}

function personKey(fields: Record<string, unknown>): string | null {
  const cpf = sanitizeCpf(fields.cpf_numero);
  if (cpf) return `cpf:${cpf}`;
  const nome =
    typeof fields.nome_completo === "string"
      ? fields.nome_completo.trim().toLowerCase()
      : null;
  if (nome) return `nome:${nome}`;
  return null;
}

interface FichaResumoParte {
  papel?: string;
  indice_referencia?: number;
  nome?: string;
  cpf?: string;
  cnpj?: string;
}

const FICHA_PAPEIS: ReadonlySet<DocumentKind> = new Set<DocumentKind>([
  "vendedor",
  "comprador",
  "conjuge_vendedor",
  "conjuge_comprador",
  "representante_vendedor",
  "representante_comprador",
]);

/**
 * Procura match contra a lista `partes[]` de uma ficha-resumo (Fase E).
 * Retorna o papel + índice de referência conforme declarado pelo escritório.
 */
function matchFichaResumo(
  fields: Record<string, unknown>,
  siblings: ProcessedDocHint[]
): { kind: DocumentKind; index: number } | null {
  const fichaSibling = siblings.find(
    (s) => s.category === "ficha_resumo" && s.fields
  );
  if (!fichaSibling?.fields) return null;
  const partes = fichaSibling.fields.partes;
  if (!Array.isArray(partes)) return null;

  const extractedCpf = sanitizeCpf(fields.cpf_numero);
  const extractedNome =
    typeof fields.nome_completo === "string"
      ? fields.nome_completo.trim().toLowerCase()
      : null;

  for (const p of partes as FichaResumoParte[]) {
    if (!p || typeof p !== "object") continue;
    const pCpf = sanitizeCpf(p.cpf);
    const pNome =
      typeof p.nome === "string" ? p.nome.trim().toLowerCase() : null;
    const cpfMatch = extractedCpf && pCpf && extractedCpf === pCpf;
    const nomeMatch =
      !cpfMatch && extractedNome && pNome && extractedNome === pNome;
    if (!cpfMatch && !nomeMatch) continue;
    const papel = (p.papel ?? "").toString() as DocumentKind;
    if (!FICHA_PAPEIS.has(papel)) continue;
    const idx =
      typeof p.indice_referencia === "number" && p.indice_referencia >= 0
        ? p.indice_referencia
        : 0;
    return { kind: papel, index: idx };
  }
  return null;
}

/**
 * Picks the assignment for a new person document using:
 *   1. ficha-resumo hint (Fase E) — papel explícito declarado pelo escritório
 *   2. form snapshot match titular (CPF/nome em parte já cadastrada)
 *   3. form snapshot match cônjuge (parte casada)
 *   4. form snapshot match representante PJ
 *   5. sibling identity match — mesma pessoa em outro doc desta sessão
 *   6. fallback "outro" — força usuário a escolher no dropdown
 */
function suggestPersonAssignment(
  fields: Record<string, unknown>,
  snapshot: FormSnapshot,
  siblings: ProcessedDocHint[]
): Assignment {
  // 1. Ficha-resumo (prioridade máxima)
  const fichaMatch = matchFichaResumo(fields, siblings);
  if (fichaMatch) return fichaMatch;

  // 2. Match contra titular já cadastrado
  const vendedorMatch = matchPersonIndex(snapshot.vendedores, fields);
  if (vendedorMatch !== null) return { kind: "vendedor", index: vendedorMatch };
  const compradorMatch = matchPersonIndex(snapshot.compradores, fields);
  if (compradorMatch !== null) return { kind: "comprador", index: compradorMatch };

  // 3. Match contra cônjuge cadastrado (CPF ou nome no subobjeto conjuge)
  const conjugeVendedorMatch = matchConjugeIndex(snapshot.vendedores, fields);
  if (conjugeVendedorMatch !== null)
    return { kind: "conjuge_vendedor", index: conjugeVendedorMatch };
  const conjugeCompradorMatch = matchConjugeIndex(snapshot.compradores, fields);
  if (conjugeCompradorMatch !== null)
    return { kind: "conjuge_comprador", index: conjugeCompradorMatch };

  // 4. Match contra representante de PJ cadastrada
  const repVendedorMatch = matchRepresentanteIndex(snapshot.vendedores, fields);
  if (repVendedorMatch !== null)
    return { kind: "representante_vendedor", index: repVendedorMatch };
  const repCompradorMatch = matchRepresentanteIndex(
    snapshot.compradores,
    fields
  );
  if (repCompradorMatch !== null)
    return { kind: "representante_comprador", index: repCompradorMatch };

  // 5. Sibling identity match — same CPF/nome num doc já processado
  const myKey = personKey(fields);
  if (myKey) {
    for (const sib of siblings) {
      if (!sib.fields) continue;
      if (!sib.category) continue;
      if (
        !PERSON_CATEGORIES.has(sib.category) &&
        !isUncatalogedPersonDoc(sib.category, sib.fields)
      ) {
        continue;
      }
      const sibKey = personKey(sib.fields);
      if (sibKey === myKey) {
        return sib.assignment;
      }
    }
  }

  // 6. Sem match: força escolha manual. UI mostra dropdown com "Cônjuge de
  // Vendedor 1" / "Representante de Comprador 2 (PJ)" etc.
  return { kind: "outro", index: 0 };
}

export function suggestAssignment(
  category: string | null,
  fields: Record<string, unknown>,
  snapshot: FormSnapshot,
  siblings: ProcessedDocHint[] = []
): Assignment {
  if (!category) return { kind: "outro", index: 0 };

  if (PROPERTY_CATEGORIES.has(category)) {
    return { kind: "imovel", index: 0 };
  }

  // Categoria de pessoa OU doc fora do catálogo com evidência de identidade
  // (ex.: carteira da OAB classificada como "outro") — mesmo fluxo de match.
  if (PERSON_CATEGORIES.has(category) || isUncatalogedPersonDoc(category, fields)) {
    return suggestPersonAssignment(fields, snapshot, siblings);
  }

  return { kind: "outro", index: 0 };
}

export function categoryLabel(category: string | null): string {
  switch (category) {
    case "rg":
      return "RG";
    case "cpf":
      return "CPF";
    case "cnh":
      return "CNH";
    case "matricula":
      return "Matrícula";
    case "iptu":
      return "IPTU";
    case "escritura":
      return "Escritura";
    case "procuracao":
      return "Procuração";
    case "comprovante_residencia":
      return "Comp. Residência";
    case "certidao_casamento":
      return "Certidão de Casamento";
    case "ficha_resumo":
      return "Ficha Resumo";
    case "outro":
      return "Outro";
    default:
      return "—";
  }
}

/**
 * Rótulo do chip do DocumentCard. Docs fora do catálogo do classificador
 * ("outro") costumam trazer `tipo_documento` descrito pelo próprio OCR
 * (ex.: "Identidade de Advogado") — mostrar isso é mais útil que "Outro".
 */
export function documentLabel(
  category: string | null,
  fields?: Record<string, unknown> | null
): string {
  if (category === "outro" || category === null) {
    const tipo = fields?.tipo_documento;
    if (typeof tipo === "string" && tipo.trim()) return tipo.trim();
  }
  return categoryLabel(category);
}

// ============================================================================
// Fase E — Ficha-resumo (mestra de classificação)
// ============================================================================

/**
 * Estrutura esperada de uma ficha-resumo extraída pelo OCR. Cada item de
 * `partes[]` declara o papel da pessoa no negócio + dados pessoais. O OCR
 * é instruído a usar exatamente os papéis listados em FICHA_PAPEIS.
 */
export interface FichaResumoData {
  partes?: Array<{
    papel?: DocumentKind;
    indice_referencia?: number;
    nome?: string;
    cpf?: string;
    rg?: string;
    data_nascimento?: string;
    nome_mae?: string;
    naturalidade?: string;
    estado_civil?: string;
    profissao?: string;
    nacionalidade?: string;
    email?: string;
    endereco?: string;
    numero?: string;
    complemento?: string;
    bairro?: string;
    cidade?: string;
    uf?: string;
    cep?: string;
    cnpj?: string;
    razao_social?: string;
  }>;
  imoveis?: Array<{
    rua?: string;
    numero?: string;
    bairro?: string;
    cidade?: string;
    uf?: string;
    cep?: string;
    matricula?: string;
    cartorio?: string;
    inscricao_iptu?: string;
    sql?: string;
    descricao?: string;
  }>;
}

/**
 * Aplica uma ficha-resumo no form criando/preenchendo slots de
 * vendedores/compradores/imóveis. Cônjuges e representantes vão pros
 * subobjetos da parte pai. Diferente de mapExtractedToForm, processa
 * múltiplas pessoas/imóveis em uma chamada.
 *
 * skipIfDirty preserva valores já digitados pelo usuário.
 */
export function applyFichaResumo(
  data: FichaResumoData,
  form: UseFormReturn<Record<string, unknown>>,
  options: { skipIfDirty?: boolean } = {}
): number {
  const { skipIfDirty = true } = options;
  let filled = 0;

  const setIfEmpty = (path: string, value: unknown) => {
    if (value === undefined || value === null || value === "") return;
    if (skipIfDirty) {
      const current = form.getValues(path);
      if (current !== undefined && current !== null && current !== "") return;
    }
    form.setValue(path, value as never, { shouldDirty: true, shouldTouch: true });
    filled += 1;
  };

  const ensureSlot = (
    listKey: "vendedores" | "compradores" | "imoveis",
    index: number,
    template: Record<string, unknown>
  ) => {
    const current = (form.getValues(listKey) as unknown[] | undefined) ?? [];
    if (current.length > index) return;
    const next = [...current];
    while (next.length <= index) next.push({ ...template });
    form.setValue(listKey, next as never, { shouldDirty: true });
  };

  if (Array.isArray(data.partes)) {
    for (const p of data.partes) {
      if (!p || typeof p !== "object") continue;
      const papel = p.papel as DocumentKind | undefined;
      if (!papel) continue;
      const idx =
        typeof p.indice_referencia === "number" && p.indice_referencia >= 0
          ? p.indice_referencia
          : 0;

      const isTitular = TITULAR_KINDS.has(papel);
      const isConjuge = CONJUGE_KINDS.has(papel);
      const isRep = REPRESENTANTE_KINDS.has(papel);

      let listKey: "vendedores" | "compradores" | null = null;
      if (papel === "vendedor" || papel === "conjuge_vendedor" || papel === "representante_vendedor") {
        listKey = "vendedores";
      } else if (papel === "comprador" || papel === "conjuge_comprador" || papel === "representante_comprador") {
        listKey = "compradores";
      }
      if (!listKey) continue;

      const isPj = !!p.cnpj || !!p.razao_social;
      ensureSlot(listKey, idx, isPj ? { tipo_pessoa: "juridica" } : { tipo_pessoa: "fisica" });

      let prefix = `${listKey}.${idx}`;
      if (isConjuge) prefix = `${prefix}.conjuge`;
      else if (isRep) prefix = `${prefix}.representante`;

      // Pessoa titular PJ ou PF
      if (isTitular) {
        if (isPj) {
          setIfEmpty(`${prefix}.tipo_pessoa`, "juridica");
          setIfEmpty(`${prefix}.razao_social`, p.razao_social);
          setIfEmpty(`${prefix}.cnpj`, p.cnpj && onlyDigits(p.cnpj));
        } else {
          setIfEmpty(`${prefix}.tipo_pessoa`, "fisica");
        }
      }

      // Campos pessoais (todos os papéis PF)
      setIfEmpty(`${prefix}.nome`, p.nome);
      const cpfClean = sanitizeCpf(p.cpf);
      if (cpfClean) setIfEmpty(`${prefix}.cpf`, cpfClean);
      setIfEmpty(`${prefix}.rg`, p.rg);
      setIfEmpty(`${prefix}.data_nascimento`, p.data_nascimento);
      setIfEmpty(`${prefix}.nome_mae`, p.nome_mae);
      setIfEmpty(`${prefix}.naturalidade`, p.naturalidade);
      setIfEmpty(`${prefix}.profissao`, p.profissao);
      setIfEmpty(`${prefix}.nacionalidade`, p.nacionalidade);
      if (isTitular) {
        setIfEmpty(`${prefix}.estado_civil`, p.estado_civil);
        setIfEmpty(`${prefix}.email`, p.email);
      }

      // Endereço — pra cônjuge, só preenche se a flag endereco_igual_ao_titular
      // estiver explicitamente false (usuário marcou que cônjuge tem endereço
      // próprio); caso contrário, deixa em branco (helper lê do titular).
      const skipAddress = isConjuge
        ? form.getValues(`${prefix}.endereco_igual_ao_titular`) !== false
        : false;
      if (!skipAddress) {
        setIfEmpty(`${prefix}.endereco`, p.endereco);
        setIfEmpty(`${prefix}.numero`, p.numero);
        setIfEmpty(`${prefix}.complemento`, p.complemento);
        setIfEmpty(`${prefix}.bairro`, p.bairro);
        setIfEmpty(`${prefix}.cidade`, p.cidade);
        const uf = sanitizeUf(p.uf);
        if (uf) setIfEmpty(`${prefix}.uf`, uf);
        setIfEmpty(`${prefix}.cep`, p.cep);
      }
    }
  }

  if (Array.isArray(data.imoveis)) {
    for (let i = 0; i < data.imoveis.length; i++) {
      const im = data.imoveis[i];
      if (!im || typeof im !== "object") continue;
      ensureSlot("imoveis", i, {});
      const prefix = `imoveis.${i}`;
      setIfEmpty(`${prefix}.rua`, im.rua);
      setIfEmpty(`${prefix}.numero`, im.numero);
      setIfEmpty(`${prefix}.bairro`, im.bairro);
      setIfEmpty(`${prefix}.cidade`, im.cidade);
      const uf = sanitizeUf(im.uf);
      if (uf) setIfEmpty(`${prefix}.uf`, uf);
      setIfEmpty(`${prefix}.cep`, im.cep);
      setIfEmpty(`${prefix}.matricula`, im.matricula);
      setIfEmpty(`${prefix}.cartorio`, im.cartorio);
      setIfEmpty(`${prefix}.inscricao_iptu`, im.inscricao_iptu);
      setIfEmpty(`${prefix}.sql`, im.sql);
      setIfEmpty(`${prefix}.descricao`, im.descricao);
    }
  }

  return filled;
}
