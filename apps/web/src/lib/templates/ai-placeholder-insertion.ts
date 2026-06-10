import { getDocsClient } from "@/lib/google/client";
import { getDocPlainText } from "@/lib/google/docs";
import { extractPlaceholdersFromText } from "@/lib/google/replace-placeholders";
import { getAnthropicClient, SONNET_MODEL } from "@/lib/ai/shared/anthropic-client";
import { recordAIUsage } from "@/lib/ai/usage";
import { catalogForModalidade, requiredTokens, isKnownToken } from "./placeholder-catalog";

// ============================================================================
// Pass de IA da ingestão DOCX→template: lê o texto do Doc-modelo da
// imobiliária, pede ao LLM o mapeamento "trecho literal → token do catálogo"
// e aplica via replaceAllText.
//
// SEGURANÇA DO REPLACE GLOBAL: replaceAllText troca TODAS as ocorrências do
// trecho no doc. Por isso NADA vai pro batchUpdate sem passar pela validação
// determinística `countOccurrences === 1` — trecho ambíguo vai pro relatório
// (skippedAmbiguous) e o operador resolve manualmente na página de revisão.
// ============================================================================

export interface InsertedToken {
  token: string;
  trecho: string;
}

export interface SkippedToken {
  token: string;
  trecho: string;
  reason: "ambiguous" | "not-found" | "unknown-token";
}

export interface InsertionReport {
  inserted: InsertedToken[];
  skippedAmbiguous: SkippedToken[];
  /** Tokens do catálogo que a IA não conseguiu localizar no doc. */
  notMapped: string[];
  /** Tokens obrigatórios ainda ausentes no doc após o pass. */
  missingRequired: string[];
  ranAt: string;
}

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

function buildPrompt(modalidade: string, docText: string): string {
  const catalogo = catalogForModalidade(modalidade)
    .map(
      (d) =>
        `- ${d.token}${d.required ? " (OBRIGATÓRIO)" : ""} [${d.kind}]: ${d.description} Ex.: "${d.example}"`
    )
    .join("\n");

  return `Você prepara um MODELO de contrato imobiliário pra virar template com placeholders.

O documento abaixo é o modelo da imobiliária, com dados de exemplo (nomes, valores, endereços fictícios ou de um contrato antigo). Sua tarefa: identificar os trechos que correspondem a cada token do catálogo, pra que sejam substituídos por {{token}}.

CATÁLOGO DE TOKENS (modalidade ${modalidade}):
${catalogo}

REGRAS:
1. Responda APENAS JSON válido: { "mapeamentos": [ { "trecho_literal": "...", "token": "..." } ] }
2. trecho_literal deve ser CÓPIA EXATA, caractere a caractere, de um trecho do documento — e deve ser ÚNICO no documento. Se o valor aparece mais de uma vez (ex. um nome repetido), inclua contexto ao redor até o trecho ficar único; nesse caso o trecho inteiro será substituído pelo token, então só faça isso quando o contexto INTEIRO corresponder ao conteúdo do token.
3. Use SOMENTE tokens do catálogo. Não invente.
4. Tokens [composed] cobrem blocos inteiros (ex.: a qualificação completa das partes no preâmbulo, a cláusula de garantia inteira, o bloco de assinaturas) — mapeie o bloco INTEIRO de texto correspondente.
5. NÃO mapeie texto fixo do contrato (cláusulas padrão que não variam por negócio).
6. Se não encontrar correspondência pra um token, simplesmente não o inclua.

DOCUMENTO:
${docText.slice(0, 24000)}`;
}

export async function insertPlaceholdersWithAI(input: {
  docId: string;
  modalidade: string;
  orgId: string;
}): Promise<InsertionReport> {
  const docText = await getDocPlainText(input.docId);

  const anthropic = getAnthropicClient();
  const t0 = Date.now();
  let raw = "";
  try {
    const response = await anthropic.messages.create({
      model: SONNET_MODEL,
      max_tokens: 4096,
      temperature: 0,
      messages: [{ role: "user", content: buildPrompt(input.modalidade, docText) }],
    });
    recordAIUsage({
      orgId: input.orgId,
      userId: null,
      contractId: null,
      provider: "anthropic",
      model: SONNET_MODEL,
      operation: "template_placeholder_insertion",
      promptTokens: response.usage?.input_tokens ?? 0,
      completionTokens: response.usage?.output_tokens ?? 0,
      latencyMs: Date.now() - t0,
      success: true,
    });
    const block = response.content.find((b) => b.type === "text");
    raw = block && block.type === "text" ? block.text : "";
  } catch (err) {
    recordAIUsage({
      orgId: input.orgId,
      userId: null,
      contractId: null,
      provider: "anthropic",
      model: SONNET_MODEL,
      operation: "template_placeholder_insertion",
      promptTokens: 0,
      latencyMs: Date.now() - t0,
      success: false,
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }

  let mapeamentos: Array<{ trecho_literal?: string; token?: string }> = [];
  const match = raw.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      const parsed = JSON.parse(match[0]) as { mapeamentos?: typeof mapeamentos };
      if (Array.isArray(parsed.mapeamentos)) mapeamentos = parsed.mapeamentos;
    } catch {
      // JSON inválido — segue com lista vazia; relatório aponta notMapped.
    }
  }

  const inserted: InsertedToken[] = [];
  const skippedAmbiguous: SkippedToken[] = [];
  const requests: object[] = [];
  const seenTokens = new Set<string>();

  for (const m of mapeamentos) {
    const trecho = (m.trecho_literal ?? "").trim();
    const token = (m.token ?? "").trim();
    if (!trecho || !token) continue;
    if (!isKnownToken(token, input.modalidade)) {
      skippedAmbiguous.push({ token, trecho, reason: "unknown-token" });
      continue;
    }
    if (seenTokens.has(token)) continue;
    const count = countOccurrences(docText, trecho);
    if (count === 0) {
      skippedAmbiguous.push({ token, trecho, reason: "not-found" });
      continue;
    }
    if (count > 1) {
      skippedAmbiguous.push({ token, trecho, reason: "ambiguous" });
      continue;
    }
    seenTokens.add(token);
    inserted.push({ token, trecho });
    requests.push({
      replaceAllText: {
        containsText: { text: trecho, matchCase: true },
        replaceText: `{{${token}}}`,
      },
    });
  }

  if (requests.length > 0) {
    const docs = getDocsClient();
    await docs.documents.batchUpdate({
      documentId: input.docId,
      requestBody: { requests },
    });
  }

  // Estado pós-pass: o que ficou no doc vs catálogo.
  const finalText = await getDocPlainText(input.docId);
  const present = new Set(extractPlaceholdersFromText(finalText));
  const catalogTokens = catalogForModalidade(input.modalidade).map((d) => d.token);
  const notMapped = catalogTokens.filter((t) => !present.has(t));
  const missingRequired = requiredTokens(input.modalidade).filter((t) => !present.has(t));

  return {
    inserted,
    skippedAmbiguous,
    notMapped,
    missingRequired,
    ranAt: new Date().toISOString(),
  };
}
