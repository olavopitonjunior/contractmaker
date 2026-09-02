import type { docs_v1 } from "googleapis";
import { batchUpdateDoc, getDocPlainText } from "@/lib/google/docs";
import {
  buildLocacaoPlaceholderMap,
  buildVendaPlaceholderMap,
} from "./placeholder-map";
import type { SkipReason } from "./insertion-report";

// ============================================================================
// Reverse-merge: transforma um CONTRATO preenchido (Google Doc) em MODELO com
// placeholders, usando o dataJson do contrato como gabarito — pra cada token
// do mapa conhecemos o VALOR que foi renderizado; substituímos valor→{{token}}
// quando a troca é segura.
//
// Segurança (replaceAllText é global no doc):
//   - longest-first: blocos compostos (qualificação inteira) saem antes dos
//     campos curtos (CPF) que vivem dentro deles;
//   - minLength >= 4 e stopwords: valores genéricos ("São Paulo", "10") nunca
//     são trocados às cegas;
//   - unicidade: só substitui quando o valor ocorre EXATAMENTE 1 vez no texto
//     simulado (o original com as trocas anteriores já aplicadas). O resto vai
//     pro relatório e pro pass de IA/revisão humana.
//
// `replaced` SÓ DEPOIS DE CONFERIR (2026-09-02, mesmo desenho do passe de IA):
// a lista era montada antes do batchUpdate e a resposta da API era descartada.
// Agora cada request tem índice rastreado, `occurrencesChanged` faz a 1ª
// triagem, a releitura do Doc faz a 2ª — substituído = o token está lá E o
// valor não está mais. "Não sei" (Drive fora na releitura) nunca vira "deu
// certo". O batch vai por `batchUpdateDoc`, que marca a edição como
// programática para o eco do webhook do Drive.
// ============================================================================

/**
 * Motivos pré-batch (`ambiguous`, `too-short`, `not-found`, `stopword`,
 * `batch-failed`): o Doc NÃO foi tocado para aquele valor. Motivos pós-batch
 * `over-matched` e `verify-failed`: o Doc PODE ter sido alterado (a API
 * reportou ocorrências trocadas) e mesmo assim o item sai em `skipped`,
 * porque "não confirmado" conta como falha — pessimista de propósito, mesmo
 * desenho do passe de IA. Quem lê `skipped` não pode inferir "o valor ainda
 * está lá": a fonte da verdade é o Doc, não o relatório.
 */
export type ReverseMergeSkipReason =
  | "ambiguous"
  | "too-short"
  | "not-found"
  | "stopword"
  // Pós-batch — mesmo vocabulário de insertion-report.ts / apply-clause-slot.ts.
  | Extract<
      SkipReason,
      "batch-failed" | "replace-noop" | "over-matched" | "verify-failed" | "verify-unavailable"
    >;

export interface ReverseMergeResult {
  /** Trocas CONFIRMADAS no documento após o batch (não "enviadas"). */
  replaced: Array<{ token: string; value: string }>;
  skipped: Array<{ token: string; value: string; reason: ReverseMergeSkipReason }>;
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

export async function reverseMergeDocToTemplate(input: {
  docId: string;
  dataJson: Record<string, unknown>;
  modalidade: string;
}): Promise<ReverseMergeResult> {
  const map = input.modalidade.startsWith("locacao")
    ? buildLocacaoPlaceholderMap(input.dataJson)
    : buildVendaPlaceholderMap(input.dataJson);

  // Inverte valor→token; em colisão de valores, o primeiro token do catálogo
  // composto/canônico vence (Object.entries preserva a ordem de inserção do
  // map: flat legado primeiro, canônicos depois — então canônicos sobrescrevem
  // o flat de mesmo valor, o que é o desejado).
  const byValue = new Map<string, string>();
  for (const [token, value] of Object.entries(map)) {
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
  const planned: Array<{ token: string; value: string; requestIdx: number }> = [];

  // Simula as substituições sobre o texto (GLOBAL, como o replaceAllText —
  // com a guarda de unicidade dá no mesmo, mas a semântica fica explícita)
  // pra que a checagem de unicidade dos próximos valores considere o que os
  // anteriores já removeram.
  const docText = await getDocPlainText(input.docId);
  let sim = docText;

  for (const [value, token] of candidatesAll) {
    if (value.length < MIN_VALUE_LENGTH) {
      skipped.push({ token, value, reason: "too-short" });
      continue;
    }
    if (STOPWORDS.has(value.toLowerCase())) {
      skipped.push({ token, value, reason: "stopword" });
      continue;
    }
    const count = countOccurrences(sim, value);
    if (count === 0) {
      skipped.push({ token, value, reason: "not-found" });
      continue;
    }
    if (count > 1) {
      skipped.push({ token, value, reason: "ambiguous" });
      continue;
    }
    planned.push({ token, value, requestIdx: requests.length });
    requests.push({
      replaceAllText: {
        containsText: { text: value, matchCase: true },
        replaceText: `{{${token}}}`,
      },
    });
    sim = sim.split(value).join(`{{${token}}}`);
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
    const r = replies[p.requestIdx];
    const changed = r === undefined ? null : Number(r.replaceAllText?.occurrencesChanged ?? 0);
    if (changed === 0) {
      skipped.push({ token: p.token, value: p.value, reason: "replace-noop" });
    } else if (changed !== null && changed > 1) {
      // Casou também fora do texto plano (cabeçalho/rodapé): editou lugar que
      // ninguém examinou. O Doc mudou; o relatório não finge que foi limpo.
      skipped.push({ token: p.token, value: p.value, reason: "over-matched" });
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
  for (const p of pending) {
    const tokenPresent = reread.includes(`{{${p.token}}}`);
    const valueGone = countOccurrences(reread, p.value) === 0;
    if (tokenPresent && valueGone) replaced.push({ token: p.token, value: p.value });
    else skipped.push({ token: p.token, value: p.value, reason: "verify-failed" });
  }

  return { replaced, skipped };
}
