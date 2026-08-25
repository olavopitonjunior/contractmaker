/**
 * Detecção e sanitização de PII para a ingestão de acervo documental.
 *
 * Contexto: os DOCX/PDF das imobiliárias frequentemente são contratos
 * PREENCHIDOS, com dados reais de clientes. Um template pode seguir adiante
 * (a parametrização troca dados por `{{tokens}}`), mas conteúdo de cláusula
 * com PII NUNCA pode chegar ao `KnowledgeItem`/embedding — é irreversível.
 *
 * Este módulo é PURO: sem I/O, sem dependências, client-safe. Ele apenas
 * classifica e substitui; a POLÍTICA (o que bloquear, o que deixar passar)
 * é responsabilidade do chamador. Em particular, NÃO tentamos adivinhar se
 * um CNPJ é "da imobiliária" (timbre) ou "do cliente" — sem contexto isso é
 * indecidível, então tudo é classificado e o gate duro (`hasBlockingPii`)
 * deve ser aplicado só a conteúdo que virará cláusula.
 *
 * ## Tabela de placeholders (substituição)
 *
 * Os valores abaixo são obviamente sintéticos e estáveis — nunca colidem com
 * dado real e são idempotentes (re-sanitizar não muda o texto, pois nenhum
 * placeholder passa nos dígitos verificadores nem nas heurísticas).
 *
 * | kind          | placeholder            |
 * | ------------- | ---------------------- |
 * | `cpf`         | `000.000.000-00`       |
 * | `cnpj`        | `00.000.000/0000-00`   |
 * | `rg`          | `00.000.000-0`         |
 * | `cnh`         | `00000000000`          |
 * | `pis`         | `000.00000.00-0`       |
 * | `cep`         | `00000-000`            |
 * | `phone`       | `(00) 00000-0000`      |
 * | `email`       | `email@exemplo.com`    |
 * | `bank_agency` | `0000`                 |
 * | `bank_account`| `00000-0`              |
 * | `person_name` | `[NOME]`               |
 * | `address`     | `[ENDEREÇO]`           |
 *
 * A substituição NÃO preserva o comprimento do texto original.
 *
 * ## Confiança (heurística)
 *
 * - 0.99 — CPF/CNPJ com dígito verificador válido.
 * - 0.85 — e-mail; PIS/NIT com DV válido.
 * - 0.80 — telefone BR formatado (DDD/parênteses/+55/separador) ou próximo de
 *          palavra-chave; CEP formatado; agência/conta ancoradas em rótulo.
 * - 0.60 — RG (heurístico, sempre ancorado em rótulo), CNH (sem DV), CEP e
 *          PIS ancorados só por rótulo.
 * - 0.45 — sequência crua de 10/11 dígitos que *pode* ser telefone: é
 *          reportada mas NÃO é substituída nem bloqueia por padrão.
 *
 * Limiar padrão de substituição/bloqueio: {@link DEFAULT_MIN_CONFIDENCE}.
 *
 * ## Nomes e endereços
 *
 * Não há NER por regex aqui — seria falso positivo garantido em contrato
 * ("LOCADOR", "Cartório de Registro de Imóveis"...). O caminho suportado é
 * {@link resolveExternalEntities}: o classificador LLM do pipeline devolve
 * `{ kind, excerpt }` e nós resolvemos os spans por busca literal no texto
 * (tolerante a espaçamento e caixa), o que mantém o módulo determinístico.
 *
 * ## Performance
 *
 * Textos de até ~200k chars. Todas as expressões são lineares: sem
 * quantificador aninhado, sem alternância ambígua sob repetição — nada de
 * backtracking exponencial. O custo é O(n) por detector.
 */

/** Categorias de PII reconhecidas. */
export type PiiKind =
  | "cpf"
  | "cnpj"
  | "rg"
  | "cnh"
  | "pis"
  | "cep"
  | "phone"
  | "email"
  | "bank_agency"
  | "bank_account"
  | "person_name"
  | "address";

/** Origem do finding: detector determinístico local ou entidade externa (LLM). */
export type PiiSource = "regex" | "external";

/** Ocorrência de PII localizada no texto. Offsets sempre no texto ORIGINAL. */
export interface PiiFinding {
  kind: PiiKind;
  /** Índice inicial (inclusivo) no texto original. */
  start: number;
  /** Índice final (exclusivo) no texto original. */
  end: number;
  /** Trecho exato do texto — `text.slice(start, end)`. Contém o dado sensível. */
  excerpt: string;
  /** Confiança heurística em [0, 1]. Ver tabela no topo do arquivo. */
  confidence: number;
  source: PiiSource;
}

/** Entidade vinda de fora (ex.: classificador LLM), resolvida por busca literal. */
export interface ExternalEntity {
  kind: PiiKind;
  excerpt: string;
  /** Padrão: {@link EXTERNAL_ENTITY_CONFIDENCE}. */
  confidence?: number;
}

export interface SanitizeResult {
  /** Texto com os spans tratados substituídos por placeholders. */
  text: string;
  /** Findings efetivamente substituídos (offsets do texto ORIGINAL). */
  replaced: PiiFinding[];
  /** Findings que não puderam ser tratados com segurança (confiança baixa). */
  remaining: PiiFinding[];
}

export interface DetectOptions {
  /** Entidades externas (nome/endereço) a resolver junto com os detectores. */
  externalEntities?: ExternalEntity[];
}

export interface SanitizeOptions extends DetectOptions {
  /** Confiança mínima para substituir. Padrão: {@link DEFAULT_MIN_CONFIDENCE}. */
  minConfidence?: number;
}

export interface BlockingOptions {
  /** Confiança mínima para considerar bloqueante. Padrão: {@link DEFAULT_MIN_CONFIDENCE}. */
  minConfidence?: number;
  /** Categorias bloqueantes. Padrão: {@link BLOCKING_PII_KINDS}. */
  kinds?: readonly PiiKind[];
}

/** Limiar padrão de substituição e de bloqueio. */
export const DEFAULT_MIN_CONFIDENCE = 0.6;

/** Confiança padrão de uma entidade externa resolvida por busca literal. */
export const EXTERNAL_ENTITY_CONFIDENCE = 0.9;

/** Tamanho mínimo de `excerpt` externo aceito (evita destruir o texto). */
const MIN_EXTERNAL_EXCERPT_LENGTH = 3;

/** Placeholders neutros por categoria. Ver tabela no topo do arquivo. */
export const PII_PLACEHOLDERS: Readonly<Record<PiiKind, string>> = {
  cpf: "000.000.000-00",
  cnpj: "00.000.000/0000-00",
  rg: "00.000.000-0",
  cnh: "00000000000",
  pis: "000.00000.00-0",
  cep: "00000-000",
  phone: "(00) 00000-0000",
  email: "email@exemplo.com",
  bank_agency: "0000",
  bank_account: "00000-0",
  person_name: "[NOME]",
  address: "[ENDEREÇO]",
};

/**
 * Categorias que bloqueiam a promoção de um trecho a cláusula/embedding.
 * É todo o conjunto: o gate é duro por design — a decisão de relaxar é do
 * chamador, via {@link BlockingOptions}.
 */
export const BLOCKING_PII_KINDS: readonly PiiKind[] = [
  "cpf",
  "cnpj",
  "rg",
  "cnh",
  "pis",
  "cep",
  "phone",
  "email",
  "bank_agency",
  "bank_account",
  "person_name",
  "address",
];

// ---------------------------------------------------------------------------
// Validadores de dígito verificador
// ---------------------------------------------------------------------------

function onlyDigits(input: string): string {
  return input.replace(/\D/g, "");
}

/** Valida CPF pelos dois dígitos verificadores (módulo 11). */
export function isValidCpfNumber(raw: string): boolean {
  const d = onlyDigits(raw);
  if (d.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(d)) return false;

  const check = (slice: string, factorStart: number): number => {
    let sum = 0;
    for (let i = 0; i < slice.length; i++) {
      sum += Number(slice[i]) * (factorStart - i);
    }
    const rest = (sum * 10) % 11;
    return rest === 10 ? 0 : rest;
  };

  if (check(d.slice(0, 9), 10) !== Number(d[9])) return false;
  return check(d.slice(0, 10), 11) === Number(d[10]);
}

/** Valida CNPJ pelos dois dígitos verificadores (módulo 11). */
export function isValidCnpjNumber(raw: string): boolean {
  const d = onlyDigits(raw);
  if (d.length !== 14) return false;
  if (/^(\d)\1{13}$/.test(d)) return false;

  const check = (len: number): number => {
    let pos = len - 7;
    let sum = 0;
    for (let i = 0; i < len; i++) {
      sum += Number(d[i]) * pos--;
      if (pos < 2) pos = 9;
    }
    const rest = sum % 11;
    return rest < 2 ? 0 : 11 - rest;
  };

  if (check(12) !== Number(d[12])) return false;
  return check(13) === Number(d[13]);
}

/** Valida PIS/PASEP/NIT pelo dígito verificador (módulo 11, pesos 3..2). */
export function isValidPisNumber(raw: string): boolean {
  const d = onlyDigits(raw);
  if (d.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(d)) return false;

  const weights = [3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  let sum = 0;
  for (let i = 0; i < 10; i++) sum += Number(d[i]) * weights[i]!;
  const rest = 11 - (sum % 11);
  const dv = rest >= 10 ? 0 : rest;
  return dv === Number(d[10]);
}

// ---------------------------------------------------------------------------
// Detectores
// ---------------------------------------------------------------------------

// CNPJ antes de CPF: um bloco de 14 dígitos não pode ser lido como CPF.
const CNPJ_RE = /\d{2}\.\d{3}\.\d{3}\/\d{4}-?\d{2}|\d{14}/g;
const CPF_RE = /\d{3}\.\d{3}\.\d{3}-?\d{2}|\d{11}/g;

// Rótulos: o span reportado é sempre o GRUPO FINAL (só o número), para que a
// sanitização preserve o rótulo ("RG nº. ") e a legibilidade do template.
const RG_RE =
  /(?:\bR\.?G\.?\b|\bregistro geral\b|\b(?:c[ée]dula|carteira|documento) de identidade\b|\bidentidade\b)[^\n\d]{0,24}(\d{1,2}\.?\d{3}\.?\d{3}-?[\dXx]?)/gi;
const CNH_RE =
  /(?:\bCNH\b|\bcarteira nacional de habilita[çc][ãa]o\b|\bhabilita[çc][ãa]o\b|\bregistro de habilita[çc][ãa]o\b)[^\n\d]{0,24}(\d{9,11})/gi;
const PIS_RE =
  /(?:\bPIS\b|\bPASEP\b|\bPIS\/PASEP\b|\bNIT\b)[^\n\d]{0,24}(\d{3}\.?\d{5}\.?\d{2}-?\d)/gi;

const CEP_FORMATTED_RE = /\d{2}\.?\d{3}-\d{3}/g;
const CEP_LABELLED_RE = /\bCEP\b[^\n\d]{0,12}(\d{8})/gi;

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;

// Telefone: DDD (com ou sem parênteses, com ou sem +55) + 8/9 dígitos.
const PHONE_RE = /(?:\+?55[\s.-]?)?(?:\(\d{2}\)|\d{2})[\s.-]?\d{4,5}[\s.-]?\d{4}/g;
const PHONE_KEYWORD_RE = /(?:telefone|fone|celular|whatsapp|whats|cel\.|tel\.)[^\n]{0,12}$/i;

const BANK_AGENCY_RE =
  /(?:\bag[êe]ncia\b|\bag\.|\bagencia\b)\s*(?:n[º°o]\.?)?\s*:?\s*(\d{3,5}-?\d?)/gi;
const BANK_ACCOUNT_RE =
  /(?:\bc\/c\b|\bc\.c\.|\bconta corrente\b|\bconta poupan[çc]a\b|\bn[úu]mero da conta\b|\bconta\b)\s*(?:n[º°o]\.?)?\s*:?\s*(\d{4,12}-?[\dXx]?)/gi;

const DIGIT_RE = /\d/;
const NUMERIC_SEPARATOR_RE = /[.\-/]/;

function isDigit(char: string | undefined): boolean {
  return char !== undefined && DIGIT_RE.test(char);
}

/**
 * Garante que o span casado não é um pedaço de um número maior.
 * Rejeita vizinhança do tipo `9|123.456.789-01` e `123.456.789-01|23`,
 * mas aceita pontuação de frase (`... -01.` / `(...-01)`).
 */
function isIsolatedNumber(text: string, start: number, end: number): boolean {
  const before = text[start - 1];
  if (isDigit(before)) return false;
  if (before !== undefined && NUMERIC_SEPARATOR_RE.test(before) && isDigit(text[start - 2])) {
    return false;
  }
  const after = text[end];
  if (isDigit(after)) return false;
  if (after !== undefined && NUMERIC_SEPARATOR_RE.test(after) && isDigit(text[end + 1])) {
    return false;
  }
  return true;
}

function makeFinding(
  text: string,
  start: number,
  end: number,
  kind: PiiKind,
  confidence: number,
  source: PiiSource = "regex",
): PiiFinding {
  return { kind, start, end, excerpt: text.slice(start, end), confidence, source };
}

/** Detectores de documento inteiro (span = match completo) com validação de DV. */
function detectCheckDigitDocuments(text: string, out: PiiFinding[]): void {
  const specs: Array<{ re: RegExp; kind: PiiKind; isValid: (v: string) => boolean }> = [
    { re: CNPJ_RE, kind: "cnpj", isValid: isValidCnpjNumber },
    { re: CPF_RE, kind: "cpf", isValid: isValidCpfNumber },
  ];

  for (const spec of specs) {
    spec.re.lastIndex = 0;
    for (const match of text.matchAll(spec.re)) {
      const start = match.index;
      const end = start + match[0].length;
      if (!isIsolatedNumber(text, start, end)) continue;
      if (!spec.isValid(match[0])) continue;
      out.push(makeFinding(text, start, end, spec.kind, 0.99));
    }
  }
}

/** Empurra o GRUPO FINAL do match (o número), não o rótulo. */
function pushTrailingGroup(
  text: string,
  match: RegExpMatchArray,
  kind: PiiKind,
  confidence: number,
  out: PiiFinding[],
): void {
  const value = match[1];
  if (!value || match.index === undefined) return;
  const start = match.index + match[0].lastIndexOf(value);
  const end = start + value.length;
  if (!isIsolatedNumber(text, start, end)) return;
  out.push(makeFinding(text, start, end, kind, confidence));
}

/** Documentos ancorados em rótulo: RG (heurístico), CNH, PIS/NIT. */
function detectLabelledDocuments(text: string, out: PiiFinding[]): void {
  RG_RE.lastIndex = 0;
  for (const match of text.matchAll(RG_RE)) {
    pushTrailingGroup(text, match, "rg", 0.6, out);
  }

  CNH_RE.lastIndex = 0;
  for (const match of text.matchAll(CNH_RE)) {
    // CNH não tem validação de DV aqui de propósito: preferimos o falso
    // positivo (rótulo explícito) a deixar vazar um número real.
    pushTrailingGroup(text, match, "cnh", 0.6, out);
  }

  PIS_RE.lastIndex = 0;
  for (const match of text.matchAll(PIS_RE)) {
    const value = match[1];
    if (!value) continue;
    pushTrailingGroup(text, match, "pis", isValidPisNumber(value) ? 0.85 : 0.6, out);
  }
}

function detectCep(text: string, out: PiiFinding[]): void {
  CEP_FORMATTED_RE.lastIndex = 0;
  for (const match of text.matchAll(CEP_FORMATTED_RE)) {
    const start = match.index;
    const end = start + match[0].length;
    if (!isIsolatedNumber(text, start, end)) continue;
    out.push(makeFinding(text, start, end, "cep", 0.8));
  }

  CEP_LABELLED_RE.lastIndex = 0;
  for (const match of text.matchAll(CEP_LABELLED_RE)) {
    pushTrailingGroup(text, match, "cep", 0.6, out);
  }
}

function detectEmail(text: string, out: PiiFinding[]): void {
  EMAIL_RE.lastIndex = 0;
  for (const match of text.matchAll(EMAIL_RE)) {
    const start = match.index;
    out.push(makeFinding(text, start, start + match[0].length, "email", 0.85));
  }
}

function detectPhone(text: string, out: PiiFinding[]): void {
  PHONE_RE.lastIndex = 0;
  for (const match of text.matchAll(PHONE_RE)) {
    const raw = match[0];
    const start = match.index;
    const end = start + raw.length;
    if (!isIsolatedNumber(text, start, end)) continue;

    const formatted = /[\s.()+-]/.test(raw);
    const labelled = PHONE_KEYWORD_RE.test(text.slice(Math.max(0, start - 24), start));
    // Sequência crua de dígitos sem rótulo é ambígua (pode ser protocolo,
    // matrícula, número de contrato): reportamos, mas fora do limiar padrão.
    const confidence = formatted || labelled ? 0.8 : 0.45;
    out.push(makeFinding(text, start, end, "phone", confidence));
  }
}

function detectBankAccounts(text: string, out: PiiFinding[]): void {
  BANK_AGENCY_RE.lastIndex = 0;
  for (const match of text.matchAll(BANK_AGENCY_RE)) {
    pushTrailingGroup(text, match, "bank_agency", 0.8, out);
  }

  BANK_ACCOUNT_RE.lastIndex = 0;
  for (const match of text.matchAll(BANK_ACCOUNT_RE)) {
    pushTrailingGroup(text, match, "bank_account", 0.8, out);
  }
}

// ---------------------------------------------------------------------------
// Entidades externas (nome/endereço vindos do classificador LLM)
// ---------------------------------------------------------------------------

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const PLACEHOLDER_VALUES: ReadonlySet<string> = new Set(Object.values(PII_PLACEHOLDERS));

/**
 * Um texto já sanitizado não pode voltar a acusar PII — senão o gate duro
 * rejeitaria justamente o conteúdo que acabamos de limpar. Descarta os
 * placeholders da tabela e qualquer número zerado (`0000`, `00000-000`).
 */
function isSyntheticPlaceholder(excerpt: string): boolean {
  if (PLACEHOLDER_VALUES.has(excerpt)) return true;
  if (/[A-Za-zÀ-ÿ]/.test(excerpt)) return false;
  const digits = onlyDigits(excerpt);
  return digits.length > 0 && !/[1-9]/.test(digits);
}

/**
 * Resolve entidades vindas de fora (`{ kind, excerpt }`) em spans concretos,
 * por busca literal no texto. Tolerante a diferenças de espaçamento (o DOCX
 * costuma trazer espaços duplos/quebras) e a caixa. Todas as ocorrências de
 * cada `excerpt` viram findings — o LLM devolve o valor uma vez, o documento
 * repete a parte N vezes.
 *
 * Não faz NER: o que não vier na lista não é detectado.
 */
export function resolveExternalEntities(
  text: string,
  entities: readonly ExternalEntity[] | undefined,
): PiiFinding[] {
  if (!text || !entities?.length) return [];

  const findings: PiiFinding[] = [];
  const seen = new Set<string>();

  for (const entity of entities) {
    const excerpt = entity.excerpt?.trim();
    if (!excerpt || excerpt.length < MIN_EXTERNAL_EXCERPT_LENGTH) continue;

    const pattern = escapeRegExp(excerpt).replace(/\s+/g, "\\s+");
    let re: RegExp;
    try {
      re = new RegExp(pattern, "gi");
    } catch {
      continue;
    }

    const confidence = entity.confidence ?? EXTERNAL_ENTITY_CONFIDENCE;
    for (const match of text.matchAll(re)) {
      if (!match[0]) continue;
      const start = match.index;
      const end = start + match[0].length;
      const key = `${entity.kind}:${start}:${end}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const finding = makeFinding(text, start, end, entity.kind, confidence, "external");
      if (isSyntheticPlaceholder(finding.excerpt)) continue;
      findings.push(finding);
    }
  }

  return findings.sort((a, b) => a.start - b.start);
}

// ---------------------------------------------------------------------------
// Resolução de sobreposição
// ---------------------------------------------------------------------------

/**
 * Prioridade: maior confiança, depois span mais longo, depois posição.
 * Findings sobrepostos perdem para o vencedor — mas o span do vencedor cobre
 * o trecho, então nada vaza.
 */
function comparePriority(a: PiiFinding, b: PiiFinding): number {
  if (b.confidence !== a.confidence) return b.confidence - a.confidence;
  const lengthDiff = b.end - b.start - (a.end - a.start);
  if (lengthDiff !== 0) return lengthDiff;
  if (a.start !== b.start) return a.start - b.start;
  return a.kind.localeCompare(b.kind);
}

function overlaps(a: PiiFinding, b: PiiFinding): boolean {
  return a.start < b.end && b.start < a.end;
}

/** Mantém, entre findings sobrepostos, apenas o de maior prioridade. */
function resolveOverlaps(findings: PiiFinding[]): PiiFinding[] {
  const ordered = [...findings].sort(comparePriority);
  const kept: PiiFinding[] = [];
  for (const finding of ordered) {
    if (finding.end <= finding.start) continue;
    if (kept.some((other) => overlaps(other, finding))) continue;
    kept.push(finding);
  }
  return kept.sort((a, b) => a.start - b.start || a.end - b.end);
}

// ---------------------------------------------------------------------------
// API pública
// ---------------------------------------------------------------------------

/**
 * Varre o texto e devolve os findings de PII, já resolvidos por sobreposição
 * e ordenados por posição. Puro e determinístico.
 */
export function detectPii(text: string, options: DetectOptions = {}): PiiFinding[] {
  if (!text) return [];

  const raw: PiiFinding[] = [];
  detectCheckDigitDocuments(text, raw);
  detectLabelledDocuments(text, raw);
  detectCep(text, raw);
  detectEmail(text, raw);
  detectPhone(text, raw);
  detectBankAccounts(text, raw);
  raw.push(...resolveExternalEntities(text, options.externalEntities));

  return resolveOverlaps(raw.filter((finding) => !isSyntheticPlaceholder(finding.excerpt)));
}

/**
 * Substitui por placeholders neutros os spans inequívocos (confiança >=
 * `minConfidence`) e devolve o que sobrou sem tratamento.
 *
 * As substituições são aplicadas da DIREITA para a ESQUERDA, de modo que os
 * offsets dos findings seguintes nunca são invalidados. Os offsets em
 * `replaced`/`remaining` continuam se referindo ao texto ORIGINAL.
 */
export function sanitizePii(
  text: string,
  findings?: readonly PiiFinding[],
  options: SanitizeOptions = {},
): SanitizeResult {
  if (!text) return { text: text ?? "", replaced: [], remaining: [] };

  const minConfidence = options.minConfidence ?? DEFAULT_MIN_CONFIDENCE;
  const resolved = findings
    ? resolveOverlaps([...findings])
    : detectPii(text, { externalEntities: options.externalEntities });

  const replaced: PiiFinding[] = [];
  const remaining: PiiFinding[] = [];
  for (const finding of resolved) {
    if (finding.confidence >= minConfidence && PII_PLACEHOLDERS[finding.kind]) {
      replaced.push(finding);
    } else {
      remaining.push(finding);
    }
  }

  let output = text;
  for (let i = replaced.length - 1; i >= 0; i--) {
    const finding = replaced[i]!;
    output =
      output.slice(0, finding.start) +
      PII_PLACEHOLDERS[finding.kind] +
      output.slice(finding.end);
  }

  return { text: output, replaced, remaining };
}

/**
 * Gate duro: `true` se houver PII que impeça o trecho de virar cláusula /
 * embedding. Aplique SOMENTE a conteúdo de cláusula — um template pode
 * legitimamente conter o CNPJ da imobiliária no timbre.
 */
export function hasBlockingPii(
  findings: readonly PiiFinding[] | undefined,
  options: BlockingOptions = {},
): boolean {
  if (!findings?.length) return false;
  const minConfidence = options.minConfidence ?? DEFAULT_MIN_CONFIDENCE;
  const kinds = options.kinds ?? BLOCKING_PII_KINDS;
  return findings.some(
    (finding) => finding.confidence >= minConfidence && kinds.includes(finding.kind),
  );
}

/**
 * Atalho para o pipeline: detecta, sanitiza e já devolve o veredito do gate
 * sobre o que sobrou (o que foi substituído deixou de ser PII).
 */
export function sanitizeAndAudit(
  text: string,
  options: SanitizeOptions = {},
): SanitizeResult & { blocked: boolean } {
  const result = sanitizePii(text, undefined, options);
  return { ...result, blocked: hasBlockingPii(result.remaining, options) };
}
