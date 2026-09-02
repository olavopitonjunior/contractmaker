// Laudo determinístico de preenchimento — módulo puro.
//
// A geração por Google Docs é 100% hardcoded: `buildXPlaceholderMap` produz
// o mapa token→valor a partir do formulário, `replacePlaceholdersInDoc` troca
// cada `{{token}}` pelo valor e `cleanupOrphanPlaceholders` apaga o que sobrou.
// Nenhum modelo de linguagem decide nada nesse caminho — e é por isso que ele
// merece um LAUDO, não um palpite: os dois passos já devolvem o que precisamos
// (`occurrencesByToken` e a lista de órfãos apagados) e os call sites jogavam
// os dois fora. Este módulo lê esses retornos e responde três perguntas:
//
//   1. Que campo o modelo pedia e saiu EM BRANCO? (token no Doc, valor "")
//   2. Que chave o modelo pedia que o sistema NÃO produz? (órfão apagado)
//   3. Quantos campos foram efetivamente preenchidos?
//
// O laudo vai para `GenerationPlan.fill` e vira comentário de revisão
// (`placeholderFillChecks` em checks.ts) — "o agente entra só depois, para
// validar se todos os campos foram efetivamente preenchidos", nas palavras do
// dono. Filosofia D16: aviso, nunca bloqueio; o contrato é gerado sempre.
import { catalogForModalidade, requiredTokens } from "@/lib/templates/placeholder-catalog";

export const FILL_REPORT_VERSION = 1;

export interface EmptyFieldEntry {
  token: string;
  /** Quantas vezes o token estava no Doc (todas saíram em branco). */
  occurrences: number;
  /** Obrigatório no catálogo da modalidade — o contrato está incompleto. */
  required: boolean;
}

export interface GenerationFillReport {
  version: number;
  /** Tokens presentes no Doc cujo valor no mapa era vazio. */
  empty: EmptyFieldEntry[];
  /** Tokens presentes no Doc e ausentes do mapa (apagados pelo cleanup). */
  unknown: string[];
  /** Tokens presentes no Doc substituídos por valor não-vazio. */
  filled: number;
}

export interface BuildFillReportInput {
  /** Retorno de `replacePlaceholdersInDoc` — ocorrências trocadas por token. */
  occurrencesByToken: Record<string, number>;
  /** O mapa que foi enviado ao replace (token → valor). */
  replacements: Record<string, string>;
  /** Retorno de `cleanupOrphanPlaceholders` — `{{token}}` crus apagados. */
  orphansRemoved: string[];
  /** Modalidade do template (catálogo de obrigatórios). Null = sem catálogo. */
  modalidade: string | null | undefined;
}

// Qualquer coisa entre chaves duplas: o cleanup captura `{{nome do locador}}`
// (digitado à mão, com espaço) tanto quanto `{{token}}`. O nome sai SEM as
// chaves em todo caso — quem exibe reembrulha, e `{{{{x}}}}` na tela é bug.
const TOKEN_RE = /^\{\{\s*([\s\S]*?)\s*\}\}$/;

/** `{{ token }}` → `token`; texto que não é token volta como veio. */
export function tokenNameOf(raw: string): string {
  const m = TOKEN_RE.exec(raw.trim());
  return m ? m[1].trim() : raw.trim();
}

export function buildFillReport(input: BuildFillReportInput): GenerationFillReport {
  const required = new Set(input.modalidade ? requiredTokens(input.modalidade) : []);
  const empty: EmptyFieldEntry[] = [];
  let filled = 0;

  for (const [token, occurrences] of Object.entries(input.occurrencesByToken)) {
    if (!occurrences || occurrences <= 0) continue;
    const value = input.replacements[token];
    if (value === undefined) continue;
    if (value.trim() === "") {
      empty.push({ token, occurrences, required: required.has(token) });
    } else {
      filled += 1;
    }
  }
  // Obrigatório antes, depois alfabético — a ordem do laudo é a ordem de
  // gravidade, e estável entre gerações (o dedupe do comentário depende disso).
  empty.sort((a, b) =>
    a.required === b.required ? a.token.localeCompare(b.token) : a.required ? -1 : 1
  );

  const unknown = Array.from(
    new Set(input.orphansRemoved.map(tokenNameOf).filter((t) => t.length > 0))
  ).sort();

  return { version: FILL_REPORT_VERSION, empty, unknown, filled };
}

/** Rótulo humano do catálogo; token cru quando a modalidade não o conhece. */
export function labelForToken(token: string, modalidade: string | null | undefined): string {
  if (!modalidade) return token;
  return catalogForModalidade(modalidade).find((d) => d.token === token)?.label ?? token;
}

/** Leitura defensiva do jsonb — laudo malformado = sem laudo, nunca lança. */
export function parseFillReport(json: unknown): GenerationFillReport | null {
  if (!json || typeof json !== "object" || Array.isArray(json)) return null;
  const raw = json as Record<string, unknown>;
  if (raw.version !== FILL_REPORT_VERSION) return null;
  if (!Array.isArray(raw.empty) || !Array.isArray(raw.unknown)) return null;
  if (typeof raw.filled !== "number") return null;
  const empty: EmptyFieldEntry[] = [];
  for (const e of raw.empty) {
    if (!e || typeof e !== "object") return null;
    const entry = e as Record<string, unknown>;
    if (typeof entry.token !== "string" || typeof entry.occurrences !== "number") return null;
    empty.push({
      token: entry.token,
      occurrences: entry.occurrences,
      required: entry.required === true,
    });
  }
  const unknown = raw.unknown.filter((u): u is string => typeof u === "string");
  return { version: FILL_REPORT_VERSION, empty, unknown, filled: raw.filled };
}
