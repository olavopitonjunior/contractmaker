import type { docs_v1 } from "googleapis";
import { batchUpdateDoc, getDocPlainText } from "@/lib/google/docs";
import { extractPlaceholdersFromText } from "@/lib/google/replace-placeholders";
import { getAnthropicClient, SONNET_MODEL } from "@/lib/ai/shared/anthropic-client";
import { recordAIUsage } from "@/lib/ai/usage";
import {
  maskForReport,
  type InsertedToken,
  type InsertionReport,
  type SkipReason,
  type SkippedToken,
  type UnmappedReason,
  type UnmappedToken,
} from "./insertion-report";

export {
  maskForReport,
  readNotMapped,
  type InsertedToken,
  type InsertionReport,
  type SkipReason,
  type SkippedToken,
  type UnmappedReason,
  type UnmappedToken,
} from "./insertion-report";

import { catalogForModalidade, requiredTokens, isKnownToken } from "./placeholder-catalog";

/**
 * Teto do texto enviado à IA. Era 24.000 chars — um contrato de locação de
 * 10-12 páginas passa disso, e a cauda (garantia, foro, assinaturas) ficava
 * invisível SEM AVISO: os tokens de lá saíam como "não mapeados" e ninguém
 * sabia por quê. 120k chars ≈ 35k tokens; Sonnet 4.6 tem 1M de contexto.
 * Sem chunking de propósito: o estágio determinístico lê o texto inteiro.
 */
export const MAX_PROMPT_CHARS = 120_000;
/** Resposta cortada aqui vira `responseTruncated`, não lista vazia muda. */
export const MAX_OUTPUT_TOKENS = 8192;

// ============================================================================
// Pass de IA da ingestão DOCX→template: lê o texto do Doc-modelo da
// imobiliária, pede ao LLM o mapeamento "trecho literal → token do catálogo"
// e aplica via replaceAllText.
//
// SEGURANÇA DO REPLACE GLOBAL: replaceAllText troca TODAS as ocorrências do
// trecho no doc. Por isso NADA vai pro batchUpdate sem passar pela validação
// determinística `countOccurrences === 1` — trecho ambíguo vai pro relatório
// (skippedAmbiguous) e o operador resolve manualmente na página de revisão.
//
// `inserted` SÓ DEPOIS DE CONFERIR: até 2026-09-02 a lista era montada antes
// do batchUpdate e a resposta da API era descartada. Na reingestão da RE/MAX
// Trio, 11 dos 12 modelos do lote 1 declaravam token "inserido" que NÃO estava
// no documento (a contagem de unicidade roda no texto plano; o replace casa
// contra a estrutura inteira do Doc, e formatação invisível parte o parágrafo
// no meio). Hoje o passe lê `occurrencesChanged` de cada reply e relê o Doc:
// inserido = o token está lá E o trecho não está mais. O resto vai para o
// relatório com o MESMO vocabulário de `apply-clause-slot.ts`, que a tela já
// traduz. "Não sei" (Drive fora na releitura) nunca vira "deu certo".
// ============================================================================

/**
 * Trecho que já contém placeholder é intocável. Este pass roda DEPOIS de
 * `applyClauseSlotToDoc`, então o `{{slot_garantia}}` já está no documento — e
 * o modelo, vendo o token solto, devolvia o trecho ao redor mapeado pro legado
 * `{{clausula_garantia}}`, apagando o slot. Aconteceu nos 4 modelos da RE/MAX
 * Trio: o template ficava DECLARANDO um slot que não existia mais, e o contrato
 * saía com a garantia da variante de referência chumbada.
 *
 * Vale pra qualquer `{{...}}`, não só pros slots: reescrever texto já
 * tokenizado nunca é o trabalho deste pass.
 */
const HAS_PLACEHOLDER = /\{\{[^{}]+\}\}/;

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
4. Tokens [composed] cobrem blocos inteiros (ex.: a qualificação completa das partes no preâmbulo, a cláusula de garantia inteira, o bloco de assinaturas) — mapeie o bloco INTEIRO de texto correspondente. Blocos multi-parágrafo são aceitos (preserve as quebras de linha do documento no trecho_literal).
5. Pra tokens de qualificação de partes (locadores/locatários, vendedores/compradores), o trecho_literal deve cobrir APENAS a qualificação em si (do nome ao último dado), SEM os rótulos fixos ao redor ("como LOCADORA e doravante nomeada PARTE LOCADORA,"). Se os dois lados usam o MESMO texto de exemplo, mapeie ambos mesmo assim — o sistema substitui o que for unívoco e deixa o ambíguo pra revisão humana.
6. NÃO mapeie texto fixo do contrato (cláusulas padrão que não variam por negócio).
7. Se não encontrar correspondência pra um token, simplesmente não o inclua.
8. O documento pode já conter placeholders no formato {{alguma_coisa}} — eles já estão prontos. NUNCA inclua no trecho_literal um texto que contenha {{...}}, nem pra "corrigir" o nome do token. Trate essas linhas como intocáveis.

DOCUMENTO:
${docText.slice(0, MAX_PROMPT_CHARS)}`;
}

export async function insertPlaceholdersWithAI(input: {
  docId: string;
  modalidade: string;
  orgId: string;
}): Promise<InsertionReport> {
  const docText = await getDocPlainText(input.docId);

  const docTruncated = docText.length > MAX_PROMPT_CHARS;

  const anthropic = getAnthropicClient();
  const t0 = Date.now();
  let raw = "";
  let responseTruncated = false;
  try {
    const response = await anthropic.messages.create({
      model: SONNET_MODEL,
      max_tokens: MAX_OUTPUT_TOKENS,
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
    // Resposta cortada no meio do JSON caía no catch mudo do parse e o passe
    // seguia com lista VAZIA — foi assim que um modelo saiu com zero chaves.
    responseTruncated = response.stop_reason === "max_tokens";
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

  /**
   * Candidato a inserção: passou nas travas do texto plano e gerou requests.
   * Vira `inserted` só depois que a reply e a releitura confirmarem.
   */
  interface Candidate {
    token: string;
    trecho: string;
    /** O parágrafo que vira `{{token}}` (o trecho inteiro, quando é um só). */
    first: string;
    /** Índice do request que insere o token. */
    requestIdx: number;
    /** Requests que esvaziam os demais parágrafos de um bloco. */
    rest: Array<{ idx: number; par: string }>;
    /** Parágrafos do bloco que ficaram no Doc (ambíguos ou não casados). */
    leftover: string[];
  }

  const skippedAmbiguous: SkippedToken[] = [];
  const requests: docs_v1.Schema$Request[] = [];
  const candidates: Candidate[] = [];
  // Só token COMPOSTO fica limitado a uma inserção: bloco duplicado no
  // contrato (duas qualificações, duas cláusulas de garantia) é regressão.
  // Token simples aceita quantos trechos a IA propuser — o valor do aluguel
  // aparece na cláusula do preço, na do reajuste e na da multa, e cada um
  // desses trechos é um candidato próprio, sob a mesma regra de unicidade.
  // Até 2026-09-02 `seenTokens` valia para todos e descartava em silêncio:
  // o modelo saía com o literal em todas as cláusulas menos uma.
  const composedTokens = new Set(
    catalogForModalidade(input.modalidade)
      .filter((d) => d.kind === "composed")
      .map((d) => d.token)
  );
  const seenComposed = new Set<string>();
  // Texto SIMULADO: acumula as substituições aceitas nesta passada, na mesma
  // semântica global do replaceAllText. A unicidade dos candidatos seguintes
  // é contada aqui, não no original — senão dois trechos sobrepostos passam
  // ambos e o segundo casa zero no Docs.
  let sim = docText;
  const applySim = (needle: string, replacement: string) => {
    sim = sim.split(needle).join(replacement);
  };

  // Longest-first, como o reverse-merge: com o texto simulado, quem entra
  // primeiro consome o que está contido nele. Se a ordem fosse a da IA, um
  // trecho curto proposto antes derrubaria o bloco longo que o contém como
  // "overlapped" — por acidente de array, não por sobreposição real.
  const ordenados = mapeamentos
    .map((m) => ({ trecho: (m.trecho_literal ?? "").trim(), token: (m.token ?? "").trim() }))
    .filter((m) => m.trecho && m.token)
    .sort((a, b) => b.trecho.length - a.trecho.length);

  for (const { trecho, token } of ordenados) {
    // Trava determinística (ver HAS_PLACEHOLDER). A regra também está no
    // prompt, mas prompt é pedido — isto é garantia. Checar o trecho INTEIRO
    // cobre de quebra os parágrafos que seriam esvaziados num bloco
    // multi-parágrafo.
    if (HAS_PLACEHOLDER.test(trecho)) {
      skippedAmbiguous.push({ token, trecho, reason: "already-tokenized" });
      continue;
    }
    if (!isKnownToken(token, input.modalidade)) {
      skippedAmbiguous.push({ token, trecho, reason: "unknown-token" });
      continue;
    }
    // Segunda proposta de bloco composto é descartada SEM entrar no relatório,
    // de propósito: não é falha a corrigir, é o passe recusando duplicar um
    // bloco — o primeiro (o maior, pela ordem acima) já está no documento.
    if (composedTokens.has(token) && seenComposed.has(token)) continue;

    // replaceAllText do Docs NÃO atravessa quebras de parágrafo — trechos
    // multi-parágrafo (clausula_garantia, assinaturas) são tratados parágrafo
    // a parágrafo: o 1º vira {{token}} e os demais são esvaziados, cada um
    // sob a mesma regra de unicidade (count===1). Parágrafo ambíguo no meio
    // (ex. linhas de assinatura repetidas) fica no doc e vai pro relatório.
    const paragraphs = trecho
      .split(/\n+/)
      .map((p) => p.trim())
      .filter((p) => p.length > 0);
    const first = paragraphs[0] ?? trecho;

    const firstCount = countOccurrences(sim, first);
    if (firstCount === 0) {
      // Existia no original? Então outra substituição desta passada o levou.
      const reason: SkipReason = countOccurrences(docText, first) > 0 ? "overlapped" : "not-found";
      skippedAmbiguous.push({ token, trecho, reason });
      continue;
    }
    if (firstCount > 1) {
      skippedAmbiguous.push({ token, trecho, reason: "ambiguous" });
      continue;
    }

    const candidate: Candidate = {
      token,
      trecho,
      first,
      requestIdx: requests.length,
      rest: [],
      leftover: [],
    };
    requests.push({
      replaceAllText: {
        containsText: { text: first, matchCase: true },
        replaceText: `{{${token}}}`,
      },
    });
    applySim(first, `{{${token}}}`);
    for (const par of paragraphs.slice(1)) {
      if (countOccurrences(sim, par) === 1) {
        candidate.rest.push({ idx: requests.length, par });
        requests.push({
          replaceAllText: {
            containsText: { text: par, matchCase: true },
            replaceText: "",
          },
        });
        applySim(par, "");
      } else {
        candidate.leftover.push(par);
      }
    }
    if (composedTokens.has(token)) seenComposed.add(token);
    candidates.push(candidate);
  }

  const inserted: InsertedToken[] = [];
  const skip = (c: Candidate, reason: SkipReason, paragraph?: string) =>
    skippedAmbiguous.push({
      token: c.token,
      trecho: c.trecho,
      reason,
      ...(paragraph ? { paragraph } : {}),
    });
  // As travas do texto plano (acima) empurram direto em skippedAmbiguous com
  // o trecho cru; a máscara é aplicada UMA vez, na montagem do relatório.
  // Tokens que a API pôs no Doc mas em lugar/quantidade que ninguém revisou.
  // Estão no texto e NÃO contam como presentes: "não confirmado" é "faltando".
  const unconfirmed = new Set<string>();

  // Texto pós-passe. Fica no pré-passe quando nada foi enviado ou quando o
  // lote falhou (batchUpdate é atômico: ou tudo entra, ou nada).
  let finalText = docText;

  if (candidates.length > 0) {
    let replies: docs_v1.Schema$Response[] | null = null;
    try {
      const res = await batchUpdateDoc(input.docId, requests);
      replies = res?.data?.replies ?? [];
    } catch (err) {
      console.error("[ai-placeholder-insertion] batchUpdate falhou:", err);
    }

    if (replies === null) {
      for (const c of candidates) skip(c, "batch-failed");
    } else {
      // 1ª triagem: o que a API disse que fez. Reply ausente (lista mais curta
      // que os requests) não decide nada — fica para a releitura.
      const changedAt = (idx: number): number | null => {
        const r = replies![idx];
        if (r === undefined) return null;
        return Number(r.replaceAllText?.occurrencesChanged ?? 0);
      };
      const pending: Candidate[] = [];
      for (const c of candidates) {
        const changed = changedAt(c.requestIdx);
        // O caso destrutivo vem primeiro: um parágrafo do bloco apagado em
        // >1 lugar é conteúdo perdido fora do trecho revisado, e o operador
        // precisa saber QUAL parágrafo, não só "deu errado".
        const overRemoved = c.rest.find((r) => (changedAt(r.idx) ?? 0) > 1);
        if (overRemoved) {
          unconfirmed.add(c.token);
          skip(c, "over-removed", overRemoved.par);
          continue;
        }
        if (changed === 0) {
          skip(c, "replace-noop");
          continue;
        }
        if (changed !== null && changed > 1) {
          unconfirmed.add(c.token);
          skip(c, "over-matched");
          continue;
        }
        for (const r of c.rest) {
          if (changedAt(r.idx) === 0) c.leftover.push(r.par);
        }
        pending.push(c);
      }

      // 2ª triagem: o que o documento mostra. Aqui se decide `inserted`.
      let reread: string | null = null;
      try {
        reread = await getDocPlainText(input.docId);
      } catch (err) {
        console.error("[ai-placeholder-insertion] releitura falhou:", err);
      }
      if (reread === null) {
        for (const c of pending) skip(c, "verify-unavailable");
      } else {
        finalText = reread;
        for (const c of pending) {
          const tokenPresent = reread.includes(`{{${c.token}}}`);
          const trechoGone = countOccurrences(reread, c.first) === 0;
          // Parágrafo de bloco cuja reply faltou: conferir na releitura em vez
          // de presumir apagado — se ainda está no Doc, é leftover.
          for (const r of c.rest) {
            if (changedAt(r.idx) === null && countOccurrences(reread, r.par) > 0) {
              c.leftover.push(r.par);
            }
          }
          if (tokenPresent && trechoGone) {
            inserted.push({
              token: c.token,
              trecho: c.trecho,
              ...(c.leftover.length > 0 ? { leftoverParagraphs: c.leftover } : {}),
            });
          } else {
            skip(c, "verify-failed");
          }
        }
      }
    }
  }

  // Estado pós-pass: o que ficou no doc vs catálogo. Quando a releitura
  // falhou, `finalText` é o pré-passe — o relatório fica pessimista, nunca
  // otimista. Token que a API pôs em lugar não revisado (over-*) está no
  // texto mas sai de `present`: ele aparece em `notMapped`/`missingRequired`
  // até alguém confirmar no Doc, em vez de sumir dos dois lados do relatório.
  // Com N candidatos por token, `unconfirmed` (por token) só vale quando
  // NENHUM candidato daquele token foi confirmado — senão o mesmo token
  // apareceria em `inserted` e em `notMapped` no mesmo relatório.
  const confirmed = new Set(inserted.map((i) => i.token));
  const present = new Set(
    extractPlaceholdersFromText(finalText).filter(
      (t) => confirmed.has(t) || !unconfirmed.has(t)
    )
  );
  const catalogTokens = catalogForModalidade(input.modalidade).map((d) => d.token);
  const missingRequired = requiredTokens(input.modalidade).filter((t) => !present.has(t));

  // Máscara antes de gravar. `trecho` e `paragraph` vêm do contrato-fonte —
  // e o `trecho` de `inserted` é o pior caso: depois do replace ele só existe
  // AQUI, porque o Doc já mostra {{token}}.
  const insertedMasked: InsertedToken[] = inserted.map((i) => ({
    ...i,
    trecho: maskForReport(i.trecho),
    ...(i.leftoverParagraphs
      ? { leftoverParagraphs: i.leftoverParagraphs.map(maskForReport) }
      : {}),
  }));
  const skippedMasked: SkippedToken[] = skippedAmbiguous.map((s) => ({
    ...s,
    trecho: maskForReport(s.trecho),
    ...(s.paragraph ? { paragraph: maskForReport(s.paragraph) } : {}),
  }));

  // Motivo por token ausente: o ÚLTIMO skip daquele token. A IA pode propor o
  // mesmo token mais de uma vez (só candidatos entram em `seenTokens`; skip
  // pré-batch não), e "último" ganha de "mais acionável" de propósito: os
  // pós-batch vêm depois dos pré-batch, então o último é o que corresponde ao
  // estado real do Doc — e todos os skips continuam em `skippedAmbiguous`.
  const lastSkip = new Map<string, SkippedToken>();
  for (const s of skippedMasked) lastSkip.set(s.token, s);
  // Sem proposta da IA, o motivo é o truncamento quando houve um. O doc vence
  // a resposta: o que ficou além do teto NUNCA foi visto, e rodar de novo não
  // muda o corte — mandar "rode a IA de novo" para essas chaves seria mandar
  // o operador a uma ação inútil. Resposta cortada só quando o doc coube.
  const semProposta: UnmappedReason = docTruncated
    ? "doc-truncated"
    : responseTruncated
      ? "response-truncated"
      : "no-mapping";
  const notMapped: UnmappedToken[] = catalogTokens
    .filter((t) => !present.has(t))
    .map((token) => {
      const s = lastSkip.get(token);
      return s ? { token, reason: s.reason, trecho: s.trecho } : { token, reason: semProposta };
    });

  return {
    inserted: insertedMasked,
    skippedAmbiguous: skippedMasked,
    notMapped,
    missingRequired,
    ranAt: new Date().toISOString(),
    // SEMPRE gravadas, mesmo falsas: `rerun-ai` faz merge RASO do relatório
    // antigo com o novo, então chave ausente não apaga a antiga — uma passada
    // que truncou deixaria `docTruncated: true` grudado para sempre, e o
    // banner "rode a IA de novo" sobreviveria à própria rodada limpa.
    docTruncated,
    responseTruncated,
  };
}
