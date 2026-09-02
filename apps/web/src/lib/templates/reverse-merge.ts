import type { docs_v1 } from "googleapis";
import { batchUpdateDoc, getDocPlainText } from "@/lib/google/docs";
import {
  buildLocacaoPlaceholderMap,
  buildVendaPlaceholderMap,
} from "./placeholder-map";
import { catalogForModalidade } from "./placeholder-catalog";
import { isSpecificValue, normalizeSpaces } from "./specific-value";
import type { SkipReason } from "./insertion-report";

// ============================================================================
// Reverse-merge: transforma um CONTRATO preenchido (Google Doc) em MODELO com
// placeholders, usando o dataJson do contrato como gabarito — pra cada token
// do mapa conhecemos o VALOR que foi renderizado; substituímos valor→{{token}}
// quando a troca é segura.
//
// Segurança (replaceAllText é global no doc):
//   - só tokens do CATÁLOGO da modalidade são candidatos. O mapa também traz
//     as chaves cruas do flatten (`imovel_area`, `garantia_tipo`, `fiscal_*`,
//     `locatarios_nome`…) — valores genéricos demais para trocar às cegas, e
//     tokens que a validação do modelo marca como desconhecidos;
//   - longest-first: blocos compostos (qualificação inteira) saem antes dos
//     campos curtos (CPF) que vivem dentro deles;
//   - minLength >= 4 e stopwords: valores genéricos ("São Paulo", "10") nunca
//     são trocados às cegas;
//   - unicidade OU especificidade: `matchPolicy: "unique"` (default) só troca
//     quando o valor ocorre EXATAMENTE 1 vez no texto simulado; `"all"` troca
//     todas as ocorrências, mas só se `isSpecificValue(valor)` — o par
//     (token, valor) decide. "10 de agosto de 2021" passa e vira token em
//     todas as cláusulas; "casa" não passa e não deve passar.
//   - NBSP ≡ espaço: o helper `moeda` produz `R$ `, Doc digitado traz
//     espaço comum. A contagem normaliza os dois lados e o request vai com o
//     texto COMO ESTÁ no Doc (o Docs casa literal) — issue #503.
//
// `replaced` SÓ DEPOIS DE CONFERIR (2026-09-02, mesmo desenho do passe de IA):
// cada request tem índice rastreado, `occurrencesChanged` faz a 1ª triagem,
// a releitura do Doc faz a 2ª — substituído = o token está lá E o valor não
// está mais. "Não sei" (Drive fora na releitura) nunca vira "deu certo". O
// batch vai por `batchUpdateDoc`, que marca a edição como programática.
// ============================================================================

/**
 * Motivos pré-batch (`ambiguous`, `too-short`, `not-found`, `stopword`,
 * `not-specific`, `batch-failed`): o Doc NÃO foi tocado para aquele valor.
 * Motivos pós-batch `over-matched` e `verify-failed`: o Doc PODE ter sido
 * alterado (a API reportou ocorrências trocadas) e mesmo assim o item sai em
 * `skipped`, porque "não confirmado" conta como falha — pessimista de
 * propósito. Quem lê `skipped` não pode inferir "o valor ainda está lá": a
 * fonte da verdade é o Doc, não o relatório.
 */
export type ReverseMergeSkipReason =
  | "ambiguous"
  | "too-short"
  | "not-found"
  | "stopword"
  /** Token com `matchPolicy: "all"`, valor repetido, mas genérico demais para trocar em todo lugar. */
  | "not-specific"
  // Pós-batch — mesmo vocabulário de insertion-report.ts / apply-clause-slot.ts.
  | Extract<
      SkipReason,
      "batch-failed" | "replace-noop" | "over-matched" | "verify-failed" | "verify-unavailable"
    >;

export interface ReverseMergeResult {
  /** Trocas CONFIRMADAS no documento após o batch (não "enviadas"). */
  replaced: Array<{ token: string; value: string; occurrences: number }>;
  skipped: Array<{
    token: string;
    value: string;
    reason: ReverseMergeSkipReason;
    /** Ocorrências no texto no momento da decisão (útil em `ambiguous`/`not-specific`). */
    occurrences?: number;
  }>;
}

const MIN_VALUE_LENGTH = 4;

// Valores que aparecem em texto fixo de contrato com frequência — trocá-los
// às cegas corromperia cláusulas padrão.
const STOPWORDS = new Set(
  [
    "são paulo",
    "rio de janeiro",
    "brasileiro",
    "brasileira",
    "brasileiro(a)",
    "casado",
    "casada",
    "casado(a)",
    "solteiro",
    "solteira",
    "solteiro(a)",
    "localização do imóvel",
  ].map((s) => s.toLowerCase())
);

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let idx = haystack.indexOf(needle);
  while (idx !== -1) {
    count++;
    idx = haystack.indexOf(needle, idx + 1);
  }
  return count;
}

/**
 * Formas LITERAIS com que `value` aparece no Doc (NBSP × espaço podem variar
 * de ocorrência para ocorrência). `normalizeSpaces` é 1:1 em comprimento, então
 * o índice no texto normalizado vale no original.
 */
function literalForms(doc: string, normDoc: string, normValue: string): string[] {
  const forms = new Set<string>();
  let idx = normDoc.indexOf(normValue);
  while (idx !== -1) {
    forms.add(doc.slice(idx, idx + normValue.length));
    idx = normDoc.indexOf(normValue, idx + 1);
  }
  return Array.from(forms);
}

export async function reverseMergeDocToTemplate(input: {
  docId: string;
  dataJson: Record<string, unknown>;
  modalidade: string;
}): Promise<ReverseMergeResult> {
  const map = input.modalidade.startsWith("locacao")
    ? buildLocacaoPlaceholderMap(input.dataJson)
    : buildVendaPlaceholderMap(input.dataJson);
  const catalog = catalogForModalidade(input.modalidade);
  const eligible = new Set(catalog.map((d) => d.token));
  const policyOf = new Map(catalog.map((d) => [d.token, d.matchPolicy ?? "unique"] as const));

  // Inverte valor→token; em colisão de valores, o último token do mapa vence
  // (Object.entries preserva a ordem de inserção: flat legado primeiro,
  // canônicos depois — e só os canônicos do catálogo são elegíveis).
  const byValue = new Map<string, string>();
  for (const [token, value] of Object.entries(map)) {
    if (!eligible.has(token)) continue;
    const v = (value ?? "").trim();
    if (!v) continue;
    byValue.set(v, token);
  }

  // longest-first: blocos compostos antes dos valores curtos contidos neles.
  const candidatesAll = Array.from(byValue.entries()).sort(
    (a, b) => b[0].length - a[0].length
  );

  const skipped: ReverseMergeResult["skipped"] = [];
  const requests: docs_v1.Schema$Request[] = [];
  const planned: Array<{
    token: string;
    value: string;
    normValue: string;
    expected: number;
    requestIdx: number[];
  }> = [];

  // Simula as substituições sobre o texto (GLOBAL, como o replaceAllText) pra
  // que a checagem de unicidade dos próximos valores considere o que os
  // anteriores já removeram. `sim` é o texto ORIGINAL (com NBSP onde houver);
  // a contagem usa a versão normalizada dos dois lados.
  const docText = await getDocPlainText(input.docId);
  let sim = docText;

  for (const [value, token] of candidatesAll) {
    const normValue = normalizeSpaces(value);
    if (normValue.length < MIN_VALUE_LENGTH) {
      skipped.push({ token, value, reason: "too-short" });
      continue;
    }
    if (STOPWORDS.has(normValue.toLowerCase())) {
      skipped.push({ token, value, reason: "stopword" });
      continue;
    }
    const normSim = normalizeSpaces(sim);
    const count = countOccurrences(normSim, normValue);
    if (count === 0) {
      skipped.push({ token, value, reason: "not-found" });
      continue;
    }
    const policy = policyOf.get(token) ?? "unique";
    if (count > 1) {
      if (policy !== "all") {
        skipped.push({ token, value, reason: "ambiguous", occurrences: count });
        continue;
      }
      if (!isSpecificValue(value)) {
        skipped.push({ token, value, reason: "not-specific", occurrences: count });
        continue;
      }
    }
    // Uma request por forma literal presente no Doc (NBSP × espaço).
    const forms = literalForms(sim, normSim, normValue);
    const idx: number[] = [];
    for (const form of forms) {
      idx.push(requests.length);
      requests.push({
        replaceAllText: {
          containsText: { text: form, matchCase: true },
          replaceText: `{{${token}}}`,
        },
      });
      sim = sim.split(form).join(`{{${token}}}`);
    }
    planned.push({ token, value, normValue, expected: count, requestIdx: idx });
  }

  const replaced: ReverseMergeResult["replaced"] = [];
  if (planned.length === 0) return { replaced, skipped };

  let replies: docs_v1.Schema$Response[] | null = null;
  try {
    const res = await batchUpdateDoc(input.docId, requests);
    replies = res?.data?.replies ?? [];
  } catch (err) {
    console.error("[reverse-merge] batchUpdate falhou:", err);
  }
  if (replies === null) {
    for (const p of planned) skipped.push({ token: p.token, value: p.value, reason: "batch-failed" });
    return { replaced, skipped };
  }

  // 1ª triagem: o que a API disse que fez. Reply ausente não decide.
  const pending: typeof planned = [];
  for (const p of planned) {
    let changed: number | null = 0;
    for (const i of p.requestIdx) {
      const r = replies[i];
      if (r === undefined) {
        changed = null;
        break;
      }
      changed += Number(r.replaceAllText?.occurrencesChanged ?? 0);
    }
    if (changed === 0) {
      skipped.push({ token: p.token, value: p.value, reason: "replace-noop" });
    } else if (changed !== null && changed > p.expected) {
      // Casou além do texto plano (cabeçalho/rodapé): editou lugar que ninguém
      // examinou. O Doc mudou; o relatório não finge que foi limpo.
      skipped.push({ token: p.token, value: p.value, reason: "over-matched", occurrences: changed });
    } else {
      pending.push(p);
    }
  }

  // 2ª triagem: o que o documento mostra.
  let reread: string | null = null;
  try {
    reread = await getDocPlainText(input.docId);
  } catch (err) {
    console.error("[reverse-merge] releitura falhou:", err);
  }
  if (reread === null) {
    for (const p of pending) skipped.push({ token: p.token, value: p.value, reason: "verify-unavailable" });
    return { replaced, skipped };
  }
  const normReread = normalizeSpaces(reread);
  for (const p of pending) {
    const tokenPresent = reread.includes(`{{${p.token}}}`);
    const valueGone = countOccurrences(normReread, p.normValue) === 0;
    if (tokenPresent && valueGone) {
      replaced.push({ token: p.token, value: p.value, occurrences: p.expected });
    } else {
      skipped.push({ token: p.token, value: p.value, reason: "verify-failed" });
    }
  }

  return { replaced, skipped };
}
