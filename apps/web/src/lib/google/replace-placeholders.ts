import { getDocsClient } from "./client";
import { markProgrammaticDocEdit } from "./doc-edit-marker";

/**
 * Aplica `replaceAllText` em batchUpdate para substituir placeholders simples
 * num Google Doc. Usado por templates `engine="google_docs"` — cópia do doc
 * fonte (via copyContractGoogleDoc) seguida desta substituição.
 *
 * IMPORTANTE: este caminho não suporta loops (`{{#each}}`) nem conditionals
 * (`{{#if}}`). Apenas substituição direta de tokens. Templates com múltiplas
 * partes ou ramos PF/PJ devem usar engine="handlebars".
 *
 * Tokens aceitos no doc:
 *   {{vendedor_nome}}      — flat top-level
 *   {{vendedor.nome}}      — alias dot-notation (ambos viram a mesma key)
 *
 * Match é case-sensitive e exato. Tokens não encontrados ficam intactos no doc.
 */

export interface ReplacePlaceholdersInput {
  docId: string;
  /** Map plano de placeholder → valor de substituição. */
  replacements: Record<string, string>;
}

export interface ReplacePlaceholdersResult {
  totalRequests: number;
  occurrencesByToken: Record<string, number>;
}

/**
 * Achatar nested data em pares chave/valor flat. Não recursão profunda — apenas
 * top-level + 1 nível de aninhamento, suficiente para o caso de uso esperado
 * (vendedor_nome, imovel_endereco, comprador_nome, valor_total, etc).
 */
export function flattenForPlaceholders(
  data: Record<string, unknown>,
  prefix = ""
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(data)) {
    const key = prefix ? `${prefix}_${k}` : k;
    if (v == null) continue;
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
      out[key] = String(v);
    } else if (Array.isArray(v)) {
      // Pega só o primeiro item — o aviso na UI já avisa que loops não são suportados.
      const first = v[0];
      if (first && typeof first === "object") {
        Object.assign(out, flattenForPlaceholders(first as Record<string, unknown>, key));
      } else if (first != null) {
        out[key] = String(first);
      }
    } else if (typeof v === "object") {
      Object.assign(out, flattenForPlaceholders(v as Record<string, unknown>, key));
    }
  }
  return out;
}

/**
 * Extrai todos os placeholders `{{token}}` do texto de um Google Doc.
 * Útil para mostrar ao usuário, no momento do import, quais tokens o template
 * espera receber.
 */
export function extractPlaceholdersFromText(text: string): string[] {
  const found = new Set<string>();
  const re = /\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    found.add(m[1]);
  }
  return Array.from(found).sort();
}

export async function replacePlaceholdersInDoc(
  input: ReplacePlaceholdersInput
): Promise<ReplacePlaceholdersResult> {
  const docs = getDocsClient();
  const requests = Object.entries(input.replacements).flatMap(
    ([token, value]) => [
      {
        replaceAllText: {
          containsText: { text: `{{${token}}}`, matchCase: true },
          replaceText: value,
        },
      },
      // Aceita também a forma com espaços `{{ token }}`.
      {
        replaceAllText: {
          containsText: { text: `{{ ${token} }}`, matchCase: true },
          replaceText: value,
        },
      },
    ]
  );

  if (requests.length === 0) {
    return { totalRequests: 0, occurrencesByToken: {} };
  }

  void markProgrammaticDocEdit(input.docId); // batchUpdate raw — marca p/ o eco (#5)
  const res = await docs.documents.batchUpdate({
    documentId: input.docId,
    requestBody: { requests },
  });

  const occurrencesByToken: Record<string, number> = {};
  const replies = res.data.replies || [];
  const tokens = Object.keys(input.replacements);
  // Cada token gera 2 requests (sem espaço + com espaço).
  for (let i = 0; i < replies.length; i += 2) {
    const tok = tokens[Math.floor(i / 2)];
    const a = replies[i]?.replaceAllText?.occurrencesChanged ?? 0;
    const b = replies[i + 1]?.replaceAllText?.occurrencesChanged ?? 0;
    occurrencesByToken[tok] = Number(a) + Number(b);
  }

  return { totalRequests: requests.length, occurrencesByToken };
}
