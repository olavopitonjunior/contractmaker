import type { UseFormReturn } from "react-hook-form";
import { isValidBirthdate, isValidCPF, maskCEP } from "./field-formats";

/**
 * Granularidade de atribuição de cada documento na Etapa 0:
 * - vendedor / comprador: titular PF ou PJ
 * - conjuge_vendedor / conjuge_comprador: cônjuge inline da parte titular
 * - representante_vendedor / representante_comprador: representante legal de
 *   parte PJ (subobjeto `representante`)
 * - procurador_vendedor / procurador_comprador: procurador PF da parte
 *   (subobjeto `procurador`) — destino da procuração
 * - imovel: endereço/matrícula
 * - outro: documento avulso (sem aplicar campos)
 *
 * O shape persistido em `FormAttachment.extractedData.assignment` continua
 * `{kind,index}` FLAT: kinds novos são sempre aditivos (um subKind quebraria os
 * assignments já gravados — `parseAssignment` devolveria null e o auto-apply
 * do Fix 3 morreria em silêncio).
 */
export type DocumentKind =
  | "vendedor"
  | "comprador"
  | "conjuge_vendedor"
  | "conjuge_comprador"
  | "representante_vendedor"
  | "representante_comprador"
  | "procurador_vendedor"
  | "procurador_comprador"
  // Locação (módulo aditivo): Assignment é compartilhado pelo DocumentCard e
  // pelo PATCH de classificação dos anexos, então os papéis vivem no mesmo
  // union. O mapeamento de campos de locação fica em extracted-to-form-locacao.
  | "locador"
  | "locatario"
  | "fiador"
  | "representante_locador"
  | "representante_locatario"
  | "conjuge_locador"
  | "conjuge_locatario"
  | "conjuge_fiador"
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
export const PROCURADOR_KINDS = new Set<DocumentKind>([
  "procurador_vendedor",
  "procurador_comprador",
]);

/**
 * Kinds de VENDA cujo basePath é uma pessoa (titular, cônjuge, representante
 * ou procurador).
 */
const PERSON_KINDS_VENDA = new Set<DocumentKind>([
  ...TITULAR_KINDS,
  ...CONJUGE_KINDS,
  ...REPRESENTANTE_KINDS,
  ...PROCURADOR_KINDS,
]);

/**
 * Allowlist de campos por SUB-SLOT. `FIELD_MAP_PERSON` foi desenhado pro
 * titular, que tem todos os campos; os subobjetos são mais pobres e, sem esta
 * trava, o autofill gravava chaves que o Zod não conhece (`representante.cep`,
 * `procurador.nome_mae`, …) — lixo no dataJson que nenhuma tela lê.
 *
 * - `representante` (`validation.ts` pessoaJuridicaSchema): sem endereço
 * - `procurador` (`validation.ts` pessoaFisicaSchema): tem endereço, sem
 *   nome_mae/naturalidade/data_nascimento
 * - `conjuge`: sem restrição — o schema tem tudo que o map produz
 */
const REPRESENTANTE_ALLOWED_FIELDS = new Set([
  "nome",
  "cpf",
  "rg",
  "data_nascimento",
  "nome_mae",
  "sexo",
  "naturalidade",
]);
const PROCURADOR_ALLOWED_FIELDS = new Set([
  "nome",
  "cpf",
  "rg",
  "sexo",
  "endereco",
  "numero",
  "cidade",
  "uf",
]);

/** `true` quando o campo existe no schema do slot destino. */
function isFieldAllowedForKind(kind: DocumentKind, formField: string): boolean {
  if (REPRESENTANTE_KINDS.has(kind)) {
    return REPRESENTANTE_ALLOWED_FIELDS.has(formField);
  }
  if (PROCURADOR_KINDS.has(kind)) return PROCURADOR_ALLOWED_FIELDS.has(formField);
  return true;
}

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
export function inferEstadoCivilFromRegime(regime: unknown): string | null {
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

/**
 * Um CEP nunca é número de porta.
 *
 * O prompt do `comprovante_residencia` pede `endereco_completo` E `cep`
 * separados, mas o modelo repete o CEP dentro do endereço ("Rua das Flores -
 * Centro - CEP 01310-100"). Como o `\d+` do regex de endereço não tem teto de
 * dígitos e o `.+?` é preguiçoso, o primeiro grupo numérico que ele achava era
 * o CEP — e um endereço SEM número de porta gravava `numero = "01310"` (ou
 * `"13010000"` no CEP sem hífen), engolindo o bairro dentro de `rua`.
 *
 * Reportado na sessão com a corretora em 2026-08-25 ("o CEP veio trocado com o
 * número do imóvel").
 *
 * Regras: 8 dígitos é CEP sem máscara; 5 dígitos seguidos de `-###` é a
 * primeira metade de um CEP mascarado. Número de porta real com 5 dígitos
 * existe (99999), então só recusamos os 5 dígitos quando o sufixo de CEP vem
 * logo atrás.
 */
function pareceCep(numero: string, resto: string): boolean {
  if (numero.length === 8) return true;
  if (numero.length === 5 && /^-?\s*\d{3}(?!\d)/.test(resto.trim())) return true;
  return false;
}

export function parseEndereco(value: unknown): { rua?: string; numero?: string } {
  if (typeof value !== "string" || !value.trim()) return {};
  const texto = value.trim();
  const match = texto.match(/^(.+?),?\s*(\d+[A-Za-z]?)(?:\s*[-,]\s*(.*))?$/);
  if (!match) return { rua: texto };

  const numero = match[2].trim();
  const resto = match[3] ?? "";
  // A palavra "CEP" logo antes do grupo numérico é o sinal mais barato de todos.
  const rotuladoCep = /(^|[^a-z])cep[\s:.-]*$/i.test(match[1]);
  if (rotuladoCep || pareceCep(numero.replace(/\D/g, ""), resto)) {
    // Devolver a string inteira como `rua` é melhor que inventar um número: o
    // `skipIfDirty` do apply deixa o usuário corrigir, e nada errado é gravado
    // no campo `numero`.
    return { rua: texto };
  }
  return { rua: match[1].trim(), numero };
}

/**
 * Textos que o modelo devolve quando NÃO conseguiu ler o campo, mas ainda
 * assim precisa devolver uma string.
 *
 * Sem este filtro, um `"null"` do OCR era gravado no formulário como o TEXTO
 * "null" — o corretor via a palavra no campo e tinha que apagar à mão. Medido
 * no `gemma-4-31b-it` sem `nullable` no schema: todos os campos ilegíveis
 * voltaram como a string `"null"`.
 *
 * `[ilegível]` e `[?]` vêm dos próprios prompts, que instruem o modelo a
 * marcar trecho ruim (ver `PARTIAL_HINT` em lib/extraction/field-schemas).
 */
const SENTINELAS_DE_AUSENCIA = new Set([
  "null",
  "undefined",
  "none",
  "n/a",
  "na",
  "nao informado",
  "não informado",
  "nao consta",
  "não consta",
  "nao identificado",
  "não identificado",
  "desconhecido",
  "ilegivel",
  "ilegível",
  "[ilegivel]",
  "[ilegível]",
  "[?]",
  "-",
  "--",
  "—",
  "?",
]);

/** `true` quando o valor é um "não li isto" disfarçado de conteúdo. */
export function isSentinelaDeAusencia(value: unknown): boolean {
  if (typeof value !== "string") return false;
  return SENTINELAS_DE_AUSENCIA.has(value.trim().toLowerCase());
}

/**
 * Converte `DD/MM/AAAA` para ISO, validando o calendário. Não opina sobre
 * passado ou futuro — quem decide isso é o chamador, porque a resposta muda
 * por campo: nascimento não pode ser futuro, validade de CNH **tem** que ser.
 *
 * Devolve `null` para data que não existe no calendário (31/02) ou com ano
 * implausível para documento.
 */
function toIsoCalendarDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const s = value.trim();
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const br = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  let y: number, m: number, d: number;
  if (iso) {
    y = +iso[1]; m = +iso[2]; d = +iso[3];
  } else if (br) {
    d = +br[1]; m = +br[2]; y = +br[3];
  } else {
    return null;
  }
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  // Ano implausível para documento. O teto é generoso de propósito: validade
  // de CNH e prazo de procuração são futuros legítimos.
  if (y < 1900 || y > 2200) return null;
  const dt = new Date(y, m - 1, d, 12, 0, 0);
  // Rejeita overflow (31/02 viraria 03/03).
  if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) {
    return null;
  }
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/**
 * Normaliza data de NASCIMENTO para ISO `YYYY-MM-DD`, aceitando `DD/MM/AAAA`.
 *
 * **Por que existe:** o campo do formulário é `<input type="date">`, que só
 * aceita ISO. Uma data em `DD/MM/AAAA` passava pelo `coerce` genérico
 * (`value.trim()`), era gravada por `setValue`, e o browser simplesmente
 * ignorava o valor — **o campo ficava vazio, sem erro nenhum**. O prompt pede
 * ISO, mas prompt é pedido, não garantia: o modelo devolve `12/05/1980` com
 * frequência, que é o formato impresso no próprio RG.
 *
 * Aplica as regras de `isValidBirthdate` (calendário válido, ano ≥ 1900, não
 * futura) para não haver duas definições de "data de nascimento plausível".
 */
export function normalizeIsoDate(
  value: unknown,
  today: Date = new Date()
): string | null {
  if (typeof value !== "string") return null;
  const s = value.trim();
  if (!s || !isValidBirthdate(s, today)) return null;
  return toIsoCalendarDate(s);
}

/** Campos do formulário que o browser exige em ISO (`<input type="date">`). */
const DATE_FORM_FIELDS = new Set(["data_nascimento"]);

export function coerce(field: string, value: unknown): unknown {
  if (value === null || value === undefined || value === "") return undefined;
  // Antes de qualquer coisa: "null" e companhia não são conteúdo.
  if (isSentinelaDeAusencia(value)) return undefined;
  if (DATE_FORM_FIELDS.has(field)) return normalizeIsoDate(value) ?? undefined;
  if (field === "cpf") return sanitizeCpf(value);
  if (field === "uf") return sanitizeUf(value);
  if (field === "cep") {
    // Gate ANTES de mascarar. `maskCEP` faz `slice(0, 8)`, então um valor com
    // dígitos a mais ("Rua X, 123 - CEP 01310100") seria TRUNCADO num CEP
    // plausível e errado — 8 dígitos, passa na validação, e segue para DIMOB e
    // Asaas como se fosse bom. Errado que parece certo é pior que ausente.
    const digits = onlyDigits(String(value));
    return digits.length === 8 ? maskCEP(digits) : undefined;
  }
  if (field === "rg") return typeof value === "string" ? value.trim() : undefined;
  return typeof value === "string" ? value.trim() : value;
}

/**
 * Por que um campo extraído não chegou (ou não deveria confiar) no formulário.
 *
 * - `ausente`      — o modelo devolveu sentinela ("null", "[ilegível]"): não leu.
 * - `formato`      — veio conteúdo, mas inaproveitável (data impossível, CEP curto).
 * - `cpf_invalido` — 11 dígitos, mas dígito verificador não fecha. É o mais
 *                    perigoso dos três: parece um CPF, é gravado no formulário,
 *                    e só quebra lá na frente (certidão, ClickSign, DIMOB).
 */
export type ExtractionIssueReason = "ausente" | "formato" | "cpf_invalido";

export interface ExtractionIssue {
  /** Chave como o OCR devolveu (ex.: `cpf_numero`). */
  ocrKey: string;
  /** Valor cru, para o revisor comparar com o documento. */
  raw: unknown;
  reason: ExtractionIssueReason;
}

/**
 * Chaves de OCR que carregam CPF, em qualquer categoria de documento.
 *
 * `cpf` (sem sufixo) é a chave usada DENTRO de `partes[]` na ficha-resumo — o
 * `COMBINED_PROMPT` usa `cpf_numero` no nível de cima e `cpf` no aninhado.
 */
const CPF_OCR_KEYS = [
  "cpf_numero",
  "cpf",
  "conjuge_cpf",
  "outorgante_cpf",
  "outorgado_cpf",
  "conjuge1_cpf",
  "conjuge2_cpf",
];

/**
 * Datas que NÃO podem estar no futuro. Nascimento, emissão e lavratura são
 * fatos já ocorridos.
 */
const PAST_DATE_OCR_KEYS = ["data_nascimento", "data_emissao", "data_lavratura", "data_casamento"];

/**
 * Datas que podem — e normalmente devem — estar no futuro.
 *
 * `data_validade` é `required` em `CNH_FIELDS` e, numa CNH válida, é futura
 * por definição. Validá-la como data de nascimento marcaria **toda CNH boa**
 * como problema, e uma lista de revisão que acusa o caso normal ensina o
 * revisor a ignorá-la — que é o oposto do que ela existe para fazer.
 */
const FUTURE_OK_DATE_OCR_KEYS = ["data_validade", "prazo_validade"];

/**
 * Lista o que a extração produziu mas o formulário vai descartar ou aceitar
 * sem merecer confiança.
 *
 * **Por que é função separada de `mapExtractedToForm`:** o mapper devolve
 * `number` (campos preenchidos) e tem vários callers; mudar a assinatura
 * quebraria todos. Além disso, o consumidor natural disto é a UI de revisão,
 * que precisa da lista ANTES de aplicar — não como efeito colateral de aplicar.
 *
 * O problema que resolve: hoje `applyField` descarta valor inválido em
 * silêncio, então "aplicou 0 campos" é indistinguível de "extração ruim". O
 * corretor não tem como saber que o CPF veio ilegível — só descobre quando a
 * certidão falha.
 */
export function collectExtractionIssues(
  fields: Record<string, unknown> | null | undefined,
  today: Date = new Date()
): ExtractionIssue[] {
  if (!fields) return [];
  const issues: ExtractionIssue[] = [];
  const push = (ocrKey: string, raw: unknown, reason: ExtractionIssueReason) =>
    issues.push({ ocrKey, raw, reason });

  // A ficha-resumo guarda CPF e data DENTRO de `partes[]` / `imoveis[]`. Sem
  // descer nesses arrays, justamente o documento que carrega mais CPFs — e que
  // preenche o formulário inteiro — seria o único a nunca acusar problema.
  // O rótulo ganha o índice (`partes[1].cpf`) para o revisor saber de QUEM é.
  for (const listKey of ["partes", "imoveis"] as const) {
    const lista = fields[listKey];
    if (!Array.isArray(lista)) continue;
    lista.forEach((item, i) => {
      if (!item || typeof item !== "object") return;
      for (const nested of collectExtractionIssues(
        item as Record<string, unknown>,
        today
      )) {
        push(`${listKey}[${i}].${nested.ocrKey}`, nested.raw, nested.reason);
      }
    });
  }

  for (const [ocrKey, raw] of Object.entries(fields)) {
    if (raw === null || raw === undefined || raw === "") continue;
    if (isSentinelaDeAusencia(raw)) {
      push(ocrKey, raw, "ausente");
      continue;
    }
    if (CPF_OCR_KEYS.includes(ocrKey)) {
      // `String(raw)`: o schema pede string, mas prompt é pedido, não garantia
      // — e um CPF que voltou como número não é um CPF ruim.
      const digits = onlyDigits(String(raw));
      if (digits.length !== 11) push(ocrKey, raw, "formato");
      else if (!isValidCPF(digits)) push(ocrKey, raw, "cpf_invalido");
      continue;
    }
    if (PAST_DATE_OCR_KEYS.includes(ocrKey) && !normalizeIsoDate(raw, today)) {
      push(ocrKey, raw, "formato");
      continue;
    }
    if (FUTURE_OK_DATE_OCR_KEYS.includes(ocrKey) && !toIsoCalendarDate(raw)) {
      push(ocrKey, raw, "formato");
      continue;
    }
    if (ocrKey === "cep" && onlyDigits(String(raw)).length !== 8) {
      push(ocrKey, raw, "formato");
    }
  }
  return issues;
}

/**
 * Resolve o basePath onde aplicar os campos extraídos com base no kind do
 * doc. Cônjuge, representante e procurador apontam pra subobjeto da parte pai.
 */
export function resolveBasePath(assignment: Assignment): string | null {
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
    case "procurador_vendedor":
      return `vendedores.${assignment.index}.procurador`;
    case "procurador_comprador":
      return `compradores.${assignment.index}.procurador`;
    case "imovel":
      return `imoveis.${assignment.index}`;
    default:
      return null;
  }
}

/** Remove acentos e caixa pra comparar nomes vindos de OCR. */
function normalizeName(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    // eslint-disable-next-line no-misleading-character-class
    .replace(new RegExp("[\\u0300-\\u036f]", "g"), "");
}

export interface CertidaoSpouse {
  nome: string | null;
  cpf: string | null;
}

/**
 * D1 — desambigua `conjuge1_*` / `conjuge2_*` de uma certidão de casamento.
 *
 * A certidão nomeia os DOIS nubentes sem dizer qual deles é a parte do negócio.
 * Comparamos o titular pai (CPF sanitizado; sem CPF, nome normalizado) com cada
 * nubente: o cônjuge do slot é **o outro**. Sem match (parte ainda em branco na
 * etapa 0) cai em conjuge2 — mesma convenção do ramo embutido histórico, que
 * assume titular = conjuge1.
 */
export function pickSpouseFromCertidao(
  fields: Record<string, unknown>,
  parent: { nome?: unknown; cpf?: unknown } | null | undefined
): CertidaoSpouse {
  const spouse = (n: 1 | 2): CertidaoSpouse => ({
    nome:
      typeof fields[`conjuge${n}_nome`] === "string"
        ? (fields[`conjuge${n}_nome`] as string).trim()
        : null,
    cpf: sanitizeCpf(fields[`conjuge${n}_cpf`]),
  });

  const parentCpf = sanitizeCpf(parent?.cpf);
  if (parentCpf) {
    const cpf1 = sanitizeCpf(fields.conjuge1_cpf);
    const cpf2 = sanitizeCpf(fields.conjuge2_cpf);
    if (cpf1 && cpf1 === parentCpf) return spouse(2);
    if (cpf2 && cpf2 === parentCpf) return spouse(1);
  }
  const parentNome = normalizeName(parent?.nome);
  if (parentNome) {
    const nome1 = normalizeName(fields.conjuge1_nome);
    const nome2 = normalizeName(fields.conjuge2_nome);
    if (nome1 && nome1 === parentNome) return spouse(2);
    if (nome2 && nome2 === parentNome) return spouse(1);
  }
  return spouse(2);
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
  const isProcurador = PROCURADOR_KINDS.has(assignment.kind);
  const isRepresentante = REPRESENTANTE_KINDS.has(assignment.kind);
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

  // Path da parte PAI quando o slot é um subobjeto (`…0.conjuge`,
  // `…0.procurador`). null quando o slot não é sub (ou quando `forceBasePath`
  // apontou pra outro lugar) — os writes colaterais no pai são pulados.
  const parentPathOf = (suffix: string): string | null =>
    basePath.endsWith(`.${suffix}`)
      ? basePath.slice(0, -(suffix.length + 1))
      : null;

  const applyField = (formField: string, raw: unknown) => {
    if (skipAddressForConjuge && ADDRESS_FIELDS.has(formField)) return;
    // Sub-slot só aceita o que existe no schema dele (mata as chaves órfãs).
    if (!isFieldAllowedForKind(assignment.kind, formField)) return;
    const value = coerce(formField, raw);
    if (value === undefined || value === null || value === "") return;
    const fullPath = `${basePath}.${formField}`;
    if (skipIfDirty) {
      const current = form.getValues(fullPath);
      if (current !== undefined && current !== null && current !== "") return;
    }
    form.setValue(fullPath, value as never, { shouldDirty: true, shouldTouch: true });
    // O campo acabou de receber valor, então qualquer erro de "obrigatório"
    // pendurado nele é obsoleto — e `setValue` sozinho não o limpa. Sem isso o
    // campo preenchido pela IA continuava com borda vermelha e mensagem de
    // vazio, enquanto o mesmo campo preenchido à mão ficava limpo: a extração
    // parecia não ter funcionado justamente onde funcionou.
    form.clearErrors(fullPath as never);
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
      // Este caminho não passa por `applyField`, então o filtro de sentinela
      // precisa ser explícito: sem ele, um `"null"` do modelo virava o NOME do
      // cônjuge — e ainda contava como campo preenchido.
      if (
        conjuge2Nome &&
        typeof conjuge2Nome === "string" &&
        !isSentinelaDeAusencia(conjuge2Nome)
      ) {
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
      // Mesmo motivo do bloco de certidão acima: fora do `applyField`, o
      // sentinela tem que ser barrado à mão.
      if (
        conjugeNome &&
        typeof conjugeNome === "string" &&
        !isSentinelaDeAusencia(conjugeNome)
      ) {
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

    // Certidão de casamento atribuída ao PRÓPRIO cônjuge: a certidão nomeia os
    // dois nubentes, então escolhemos qual deles é o cônjuge do slot (D1) em
    // vez de assumir conjuge2 como o ramo do titular acima.
    if (isConjuge && category === "certidao_casamento") {
      const parentPath = parentPathOf("conjuge");
      const parent = parentPath
        ? {
            nome: form.getValues(`${parentPath}.nome`),
            cpf: form.getValues(`${parentPath}.cpf`),
          }
        : null;
      const spouse = pickSpouseFromCertidao(fields, parent);
      if (spouse.nome) applyField("nome", spouse.nome);
      if (spouse.cpf) applyField("cpf", spouse.cpf);
    }

    // D2 — estado civil colateral do PAI. Atribuir um doc ao cônjuge é
    // afirmação de que a parte é casada; sem isto os campos aplicados ficam
    // invisíveis (a UI do cônjuge só renderiza pra parte casada). Nunca
    // sobrescreve valor não-vazio.
    if (isConjuge) {
      const parentPath = parentPathOf("conjuge");
      if (parentPath) {
        const currentEstadoCivil = form.getValues(`${parentPath}.estado_civil`);
        if (
          currentEstadoCivil === undefined ||
          currentEstadoCivil === null ||
          currentEstadoCivil === ""
        ) {
          const inferred =
            (category === "certidao_casamento"
              ? inferEstadoCivilFromRegime(fields.regime_bens)
              : null) ?? "Casado(a)";
          form.setValue(`${parentPath}.estado_civil`, inferred as never, {
            shouldDirty: true,
            shouldTouch: true,
          });
          filled += 1;
        }
      }
    }

    // Procuração: o OCR devolve `outorgante_*` (quem dá poderes = a parte) e
    // `outorgado_*` (quem recebe = procurador/representante). Antes deste ramo
    // uma procuração preenchia ZERO campos — FIELD_MAP_PERSON não conhece
    // nenhuma dessas chaves.
    if (category === "procuracao") {
      if (isProcurador || isRepresentante) {
        applyField("nome", fields.outorgado_nome);
        applyField("cpf", fields.outorgado_cpf);
      } else if (isTitular) {
        // D5 — procuração atribuída à própria parte: o outorgante É ela.
        applyField("nome", fields.outorgante_nome);
        applyField("cpf", fields.outorgante_cpf);
      }
    }

    // D3 — `tem_procurador` colateral no pai. É booleano com default false e a
    // atribuição do doc é intenção explícita, então ligamos incondicionalmente
    // (sem isso o sub-form do procurador nunca aparece). Só conta em `filled`
    // quando muda de fato.
    if (isProcurador) {
      const parentPath = parentPathOf("procurador");
      if (parentPath) {
        const current = form.getValues(`${parentPath}.tem_procurador`);
        if (current !== true) {
          form.setValue(`${parentPath}.tem_procurador`, true as never, {
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

/** Match contra parte.procurador.cpf/nome em vendedores/compradores PF. */
function matchProcuradorIndex(
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
    // `procurador` só existe em pessoaFisicaSchema.
    if (list[i]?.tipo_pessoa === "juridica") continue;
    const p = (list[i]?.procurador ?? {}) as Record<string, unknown>;
    const pCpf = sanitizeCpf(p.cpf);
    if (extractedCpf && pCpf && extractedCpf === pCpf) return i;
    if (
      extractedNome &&
      typeof p.nome === "string" &&
      p.nome.trim().toLowerCase() === extractedNome
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
  "procurador_vendedor",
  "procurador_comprador",
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

  // 4b. Match contra procurador já cadastrado na parte PF
  const procVendedorMatch = matchProcuradorIndex(snapshot.vendedores, fields);
  if (procVendedorMatch !== null)
    return { kind: "procurador_vendedor", index: procVendedorMatch };
  const procCompradorMatch = matchProcuradorIndex(snapshot.compradores, fields);
  if (procCompradorMatch !== null)
    return { kind: "procurador_comprador", index: procCompradorMatch };

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

  // Procuração descreve DUAS pessoas: o outorgante (a parte) e o outorgado
  // (o procurador). O destino natural do doc é o slot do procurador da parte
  // que outorgou — por isso casamos o outorgante contra os titulares primeiro.
  if (category === "procuracao") {
    const outorgante = {
      cpf_numero: fields.outorgante_cpf,
      nome_completo: fields.outorgante_nome,
    };
    // `procurador` só existe em PF — parte PJ não pode receber a sugestão
    // (chave stale de cpf/nome sobrevive ao toggle PF→PJ no wizard). Entradas
    // PJ viram objeto vazio pra preservar os índices do match.
    const pfOnly = (list?: Array<Record<string, unknown>>) =>
      list?.map((p) => (p?.tipo_pessoa === "juridica" ? {} : p));
    const vMatch = matchPersonIndex(pfOnly(snapshot.vendedores), outorgante);
    if (vMatch !== null) return { kind: "procurador_vendedor", index: vMatch };
    const cMatch = matchPersonIndex(pfOnly(snapshot.compradores), outorgante);
    if (cMatch !== null) return { kind: "procurador_comprador", index: cMatch };
    // Sem outorgante conhecido, o fluxo normal roda sobre pseudo-campos do
    // OUTORGADO (é ele quem o doc qualifica) — assim um procurador/representante
    // já cadastrado casa pelo CPF/nome.
    const pseudoFields: Record<string, unknown> = { ...fields };
    if (!pseudoFields.cpf_numero && fields.outorgado_cpf) {
      pseudoFields.cpf_numero = fields.outorgado_cpf;
    }
    if (!pseudoFields.nome_completo && fields.outorgado_nome) {
      pseudoFields.nome_completo = fields.outorgado_nome;
    }
    return suggestPersonAssignment(pseudoFields, snapshot, siblings);
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
    // A ficha-resumo escreve direto no path, sem passar por `applyField` — e
    // por isso escapava inteira da normalização: `data_nascimento` em
    // DD/MM/AAAA sumia no `<input type="date">`, e `"null"` do modelo virava
    // texto. `setIfEmpty` é o ponto único por onde toda a ficha passa, então é
    // aqui que a coerção tem que estar.
    //
    // O nome do campo é o último segmento do path (`vendedores.0.cep` → `cep`),
    // que é exatamente a chave que `coerce` espera.
    const formField = path.slice(path.lastIndexOf(".") + 1);
    const coerced = coerce(formField, value);
    if (coerced === undefined || coerced === null || coerced === "") return;
    if (skipIfDirty) {
      const current = form.getValues(path);
      if (current !== undefined && current !== null && current !== "") return;
    }
    form.setValue(path, coerced as never, { shouldDirty: true, shouldTouch: true });
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
      const isProc = PROCURADOR_KINDS.has(papel);

      let listKey: "vendedores" | "compradores" | null = null;
      if (
        papel === "vendedor" ||
        papel === "conjuge_vendedor" ||
        papel === "representante_vendedor" ||
        papel === "procurador_vendedor"
      ) {
        listKey = "vendedores";
      } else if (
        papel === "comprador" ||
        papel === "conjuge_comprador" ||
        papel === "representante_comprador" ||
        papel === "procurador_comprador"
      ) {
        listKey = "compradores";
      }
      if (!listKey) continue;

      const isPj = !!p.cnpj || !!p.razao_social;
      ensureSlot(listKey, idx, isPj ? { tipo_pessoa: "juridica" } : { tipo_pessoa: "fisica" });

      const parentPrefix = `${listKey}.${idx}`;
      let prefix = parentPrefix;
      if (isConjuge) prefix = `${prefix}.conjuge`;
      else if (isRep) prefix = `${prefix}.representante`;
      else if (isProc) prefix = `${prefix}.procurador`;

      // D3 — a ficha declarando um procurador é intenção explícita; sem a flag
      // o sub-form nunca aparece pro operador.
      if (isProc && form.getValues(`${parentPrefix}.tem_procurador`) !== true) {
        form.setValue(`${parentPrefix}.tem_procurador`, true as never, {
          shouldDirty: true,
          shouldTouch: true,
        });
        filled += 1;
      }

      // O subobjeto `procurador` é o mais pobre do schema — escrever fora dele
      // (nome_mae/profissao/…) só geraria chave órfã no dataJson.
      if (isProc) {
        setIfEmpty(`${prefix}.nome`, p.nome);
        const procCpf = sanitizeCpf(p.cpf);
        if (procCpf) setIfEmpty(`${prefix}.cpf`, procCpf);
        setIfEmpty(`${prefix}.rg`, p.rg);
        setIfEmpty(`${prefix}.endereco`, p.endereco);
        setIfEmpty(`${prefix}.numero`, p.numero);
        setIfEmpty(`${prefix}.cidade`, p.cidade);
        const procUf = sanitizeUf(p.uf);
        if (procUf) setIfEmpty(`${prefix}.uf`, procUf);
        continue;
      }

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
