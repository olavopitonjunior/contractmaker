/**
 * Checagens SEMÂNTICAS do modelo padronizado.
 *
 * Por que existe: em 03/09/2026, os 16 modelos da RE/MAX Trio passaram 16/16
 * no `validate-gdoc` — chaves encontradas, obrigatórias presentes, gate de PII
 * liberado — e **10 estavam errados**. O que a validação sintática não vê:
 *
 * 1. `wrong-entity` — o item da imobiliária chaveado com a chave do corretor
 *    (`{{corretagem_qualificacao}}` onde cabia `{{imobiliaria_qualificacao}}`).
 *    Sintaticamente perfeito; o contrato gerado imprime a parte errada.
 * 2. `org-literal` — CNPJ/CRECI/PIX/conta da PRÓPRIA imobiliária literais no
 *    Doc. Não é dado de terceiro (o gate de PII não bloqueia), mas congela no
 *    modelo um dado que já mora no cadastro e muda sem avisar.
 * 3. `leftover-identifier` — a chave entrou e o identificador do titular ficou
 *    ao lado dela ("{{corretagem_qualificacao}}, CRECI 12345-F").
 * 4. `collapsed-paragraph` — a cláusula inteira virou uma chave só (o incidente
 *    do #531: o item a) do rateio colapsou e a conta ficou de fora).
 * 5. `dangling-reference` — sobrou a citação de um item que o colapso apagou
 *    ("conforme o item 4.1.1", com o 4.1.1 inexistente).
 *
 * Tudo aqui é DETERMINÍSTICO e PURO: sem I/O, sem modelo. A decisão de projeto
 * (plano de 03/09) é que estas quatro classes de falha medidas em produção são
 * detectáveis sem LLM assim que existem as duas entradas que faltavam — os
 * dados da própria org e o parágrafo do contrato-fonte. Um revisor por IA só se
 * justifica pelo que ESTAS regras não pegarem, medido em corpus.
 *
 * As regras são heurísticas: elas AVISAM, não bloqueiam a ativação (o gate de
 * PII segue o único bloqueio duro). Falso positivo aqui custa um clique;
 * bloquear por heurística custaria o operador aprendendo a forçar tudo.
 */
import { DATA_KEYS, isKnownToken } from "@/lib/templates/placeholder-catalog";
import { maskForReport, splitDocParagraphs } from "@/lib/templates/insertion-report";
// Mesma régua do gate de ativação, de propósito: o conserto que esta regra
// propõe nunca pode devolver ao modelo um texto que o gate barraria.
import { auditTemplateText } from "@/lib/templates/pii-gate";
import {
  DEFAULT_MIN_CONFIDENCE,
  detectPii,
  type PiiKind,
} from "@/lib/ingestion/pii";

export type SemanticCategory =
  | "wrong-entity"
  | "org-literal"
  | "leftover-identifier"
  | "collapsed-paragraph"
  | "dangling-reference";

export type SemanticSeverity = "error" | "warning" | "info";

/**
 * Conserto proposto, no vocabulário do `doc-edit`. As frases vêm CRUAS — quem
 * aplica precisa casá-las no Doc — e por isso o relatório persistido guarda só
 * o verbo (ver {@link persistableSemanticReport}).
 */
export type SemanticFix =
  | { op: "rekey"; phrase: string; fromToken: string; toToken: string }
  | { op: "remove-leftover"; phrase: string }
  | { op: "restore-paragraph"; current: string; source: string }
  | { op: "manual" };

export interface SemanticFinding {
  /** Estável entre revalidações do mesmo estado do Doc (categoria+parágrafo+chave). */
  id: string;
  severity: SemanticSeverity;
  category: SemanticCategory;
  /** Índice em {@link splitDocParagraphs} do texto do Doc. */
  paragraphIndex: number;
  token?: string;
  /** Trecho já MASCARADO (`maskForReport`), no máximo 240 chars. */
  excerpt: string;
  message: string;
  suggestedFix?: SemanticFix;
}

/** Dados cadastrais da própria imobiliária (subconjunto de `Organization`). */
export interface OrgFacts {
  legalName?: string | null;
  cnpj?: string | null;
  creci?: string | null;
  pixAddressKey?: string | null;
  bankBranch?: string | null;
  bankAccount?: string | null;
}

export interface SemanticCheckInput {
  docText: string;
  modalidade: string;
  org: OrgFacts | null;
  /** Texto do contrato ORIGINAL (`IngestionItem.text`), quando existir. */
  sourceText?: string | null;
}

export interface SemanticReport {
  findings: SemanticFinding[];
  checkedAt: string;
  /** Havia contrato-fonte para comparar (muda o que as regras 4 e 5 afirmam). */
  sourceAvailable: boolean;
  /** Havia dados cadastrais da org (sem eles a regra 2 não roda). */
  orgFactsAvailable: boolean;
}

export const SEMANTIC_CATEGORY_LABEL: Record<SemanticCategory, string> = {
  "wrong-entity": "chave da parte errada",
  "org-literal": "dado da imobiliária fixo no modelo",
  "leftover-identifier": "dado de pessoa ao lado da chave",
  "collapsed-paragraph": "cláusula virou uma chave só",
  "dangling-reference": "citação de item inexistente",
};

const MAX_EXCERPT = 240;
const TOKEN_RE = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;
/** Parágrafo que é SÓ uma chave (tolerando marcador de lista e pontuação final). */
const ONLY_TOKEN_RE =
  /^\s*(?:[a-zA-Z]\)|\d+[.)]|[ivxIVX]+[.)])?\s*\{\{\s*([a-zA-Z0-9_]+)\s*\}\}\s*[.,;:]{0,3}\s*$/;
// As pistas toleram um aposto curto entre o substantivo e o qualificador
// ("a imobiliária, doravante denominada intermediadora"), mas o vão é limitado
// e NÃO atravessa fim de frase (`.` `;` `\n`): sem isso a pista de um parágrafo
// contaminaria a chave do parágrafo seguinte, e a regra propõe rekey — falso
// positivo aqui troca a parte que o contrato paga.
/** Pista de que a frase fala da imobiliária como parte. */
const IMOB_HINT = /imobili[áa]ria[^.;\n]{0,24}?(?:intermediadora|administradora|corretora)/i;
/** Pista de que a frase fala do corretor pessoa como parte. */
const CORRETOR_HINT = /corretor[a-zç()/]{0,6}[^.;\n]{0,24}?(?:intermediador|angariador)/i;
/** Linguagem de cláusula: um parágrafo assim não era uma qualificação. */
const CLAUSE_LANGUAGE = /R\$|%|por cento|dever[áa]|ser[áa]\s+pag|pagament/i;
const CRECI_RE = /\bCRECI\b[^\n]{0,24}?\d[\d.\-/]{2,12}[A-Za-z]?/gi;
const PIX_RE = /\bchave\s+PIX\b[^\n]{0,60}/gi;
const REF_RE =
  /\b(?:item|subitem|al[íi]nea|cl[áa]usula)s?\s+(?:n[.º°]?\s*)?(\d+(?:\.\d+){1,3})\b/gi;
/** Categorias de PII que, ao lado de uma chave de dado, são sobra do titular. */
const LEFTOVER_PII_KINDS: readonly PiiKind[] = ["cpf", "cnpj", "bank_agency", "bank_account"];
const LEFTOVER_ERROR_KINDS: ReadonlySet<string> = new Set(["cpf", "bank_agency", "bank_account"]);
/** Mínimo de dígitos para casar um dado da org sem virar ruído. */
const MIN_ORG_DIGITS = 5;

const PII_LABEL: Record<string, string> = {
  cpf: "um CPF",
  cnpj: "um CNPJ",
  bank_agency: "uma agência bancária",
  bank_account: "uma conta bancária",
};

/** NBSP e afins viram espaço só para CASAR — o corte do trecho usa o original. */
function normalizeForMatch(text: string): string {
  return text.replace(/[   ]/g, " ");
}

function onlyDigits(value: string): string {
  return value.replace(/\D+/g, "");
}

/**
 * O texto traz o número `digits` como número INTEIRO, ignorando a pontuação?
 *
 * Comparar só a cadeia de dígitos do parágrafo produz falso positivo por
 * prefixo: a agência `1234-5` casava dentro do CNPJ `12345678000190`. Aqui o
 * casamento respeita a fronteira do número — o dígito imediatamente antes e o
 * imediatamente depois (atravessando `.`, `-`, `/` e espaço, que são
 * separadores DENTRO de um número) não podem existir.
 */
function containsWholeNumber(text: string, digits: string): boolean {
  if (!digits) return false;
  const positions: number[] = [];
  let flat = "";
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] >= "0" && text[i] <= "9") {
      flat += text[i];
      positions.push(i);
    }
  }
  const isDigitAt = (i: number) => i >= 0 && i < text.length && text[i] >= "0" && text[i] <= "9";
  const scan = (from: number, step: number) => {
    let i = from;
    while (i >= 0 && i < text.length && /[.\-/  ]/.test(text[i])) i += step;
    return isDigitAt(i);
  };
  for (let at = flat.indexOf(digits); at !== -1; at = flat.indexOf(digits, at + 1)) {
    const start = positions[at];
    const end = positions[at + digits.length - 1];
    if (!scan(start - 1, -1) && !scan(end + 1, 1)) return true;
  }
  return false;
}

/**
 * Redige o que `detectPii` NÃO conhece.
 *
 * `maskForReport` cobre as categorias de `lib/ingestion/pii.ts` — CPF, RG, CNH,
 * PIS, CEP, telefone, e-mail, agência e conta. CRECI não é uma delas, e chave
 * PIX aleatória (EVP) não casa com nenhum detector. Sem isto o número do
 * corretor do contrato original ficaria CRU no `draftReport` e na tela: o
 * relatório exibiria o dado que ele existe para denunciar.
 *
 * Feito aqui, e não como categoria nova em `pii.ts`, porque uma `PiiKind` nova
 * mudaria o gate de PII da ingestão (bloqueante ou aviso?) — decisão de outro
 * escopo. Aqui só o relatório é afetado.
 */
function redactUndetectedIdentifiers(text: string): string {
  return text
    .replace(/(\bCRECI\b[^\n]{0,24}?)(\d[\d.\-/]{2,12}[A-Za-z]?)/gi, "$1[CRECI]")
    .replace(/(\bchave\s+PIX\b\W{0,4})([^\s,;]{6,})/gi, "$1[PIX]");
}

function excerptOf(text: string): string {
  const masked = redactUndetectedIdentifiers(maskForReport(text.trim()));
  return masked.length > MAX_EXCERPT ? `${masked.slice(0, MAX_EXCERPT - 1)}…` : masked;
}

function tokensIn(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(TOKEN_RE)) out.push(m[1]);
  return out;
}

/**
 * Estende o trecho para trás até o separador que o prende à frase, para que a
 * remoção não deixe vírgula órfã (`{{chave}}, CRECI 123` remove `, CRECI 123`).
 */
function extendToSeparator(paragraph: string, start: number, end: number): string {
  let i = start;
  while (i > 0 && /\s/.test(paragraph[i - 1])) i -= 1;
  if (i > 0 && /[,;–—-]/.test(paragraph[i - 1])) i -= 1;
  return paragraph.slice(i, end);
}

/** Algum parágrafo DEFINE o item `n` (começa com ele)? */
function definesItem(paragraphs: readonly string[], n: string): boolean {
  const escaped = n.replace(/\./g, "\\.");
  const re = new RegExp(`^\\s*(?:[a-zA-Z]\\)\\s*)?${escaped}(?![\\d])`);
  return paragraphs.some((p) => re.test(p));
}

function pushFinding(
  findings: SemanticFinding[],
  seen: Map<string, number>,
  finding: Omit<SemanticFinding, "id">
): void {
  const base = `${finding.category}:${finding.paragraphIndex}:${finding.token ?? "-"}`;
  const n = (seen.get(base) ?? 0) + 1;
  seen.set(base, n);
  findings.push({ ...finding, id: n === 1 ? base : `${base}:${n}` });
}

// ─────────────────────────────────────────────────────────────────────────────

/** Roda as cinco checagens sobre o texto do Doc. Puro: sem rede. */
export function runSemanticChecks(input: SemanticCheckInput): SemanticReport {
  const docParagraphs = splitDocParagraphs(input.docText ?? "");
  const srcParagraphs = input.sourceText ? splitDocParagraphs(input.sourceText) : [];
  const org = input.org ?? null;
  const orgFactsAvailable = !!org && Object.values(org).some((v) => !!v);

  const findings: SemanticFinding[] = [];
  const seen = new Map<string, number>();

  checkWrongEntity(docParagraphs, input.modalidade, findings, seen);
  if (org && orgFactsAvailable) {
    checkOrgLiterals(docParagraphs, org, input.modalidade, findings, seen);
  }
  checkLeftoverIdentifiers(docParagraphs, findings, seen);
  checkCollapsedParagraphs(docParagraphs, srcParagraphs, findings, seen);
  checkDanglingReferences(docParagraphs, srcParagraphs, findings, seen);

  findings.sort((a, b) => a.paragraphIndex - b.paragraphIndex);
  return {
    findings,
    checkedAt: new Date().toISOString(),
    sourceAvailable: srcParagraphs.length > 0,
    orgFactsAvailable,
  };
}

/**
 * Forma que vai para `ContractTemplate.draftReport.semantic`: o `suggestedFix`
 * perde as frases cruas (o Doc é a fonte; o relatório não guarda texto de
 * contrato) e fica só o verbo do conserto.
 */
export function persistableSemanticReport(report: SemanticReport): SemanticReport {
  return {
    ...report,
    findings: report.findings.map((f) => ({
      ...f,
      ...(f.suggestedFix ? { suggestedFix: { op: f.suggestedFix.op } as SemanticFix } : {}),
    })),
  };
}

/**
 * Lê `draftReport.semantic` tolerando ausência e JSON malformado (mesmo papel
 * de `readNotMapped`): relatório gravado antes desta versão não tem o campo, e
 * `null` significa "não medido", nunca "está limpo".
 */
export function readSemanticReport(raw: unknown): SemanticReport | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const semantic = (raw as { semantic?: unknown }).semantic;
  if (!semantic || typeof semantic !== "object" || Array.isArray(semantic)) return null;
  const s = semantic as Partial<SemanticReport>;
  if (!Array.isArray(s.findings)) return null;
  return {
    findings: s.findings.filter(
      (f): f is SemanticFinding =>
        !!f && typeof f === "object" && typeof (f as SemanticFinding).id === "string"
    ),
    checkedAt: typeof s.checkedAt === "string" ? s.checkedAt : "",
    sourceAvailable: s.sourceAvailable === true,
    orgFactsAvailable: s.orgFactsAvailable === true,
  };
}

/** Quantos achados de cada severidade — o que a tela e o audit reportam. */
export function countBySeverity(
  findings: readonly SemanticFinding[]
): Record<SemanticSeverity, number> {
  const out: Record<SemanticSeverity, number> = { error: 0, warning: 0, info: 0 };
  for (const f of findings) out[f.severity] += 1;
  return out;
}

// ── 1. Chave da parte errada ────────────────────────────────────────────────

const ENTITY_PREFIXES: ReadonlyArray<{
  from: string;
  to: string;
  hint: RegExp;
  anti: RegExp;
  who: string;
}> = [
  {
    from: "corretagem_",
    to: "imobiliaria_",
    hint: IMOB_HINT,
    anti: CORRETOR_HINT,
    who: "a imobiliária intermediadora",
  },
  {
    from: "imobiliaria_",
    to: "corretagem_",
    hint: CORRETOR_HINT,
    anti: IMOB_HINT,
    who: "o corretor intermediador",
  },
];

function checkWrongEntity(
  paragraphs: readonly string[],
  modalidade: string,
  findings: SemanticFinding[],
  seen: Map<string, number>
): void {
  paragraphs.forEach((paragraph, paragraphIndex) => {
    const norm = normalizeForMatch(paragraph);
    for (const token of tokensIn(paragraph)) {
      const rule = ENTITY_PREFIXES.find((r) => token.startsWith(r.from));
      if (!rule) continue;
      // Frase com as DUAS pistas não é decidível por palavra: fica de fora de
      // propósito (é o caso "a imobiliária, por seu corretor intermediador…").
      if (!rule.hint.test(norm) || rule.anti.test(norm)) continue;
      const target = `${rule.to}${token.slice(rule.from.length)}`;
      if (!isKnownToken(target, modalidade)) continue;
      pushFinding(findings, seen, {
        severity: "error",
        category: "wrong-entity",
        paragraphIndex,
        token,
        excerpt: excerptOf(paragraph),
        message: `A frase fala de ${rule.who}, mas usa a chave {{${token}}}. O contrato gerado imprimiria a outra parte — aqui cabe {{${target}}}.`,
        suggestedFix: { op: "rekey", phrase: paragraph, fromToken: token, toToken: target },
      });
    }
  });
}

// ── 2. Dado da própria imobiliária literal ──────────────────────────────────

function checkOrgLiterals(
  paragraphs: readonly string[],
  org: OrgFacts,
  modalidade: string,
  findings: SemanticFinding[],
  seen: Map<string, number>
): void {
  const numeric: Array<{ digits: string; label: string; key: string }> = [];
  const add = (raw: string | null | undefined, label: string, key: string) => {
    if (!raw) return;
    const digits = onlyDigits(raw);
    if (digits.length >= MIN_ORG_DIGITS) numeric.push({ digits, label, key });
  };
  add(org.cnpj, "o CNPJ da imobiliária", "imobiliaria_qualificacao");
  add(org.creci, "o CRECI da imobiliária", "imobiliaria_qualificacao");
  add(org.bankBranch, "a agência bancária da imobiliária", "imobiliaria_dados_pagamento");
  add(org.bankAccount, "a conta bancária da imobiliária", "imobiliaria_dados_pagamento");
  const pix = org.pixAddressKey?.trim();

  const report = (paragraphIndex: number, paragraph: string, label: string, key: string) => {
    const known = isKnownToken(key, modalidade);
    pushFinding(findings, seen, {
      severity: "warning",
      category: "org-literal",
      paragraphIndex,
      ...(known ? { token: key } : {}),
      excerpt: excerptOf(paragraph),
      message: known
        ? `Este parágrafo traz ${label} escrito no modelo. Dado da própria imobiliária deve vir do cadastro — use {{${key}}}, senão o modelo congela um valor que muda em /settings/perfil.`
        : `Este parágrafo traz ${label} escrito no modelo. Dado da própria imobiliária deve vir do cadastro (/settings/perfil), não ficar fixo aqui.`,
      suggestedFix: { op: "manual" },
    });
  };

  paragraphs.forEach((paragraph, paragraphIndex) => {
    const norm = normalizeForMatch(paragraph);
    for (const fact of numeric) {
      if (containsWholeNumber(norm, fact.digits)) {
        report(paragraphIndex, paragraph, fact.label, fact.key);
      }
    }
    if (pix && pix.length >= 8 && norm.toLowerCase().includes(pix.toLowerCase())) {
      report(paragraphIndex, paragraph, "a chave PIX da imobiliária", "imobiliaria_dados_pagamento");
    }
  });
}

// ── 3. Identificador do titular ao lado da chave ────────────────────────────

function checkLeftoverIdentifiers(
  paragraphs: readonly string[],
  findings: SemanticFinding[],
  seen: Map<string, number>
): void {
  paragraphs.forEach((paragraph, paragraphIndex) => {
    // Com mais de uma chave de dado no parágrafo, o achado é atribuído à
    // PRIMEIRA. `token` aqui é informativo (não gateia nada, e a remoção mira a
    // frase, não a chave) — mas num parágrafo com dados de duas partes o rótulo
    // pode apontar a chave vizinha. Vale para ler, não para decidir.
    const dataToken = tokensIn(paragraph).find((t) => DATA_KEYS.has(t));
    if (!dataToken) return;
    const norm = normalizeForMatch(paragraph);

    const hits: Array<{ start: number; end: number; kind: string; label: string }> = [];
    for (const f of detectPii(norm)) {
      if (f.confidence < DEFAULT_MIN_CONFIDENCE) continue;
      if (!LEFTOVER_PII_KINDS.includes(f.kind)) continue;
      hits.push({ start: f.start, end: f.end, kind: f.kind, label: PII_LABEL[f.kind] ?? f.kind });
    }
    for (const m of norm.matchAll(CRECI_RE)) {
      if (m.index === undefined) continue;
      hits.push({ start: m.index, end: m.index + m[0].length, kind: "creci", label: "um CRECI" });
    }
    for (const m of norm.matchAll(PIX_RE)) {
      if (m.index === undefined) continue;
      hits.push({ start: m.index, end: m.index + m[0].length, kind: "pix", label: "uma chave PIX" });
    }

    for (const hit of hits) {
      const phrase = extendToSeparator(paragraph, hit.start, hit.end);
      // Frase que carrega uma chave não pode ser removida: apagaria o campo.
      const removable = !phrase.includes("{{");
      pushFinding(findings, seen, {
        severity: LEFTOVER_ERROR_KINDS.has(hit.kind) ? "error" : "warning",
        category: "leftover-identifier",
        paragraphIndex,
        token: dataToken,
        excerpt: excerptOf(phrase),
        message: `A chave {{${dataToken}}} já traz este dado do cadastro, mas ${hit.label} do titular ficou escrito ao lado dela. Todo contrato gerado sairia com o dado de quem assinou o modelo.`,
        suggestedFix: removable ? { op: "remove-leftover", phrase } : { op: "manual" },
      });
    }
  });
}

// ── 4. Cláusula colapsada numa chave só ─────────────────────────────────────

function checkCollapsedParagraphs(
  docParagraphs: readonly string[],
  srcParagraphs: readonly string[],
  findings: SemanticFinding[],
  seen: Map<string, number>
): void {
  docParagraphs.forEach((paragraph, paragraphIndex) => {
    const m = ONLY_TOKEN_RE.exec(normalizeForMatch(paragraph));
    if (!m) return;
    const token = m[1];
    // SÓ chave de DADO. Medido em staging em 03/09/2026: a regra valia para
    // todo bloco composto e acusava `{{clausula_garantia}}` — que substitui uma
    // cláusula inteira POR DESENHO, assim como `assinaturas`,
    // `bloco_administradora` e `parcelas_pagamento`. Para esses, "o parágrafo
    // do fonte era uma cláusula" é a saída correta, não o defeito. O incidente
    // que originou a regra foi uma chave de dado (`imobiliaria_qualificacao`)
    // engolindo o item da cláusula de rateio — é esse o caso a pegar.
    if (!DATA_KEYS.has(token)) return;

    const source = srcParagraphs.length
      ? findSourceBetweenAnchors(docParagraphs, srcParagraphs, paragraphIndex)
      : null;

    if (source) {
      // Sem linguagem de cláusula, o parágrafo-fonte era uma qualificação — e
      // trocá-la pela chave é EXATAMENTE o que a padronização deve fazer.
      //
      // O comprimento já entrou aqui como segundo gatilho (`|| length > 400`) e
      // saiu, medido na staging em 03/09/2026: a qualificação completa de dois
      // locadores (nome, nacionalidade, profissão, RG, CPF, endereço) passa de
      // 400 caracteres sem ter nada de cláusula, e a regra promovia o trabalho
      // BEM FEITO a "erro" — propondo, como conserto, restaurar o nome e o CPF
      // das pessoas dentro do modelo. O incidente que originou a regra (#531)
      // era um item de rateio com valor em R$: é a LINGUAGEM que distingue os
      // dois casos, nunca o tamanho.
      if (!CLAUSE_LANGUAGE.test(source)) return;

      // Segunda rede, independente da primeira: nunca propor restaurar um texto
      // que o gate de ativação bloquearia. Se a regra errar de novo — por outro
      // caminho que ninguém previu —, o pior que ela faz é pedir ajuste manual,
      // em vez de oferecer um botão que devolve dado pessoal de terceiro ao
      // modelo. Uma heurística pode errar; o conserto que ela propõe não pode
      // desfazer o gate de PII.
      const devolveriaPii = auditTemplateText(source).blocked;
      pushFinding(findings, seen, {
        severity: "error",
        category: "collapsed-paragraph",
        paragraphIndex,
        token,
        excerpt: excerptOf(source),
        message: devolveriaPii
          ? `Este parágrafo virou só {{${token}}}, mas no contrato original ele era uma cláusula com texto próprio. Não dá para restaurá-lo automaticamente: o texto original contém dado pessoal (CPF, RG ou conta), e recolocá-lo no modelo imprimiria o dado de um terceiro em todo contrato gerado. Reescreva a cláusula no documento, sem os dados da pessoa.`
          : `Este parágrafo virou só {{${token}}}, mas no contrato original ele era uma cláusula com texto próprio (valor, condição ou forma de pagamento). Tudo que não era o dado da chave se perdeu.`,
        suggestedFix: devolveriaPii
          ? { op: "manual" }
          : { op: "restore-paragraph", current: paragraph, source },
      });
      return;
    }

    // Sem fonte não dá para afirmar o que havia ali — só apontar o cheiro.
    const prev = paragraphIndex > 0 ? docParagraphs[paragraphIndex - 1] : "";
    if (!/:\s*$/.test(prev) && !/rateio|comiss[ãa]o|honor[áa]rio/i.test(prev)) return;
    pushFinding(findings, seen, {
      severity: "warning",
      category: "collapsed-paragraph",
      paragraphIndex,
      token,
      excerpt: excerptOf(paragraph),
      message: `Este parágrafo é só {{${token}}}, logo depois de uma abertura de lista ou de cláusula de comissão. Confira no documento se o texto da cláusula não foi engolido pela chave.`,
      suggestedFix: { op: "manual" },
    });
  });
}

/**
 * Alinha um parágrafo do Doc com o contrato-fonte pelos VIZINHOS: o anterior e
 * o posterior precisam existir sem chaves e aparecer UMA vez no fonte. O que
 * estiver entre eles no fonte é o que o parágrafo do Doc substituiu.
 *
 * Conservador de propósito: âncora ambígua ou já tokenizada devolve `null` e a
 * regra cai no ramo "sem fonte", em vez de propor restaurar o texto errado.
 */
function findSourceBetweenAnchors(
  docParagraphs: readonly string[],
  srcParagraphs: readonly string[],
  index: number
): string | null {
  const prev = docParagraphs[index - 1];
  const next = docParagraphs[index + 1];
  if (!prev || !next || prev.includes("{{") || next.includes("{{")) return null;
  const a = uniqueIndexOf(srcParagraphs, prev);
  const b = uniqueIndexOf(srcParagraphs, next);
  if (a === null || b === null || b <= a + 1) return null;
  return srcParagraphs.slice(a + 1, b).join("\n");
}

function uniqueIndexOf(paragraphs: readonly string[], needle: string): number | null {
  const target = normalizeForMatch(needle).replace(/\s+/g, " ").trim();
  if (target.length < 20) return null;
  let found = -1;
  for (let i = 0; i < paragraphs.length; i += 1) {
    if (normalizeForMatch(paragraphs[i]).replace(/\s+/g, " ").trim() !== target) continue;
    if (found !== -1) return null;
    found = i;
  }
  return found === -1 ? null : found;
}

// ── 5. Citação de item que não existe mais ──────────────────────────────────

function checkDanglingReferences(
  docParagraphs: readonly string[],
  srcParagraphs: readonly string[],
  findings: SemanticFinding[],
  seen: Map<string, number>
): void {
  const reported = new Set<string>();
  docParagraphs.forEach((paragraph, paragraphIndex) => {
    for (const m of normalizeForMatch(paragraph).matchAll(REF_RE)) {
      const n = m[1];
      if (reported.has(n) || definesItem(docParagraphs, n)) continue;
      reported.add(n);
      const inSource = srcParagraphs.length > 0 && definesItem(srcParagraphs, n);
      pushFinding(findings, seen, {
        severity: inSource ? "error" : "info",
        category: "dangling-reference",
        paragraphIndex,
        excerpt: excerptOf(paragraph),
        message: inSource
          ? `O modelo cita o item ${n}, que existia no contrato original e não existe mais neste documento — provavelmente foi engolido por uma chave. A cláusula que cita ficou sem referência.`
          : `O modelo cita o item ${n}, mas nenhum parágrafo começa com ${n}. O contrato original também não o definia: a citação já vinha quebrada.`,
        suggestedFix: { op: "manual" },
      });
    }
  });
}
