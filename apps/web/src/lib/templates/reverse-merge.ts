import { getDocsClient } from "@/lib/google/client";
import { getDocPlainText } from "@/lib/google/docs";
import {
  buildLocacaoPlaceholderMap,
  buildVendaPlaceholderMap,
} from "./placeholder-map";

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
//     restante. O resto vai pro relatório e pro pass de IA/revisão humana.
// ============================================================================

export interface ReverseMergeResult {
  replaced: Array<{ token: string; value: string }>;
  skipped: Array<{
    token: string;
    value: string;
    reason: "ambiguous" | "too-short" | "not-found" | "stopword";
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
  const candidates = Array.from(byValue.entries()).sort(
    (a, b) => b[0].length - a[0].length
  );

  const replaced: ReverseMergeResult["replaced"] = [];
  const skipped: ReverseMergeResult["skipped"] = [];
  const requests: object[] = [];

  // Simula as substituições sobre o texto pra que a checagem de unicidade dos
  // próximos valores considere o que os anteriores já removeram.
  let text = await getDocPlainText(input.docId);

  for (const [value, token] of candidates) {
    if (value.length < MIN_VALUE_LENGTH) {
      skipped.push({ token, value, reason: "too-short" });
      continue;
    }
    if (STOPWORDS.has(value.toLowerCase())) {
      skipped.push({ token, value, reason: "stopword" });
      continue;
    }
    const count = countOccurrences(text, value);
    if (count === 0) {
      skipped.push({ token, value, reason: "not-found" });
      continue;
    }
    if (count > 1) {
      skipped.push({ token, value, reason: "ambiguous" });
      continue;
    }
    replaced.push({ token, value });
    requests.push({
      replaceAllText: {
        containsText: { text: value, matchCase: true },
        replaceText: `{{${token}}}`,
      },
    });
    text = text.replace(value, `{{${token}}}`);
  }

  if (requests.length > 0) {
    const docs = getDocsClient();
    await docs.documents.batchUpdate({
      documentId: input.docId,
      requestBody: { requests },
    });
  }

  return { replaced, skipped };
}
