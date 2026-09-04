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

import { catalogForModalidade, requiredTokens, isKnownToken, DATA_KEYS } from "./placeholder-catalog";
import { textFingerprint } from "@/lib/ingestion/pii";
import { applyDocEdits, type DocEditReason } from "./doc-edit";

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

/**
 * Espaço não-quebrável ≠ espaço. O DOCX da imobiliária traz NBSP depois de
 * "8.1." (autocorreção do Word) e o modelo devolve a cópia com espaço comum —
 * a cláusula de garantia inteira saía como `not-found` em 3 de 16 modelos da
 * Trio. Casar tolerando a diferença é seguro porque o que vai para o Docs é a
 * forma REAL do documento (`forms`), nunca a do modelo.
 */
const NBSP_RE = /[\u00A0\u202F]/g;
function normSpaces(text: string): string {
  return text.replace(NBSP_RE, " ");
}

/** Ocorrências de `needle` em `hay` tolerando NBSP, com a forma real de cada uma. */
function locate(hay: string, needle: string): { count: number; forms: string[] } {
  if (!needle) return { count: 0, forms: [] };
  const nh = normSpaces(hay);
  const nn = normSpaces(needle);
  const forms: string[] = [];
  let idx = nh.indexOf(nn);
  while (idx !== -1) {
    forms.push(hay.slice(idx, idx + nn.length));
    idx = nh.indexOf(nn, idx + 1);
  }
  return { count: forms.length, forms };
}

/**
 * Posições em que os parágrafos aparecem CONSECUTIVOS (só espaço em branco
 * entre um e o próximo), tolerando NBSP. Cada ocorrência do primeiro parágrafo
 * é um início candidato. Devolve, por sequência, as formas REAIS dos parágrafos.
 */
function locateBlock(
  hay: string,
  paragraphs: readonly string[]
): Array<{ start: number; end: number; forms: string[] }> {
  const out: Array<{ start: number; end: number; forms: string[] }> = [];
  const nh = normSpaces(hay);
  const nps = paragraphs.map(normSpaces);
  const first = nps[0];
  if (!first) return out;
  let start = nh.indexOf(first);
  while (start !== -1) {
    let cursor = start + first.length;
    const forms = [hay.slice(start, cursor)];
    let ok = true;
    for (let k = 1; k < nps.length; k += 1) {
      const at = nh.indexOf(nps[k]!, cursor);
      if (at === -1 || !/^\s*$/.test(nh.slice(cursor, at))) {
        ok = false;
        break;
      }
      forms.push(hay.slice(at, at + nps[k]!.length));
      cursor = at + nps[k]!.length;
    }
    if (ok) out.push({ start, end: cursor, forms });
    start = nh.indexOf(first, start + 1);
  }
  return out;
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
1. Responda APENAS o JSON, e nada mais: { "mapeamentos": [ { "trecho_literal": "...", "token": "..." } ] } — sem cerca de código, sem comentário, nota ou explicação antes ou depois. Qualquer texto fora do JSON é descartado.
2. trecho_literal deve ser CÓPIA EXATA, caractere a caractere, de um trecho do documento — e deve ser ÚNICO no documento. Se o valor aparece mais de uma vez (ex. um nome repetido), inclua contexto ao redor até o trecho ficar único; nesse caso o trecho inteiro será substituído pelo token, então só faça isso quando o contexto INTEIRO corresponder ao conteúdo do token.
3. Use SOMENTE tokens do catálogo. Não invente.
4. Tokens [composed] cobrem blocos inteiros (ex.: a qualificação completa das partes no preâmbulo, a cláusula de garantia inteira, o bloco de assinaturas) — mapeie o bloco INTEIRO de texto correspondente. Blocos multi-parágrafo são aceitos (preserve as quebras de linha do documento no trecho_literal).
5. Pra tokens de qualificação de partes (locadores/locatários, vendedores/compradores), o trecho_literal deve cobrir APENAS a qualificação em si (do nome ao último dado), SEM os rótulos fixos ao redor ("como LOCADORA e doravante nomeada PARTE LOCADORA,"). Se os dois lados usam o MESMO texto de exemplo, mapeie ambos mesmo assim — o sistema substitui o que for unívoco e deixa o ambíguo pra revisão humana.
6. NÃO mapeie texto fixo do contrato (cláusulas padrão que não variam por negócio).
7. Se não encontrar correspondência pra um token, simplesmente não o inclua.
8. O documento pode já conter placeholders no formato {{alguma_coisa}} — eles já estão prontos. NUNCA inclua no trecho_literal um texto que contenha {{...}}, nem pra "corrigir" o nome do token. Trate essas linhas como intocáveis.
9. Tokens de DADO — qualificações (*_qualificacao) e dados de pagamento (*_dados_pagamento) — cobrem APENAS o dado em si: da razão social/nome até o último dado da qualificação; ou só a chave PIX / banco, agência e conta. NUNCA inclua neles rótulos fixos ("a ser pago diretamente à imobiliária intermediadora"), valores em R$, nem o trecho que pertence a outro token. Dois tokens vizinhos no mesmo parágrafo NUNCA se sobrepõem: se a qualificação e a conta estão na mesma frase, são DOIS mapeamentos, um para cada token, cada um só com a sua parte. Um trecho que engole o de outro token é recusado.

10. LISTA de rateio de valor entre beneficiários — um parágrafo por item, cada um com valor em R$ e o nome de quem recebe ("a) R$ … à imobiliária intermediadora …; b) R$ … ao(à) corretor(a) …") — é UM único mapeamento para \`rateio_primeiro_aluguel\`, cobrindo do PRIMEIRO item ao ÚLTIMO. NÃO mapeie item por item, e NÃO use \`corretagem_*\` nem \`imobiliaria_*\` dentro de um item: cada uma dessas chaves imprime a lista inteira de beneficiários, então com dois itens o bloco se repete nos dois. O cabeçalho que introduz a lista ("O pagamento correspondente ao primeiro aluguel será rateado da seguinte forma:") é texto fixo e fica FORA do trecho.

DOCUMENTO:
${docText.slice(0, MAX_PROMPT_CHARS)}`;
}

type Mapeamento = { trecho_literal?: string; token?: string };

/**
 * Primeiro objeto JSON completo a partir de `start`, respeitando strings e
 * escapes — `}` dentro de `"trecho_literal"` não fecha nada. Devolve o texto
 * do objeto ou null se as chaves não fecharem.
 */
function balancedObject(text: string, start: number): string | null {
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (ch === "\\") i++;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

/**
 * Lê `{ "mapeamentos": [...] }` de uma resposta que pode vir em cerca de
 * código e/ou cercada de prosa (antes OU depois, inclusive citando
 * `{{tokens}}`). Tenta, nesta ordem: o objeto que contém a chave
 * "mapeamentos"; o conteúdo do primeiro bloco cercado; cada `{` do texto como
 * início de objeto balanceado. `ok: false` = nenhum candidato parseou com
 * `mapeamentos` array — o chamador marca `responseUnparsed` em vez de fingir
 * que a IA não propôs nada. Exportada só para teste.
 */
export function extractMapeamentos(raw: string): { ok: boolean; mapeamentos: Mapeamento[] } {
  const candidates: string[] = [];
  // 1) O objeto que CONTÉM a chave "mapeamentos" — é o alvo, esteja onde
  //    estiver: prosa com {{tokens}} antes dele não o esconde.
  const keyIdx = raw.indexOf('"mapeamentos"');
  if (keyIdx !== -1) {
    const objStart = raw.lastIndexOf("{", keyIdx);
    const obj = objStart !== -1 ? balancedObject(raw, objStart) : null;
    if (obj) candidates.push(obj);
  }
  // 2) Conteúdo do primeiro bloco cercado (```json … ```), com qualquer caixa.
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) candidates.push(fenced[1]);
  // 3) Cada `{` do texto como início de objeto balanceado — pulando os
  //    `{{token}}` de prosa inteiros (o `{` interno também não é candidato)
  //    e parando cedo: depois de alguns objetos completos, o resto é prosa.
  for (let i = raw.indexOf("{"); i !== -1 && candidates.length < 6; i = raw.indexOf("{", i + 1)) {
    if (raw[i + 1] === "{") {
      const close = raw.indexOf("}}", i);
      i = close === -1 ? raw.length : close + 1;
      continue;
    }
    const obj = balancedObject(raw, i);
    if (obj) candidates.push(obj);
  }
  for (const text of candidates) {
    try {
      const parsed = JSON.parse(text) as { mapeamentos?: unknown };
      if (Array.isArray(parsed.mapeamentos)) return { ok: true, mapeamentos: parsed.mapeamentos as Mapeamento[] };
    } catch {
      // próximo candidato
    }
  }
  return { ok: false, mapeamentos: [] };
}

// `DATA_KEYS` mora no catálogo (módulo puro): as checagens semânticas e a
// tela precisam do conjunto sem puxar o cliente da Anthropic para o bundle.
// Re-exportado aqui porque este é o módulo que o define em uso.
export { DATA_KEYS };

/**
 * O que a IA propôs, antes de qualquer trava determinística.
 *
 * `raw` fica guardado de propósito: a bateria de avaliação reprocessa o
 * planejador contra respostas já pagas (`--replay`), e sem o texto cru cada
 * ajuste no planejador custaria uma rodada nova do modelo.
 */
export interface ProposalResult {
  mapeamentos: Mapeamento[];
  raw: string;
  /** O documento passou de `MAX_PROMPT_CHARS`: a IA nunca viu a cauda. */
  docTruncated: boolean;
  /** A resposta estourou `max_tokens` (`stop_reason`). */
  responseTruncated: boolean;
  /** A resposta chegou inteira e não pôde ser lida como JSON. */
  responseUnparsed: boolean;
  /**
   * Tokens da chamada. Devolvidos SEMPRE, inclusive quando o custo não foi
   * gravado em `AIUsage` (ver `orgId: null`) — chamada de modelo sem conta em
   * lugar nenhum é o que esta sessão está aqui para não repetir.
   */
  usage: { promptTokens: number; completionTokens: number; latencyMs: number };
}

/**
 * Candidato a inserção: passou nas travas do texto plano e gerou requests.
 * Vira `inserted` só depois que a reply e a releitura confirmarem.
 */
export interface Candidate {
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

/**
 * Bloco composto que entra pelo caminho ESTRUTURAL (apagar o intervalo e
 * inserir a chave), não por `replaceAllText`.
 *
 * O caminho de texto troca o 1º parágrafo pela chave e esvazia os demais, um a
 * um, cada um sob `count === 1`. Bloco cujos parágrafos se repetem no documento
 * não passa nele: no bloco de assinaturas a linha de sublinhados aparece uma
 * vez por signatário e "PARTE LOCATÁRIA" aparece dezenas de vezes — em 16 de 16
 * modelos da Trio a chave `assinaturas` saía como `ambiguous` e o bloco ficava
 * literal, com os nomes das partes do contrato-fonte. O que identifica esse
 * bloco é a SEQUÊNCIA consecutiva, e é ela que se exige única.
 */
export interface PlannedBlock {
  token: string;
  trecho: string;
  /** Parágrafos na forma REAL do documento, na ordem em que aparecem. */
  paragraphs: string[];
}

/**
 * O que seria enviado ao Google — decidido inteiro no texto plano, sem tocar
 * no Doc. É o artefato que a bateria de avaliação pontua: com ele dá para
 * medir precisão e recall do passe sem gastar uma escrita no Drive.
 */
export interface InsertionPlan {
  requests: docs_v1.Schema$Request[];
  candidates: Candidate[];
  /** Blocos que entram pelo caminho estrutural, depois do lote de texto. */
  blocks: PlannedBlock[];
  skippedAmbiguous: SkippedToken[];
  /** O texto como ficaria se o lote entrasse inteiro — a base da unicidade. */
  simulatedText: string;
  /**
   * Impressão do texto contra o qual este plano foi montado. Existe para
   * `commitInsertion` recusar um plano de OUTRO documento: as duas entradas
   * chegam separadas, e a combinação errada escreveria no Doc trechos casados
   * contra texto que não é o dele. Em produção quem monta as duas é a
   * composição, então não há como divergirem — a trava é contra o chamador
   * futuro, não contra o de hoje.
   */
  docTextFingerprint: string;
}

/** O plano recebido não foi montado contra o texto que se vai escrever. */
export class PlanTextMismatchError extends Error {
  constructor() {
    super(
      "O plano de inserção foi montado contra outro texto do documento. " +
        "Refaça o planejamento sobre o texto atual antes de aplicar."
    );
    this.name = "PlanTextMismatchError";
  }
}

/** Sinais da proposta que o relatório final precisa reportar. */
export interface ProposalFlags {
  docTruncated: boolean;
  responseTruncated: boolean;
  responseUnparsed: boolean;
}

/**
 * ETAPA 1 — pergunta à IA. Único ponto que fala com a Anthropic e o único que
 * custa dinheiro; não toca no Google Docs, para a avaliação poder rodar sobre
 * um corpus de texto sem Doc nenhum.
 */
export async function proposeMapeamentos(input: {
  docText: string;
  modalidade: string;
  /**
   * Org que paga a chamada. `null` = fora de qualquer org (bateria de
   * avaliação): a linha de `AIUsage` é PULADA em vez de escrita com um id
   * inventado — o FK recusa, e um custo de bench dentro da métrica de um
   * tenant seria pior que não gravar. Quem passa `null` recebe `usage` e presta
   * a conta por fora (ver `scripts/ai-bench/placeholders/run.ts`).
   */
  orgId: string | null;
}): Promise<ProposalResult> {
  const docTruncated = input.docText.length > MAX_PROMPT_CHARS;

  const anthropic = getAnthropicClient();
  const t0 = Date.now();
  let raw = "";
  let responseTruncated = false;
  let usage = { promptTokens: 0, completionTokens: 0, latencyMs: 0 };
  try {
    const response = await anthropic.messages.create({
      model: SONNET_MODEL,
      max_tokens: MAX_OUTPUT_TOKENS,
      temperature: 0,
      messages: [{ role: "user", content: buildPrompt(input.modalidade, input.docText) }],
    });
    usage = {
      promptTokens: response.usage?.input_tokens ?? 0,
      completionTokens: response.usage?.output_tokens ?? 0,
      latencyMs: Date.now() - t0,
    };
    // `!== null`, não truthiness: `orgId: ""` (um `algo ?? ""` num chamador
    // futuro) pularia a linha de custo EM SILÊNCIO. Com a comparação estrita,
    // string vazia entra no caminho de gravação e o FK falha alto.
    if (input.orgId !== null) {
      recordAIUsage({
        orgId: input.orgId,
        userId: null,
        contractId: null,
        provider: "anthropic",
        model: SONNET_MODEL,
        operation: "template_placeholder_insertion",
        promptTokens: usage.promptTokens,
        completionTokens: usage.completionTokens,
        latencyMs: usage.latencyMs,
        success: true,
      });
    }
    const block = response.content.find((b) => b.type === "text");
    raw = block && block.type === "text" ? block.text : "";
    // Resposta cortada no meio do JSON caía no catch mudo do parse e o passe
    // seguia com lista VAZIA — foi assim que um modelo saiu com zero chaves.
    responseTruncated = response.stop_reason === "max_tokens";
  } catch (err) {
    // `!== null`, não truthiness: `orgId: ""` (um `algo ?? ""` num chamador
    // futuro) pularia a linha de custo EM SILÊNCIO. Com a comparação estrita,
    // string vazia entra no caminho de gravação e o FK falha alto.
    if (input.orgId !== null) {
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
    }
    throw err;
  }

  // Extração por balanceamento, não por regex gananciosa: num Doc já cheio de
  // `{{tokens}}` o Sonnet responde o JSON em cerca de código e emenda uma
  // "Nota de revisão" citando `{{placeholders}}` — o `/\{[\s\S]*\}/` de antes
  // ia até o último `}` da nota, o parse quebrava e o passe seguia MUDO com
  // lista vazia (medido em produção em 02/09/2026, "Confirmou 0 trecho" nos
  // 16 rascunhos da Trio). Falha de parse agora é sinal, nunca silêncio.
  const extracted = extractMapeamentos(raw);
  return {
    mapeamentos: extracted.mapeamentos,
    raw,
    usage,
    docTruncated,
    // Resposta cortada por `max_tokens` também não parseia — a causa mais
    // específica vence, senão a tela mostraria dois banners para um problema.
    responseTruncated,
    responseUnparsed: !extracted.ok && !responseTruncated,
  };
}

/**
 * ETAPA 2 — decide o que entra, contra o texto plano. PURA: mesma entrada,
 * mesmo plano, sem rede. Toda a segurança do replace global mora aqui, e é por
 * isso que ela pode ser testada e pontuada sem modelo e sem Drive.
 */
export function planInsertion(input: {
  docText: string;
  modalidade: string;
  mapeamentos: Mapeamento[];
}): InsertionPlan {
  const { docText, modalidade, mapeamentos } = input;
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
    catalogForModalidade(modalidade)
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
  const propostas = mapeamentos
    .map((m) => ({ trecho: (m.trecho_literal ?? "").trim(), token: (m.token ?? "").trim() }))
    .filter((m) => m.trecho && m.token);

  // Valor e extenso na mesma proposta: "R$ 3.000,00 (três mil reais)" proposto
  // para `aluguel_valor` com "três mil reais" proposto para `aluguel_valor_extenso`.
  // Longest-first faria o valor engolir o extenso, e o contrato sairia sem o
  // extenso — em silêncio, porque `{{aluguel_valor}}` imprime só o número.
  // Medido em 3 de 16 modelos da Trio. O par é inequívoco (o token irmão é
  // `<token>_extenso` e o trecho termina em `(<extenso>)`), então o conserto é
  // aparar o valor até antes do parêntese; os dois entram.
  for (const m of propostas) {
    const irmao = propostas.find(
      (o) => o.token === `${m.token}_extenso` && m.trecho.endsWith(`(${o.trecho})`)
    );
    if (!irmao) continue;
    const cabeca = m.trecho.slice(0, m.trecho.length - irmao.trecho.length - 2).trim();
    if (cabeca) m.trecho = cabeca;
  }

  // Longest-first, como o reverse-merge: com o texto simulado, quem entra
  // primeiro consome o que está contido nele. Se a ordem fosse a da IA, um
  // trecho curto proposto antes derrubaria o bloco longo que o contém como
  // "overlapped" — por acidente de array, não por sobreposição real.
  const ordenados = propostas.sort((a, b) => b.trecho.length - a.trecho.length);
  const blocks: PlannedBlock[] = [];

  for (const { trecho, token } of ordenados) {
    // Trava determinística (ver HAS_PLACEHOLDER). A regra também está no
    // prompt, mas prompt é pedido — isto é garantia. Checar o trecho INTEIRO
    // cobre de quebra os parágrafos que seriam esvaziados num bloco
    // multi-parágrafo.
    if (HAS_PLACEHOLDER.test(trecho)) {
      skippedAmbiguous.push({ token, trecho, reason: "already-tokenized" });
      continue;
    }
    if (!isKnownToken(token, modalidade)) {
      skippedAmbiguous.push({ token, trecho, reason: "unknown-token" });
      continue;
    }
    // Chave de DADO que engole a proposta de outra chave: recusada ANTES de
    // consumir o texto simulado — assim a vizinha (menor, vem depois na ordem
    // longest-first) entra normalmente, em vez de sair como `overlapped` ao
    // lado de um bloco que levou o parágrafo inteiro. A regra 9 do prompt pede
    // isto; a trava garante. Só conta como vizinha uma proposta de bloco
    // COMPOSTO ainda não aplicado nesta passada: o caso real é sempre
    // composto contra composto (qualificação × conta), e uma segunda proposta
    // de bloco já visto — ou um token simples curto que por acaso aparece
    // dentro da qualificação — não pode derrubar uma chave válida.
    if (DATA_KEYS.has(token)) {
      const neighbor = ordenados.find(
        (o) =>
          o.token !== token &&
          o.trecho.length < trecho.length &&
          composedTokens.has(o.token) &&
          !seenComposed.has(o.token) &&
          !HAS_PLACEHOLDER.test(o.trecho) &&
          trecho.includes(o.trecho)
      );
      if (neighbor) {
        skippedAmbiguous.push({ token, trecho, reason: "engulfs-neighbor", neighbor: neighbor.token });
        continue;
      }
    }
    // Chave SIMPLES cujo trecho contém as propostas de DUAS OU MAIS outras
    // chaves simples é frase, não valor: "30 (trinta) meses, a contar de 1º de
    // março de 2025 e com término em 28 de fevereiro de 2028" proposto para
    // `vigencia_meses`, com as duas datas propostas para `vigencia_inicio` e
    // `vigencia_fim`. Aplicar apagaria a frase inteira e deixaria "30 (trinta)"
    // no lugar. Recusar o de fora deixa as duas datas entrarem. Com UMA só
    // vizinha contida a regra não decide (uma descrição de imóvel pode conter
    // legitimamente a matrícula), e vale o longest-first de sempre.
    if (!composedTokens.has(token)) {
      const contidas = new Set(
        ordenados
          .filter(
            (o) =>
              o.token !== token &&
              o.trecho.length < trecho.length &&
              !composedTokens.has(o.token) &&
              trecho.includes(o.trecho)
          )
          .map((o) => o.token)
      );
      if (contidas.size >= 2) {
        skippedAmbiguous.push({
          token,
          trecho,
          reason: "engulfs-neighbor",
          neighbor: [...contidas][0]!,
        });
        continue;
      }
    }
    // Segunda proposta de bloco composto é descartada SEM entrar no relatório,
    // de propósito: não é falha a corrigir, é o passe recusando duplicar um
    // bloco — o primeiro (o maior, pela ordem acima) já está no documento.
    if (composedTokens.has(token) && seenComposed.has(token)) continue;

    // replaceAllText do Docs NÃO atravessa quebras de parágrafo — trechos
    // multi-parágrafo (clausula_garantia, assinaturas) são tratados parágrafo
    // a parágrafo: o 1º vira {{token}} e os demais são esvaziados, cada um
    // sob a mesma regra de unicidade (count===1). Parágrafo ambíguo no meio
    // (ex. linhas de assinatura repetidas) iria para o relatório como leftover
    // — a menos que o bloco inteiro seja único como SEQUÊNCIA, e aí ele entra
    // pelo caminho estrutural (ver PlannedBlock).
    const paragraphs = trecho
      .split(/\n+/)
      .map((p) => p.trim())
      .filter((p) => p.length > 0);
    const first = paragraphs[0] ?? trecho;

    const firstHit = locate(sim, first);

    if (paragraphs.length > 1 && composedTokens.has(token)) {
      const textoLimpo =
        firstHit.count === 1 && paragraphs.slice(1).every((p) => locate(sim, p).count === 1);
      if (!textoLimpo) {
        const sequencias = locateBlock(sim, paragraphs);
        if (sequencias.length === 1) {
          const seq = sequencias[0]!;
          blocks.push({ token, trecho, paragraphs: seq.forms });
          sim = `${sim.slice(0, seq.start)}{{${token}}}${sim.slice(seq.end)}`;
          seenComposed.add(token);
          continue;
        }
      }
    }

    if (firstHit.count === 0) {
      // Existia no original? Então outra substituição desta passada o levou.
      const reason: SkipReason = locate(docText, first).count > 0 ? "overlapped" : "not-found";
      skippedAmbiguous.push({ token, trecho, reason });
      continue;
    }
    if (firstHit.count > 1) {
      skippedAmbiguous.push({ token, trecho, reason: "ambiguous" });
      continue;
    }
    // Daqui em diante, a forma REAL do documento (NBSP incluso) é o que vai
    // para o Docs e o que sai do simulado.
    const firstForm = firstHit.forms[0]!;

    const candidate: Candidate = {
      token,
      trecho,
      first: firstForm,
      requestIdx: requests.length,
      rest: [],
      leftover: [],
    };
    requests.push({
      replaceAllText: {
        containsText: { text: firstForm, matchCase: true },
        replaceText: `{{${token}}}`,
      },
    });
    applySim(firstForm, `{{${token}}}`);
    for (const par of paragraphs.slice(1)) {
      const hit = locate(sim, par);
      if (hit.count === 1) {
        const form = hit.forms[0]!;
        candidate.rest.push({ idx: requests.length, par: form });
        requests.push({
          replaceAllText: {
            containsText: { text: form, matchCase: true },
            replaceText: "",
          },
        });
        applySim(form, "");
      } else {
        candidate.leftover.push(par);
      }
    }
    if (composedTokens.has(token)) seenComposed.add(token);
    candidates.push(candidate);
  }

  return {
    requests,
    candidates,
    blocks,
    skippedAmbiguous,
    simulatedText: sim,
    docTextFingerprint: textFingerprint(docText),
  };
}

/**
 * ETAPA 3 — escreve no Doc e CONFERE. É a única que muda o documento, e a
 * única que pode transformar candidato em `inserted`: "a API aceitou" não é
 * "está no texto", e "não sei" (Drive fora na releitura) nunca vira "deu certo".
 */
export async function commitInsertion(input: {
  docId: string;
  docText: string;
  modalidade: string;
  plan: InsertionPlan;
  flags: ProposalFlags;
}): Promise<InsertionReport> {
  const { docId, docText, modalidade, plan, flags } = input;
  // ANTES de qualquer escrita: plano e texto têm que ser do mesmo documento.
  if (plan.docTextFingerprint !== textFingerprint(docText)) {
    throw new PlanTextMismatchError();
  }
  const { requests, candidates } = plan;
  // Cópia: o relatório acrescenta os skips pós-batch, e o plano recebido é do
  // chamador (a avaliação pontua o mesmo plano depois de commitar).
  const skippedAmbiguous: SkippedToken[] = [...plan.skippedAmbiguous];

  const inserted: InsertedToken[] = [];
  const skip = (c: Candidate, reason: SkipReason, paragraph?: string) =>
    skippedAmbiguous.push({
      token: c.token,
      trecho: c.trecho,
      reason,
      ...(paragraph ? { paragraph } : {}),
    });
  // As travas do texto plano (no plano) empurram direto em skippedAmbiguous com
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
      const res = await batchUpdateDoc(docId, requests);
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
        reread = await getDocPlainText(docId);
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

  // Blocos pelo caminho ESTRUTURAL, depois do lote de texto: `applyDocEdits`
  // relê o documento, localiza a sequência (única) e apaga/insere por índice,
  // relendo a estrutura antes de cada bloco. Ele já confere o resultado —
  // `applied` aqui é releitura confirmada, o mesmo padrão dos candidatos.
  if (plan.blocks.length > 0) {
    let outcome: Awaited<ReturnType<typeof applyDocEdits>> | null = null;
    try {
      outcome = await applyDocEdits({
        docId,
        modalidade,
        ops: plan.blocks.map((b) => ({
          op: "replace-block" as const,
          paragraphs: b.paragraphs,
          token: b.token,
        })),
      });
    } catch (err) {
      console.error("[ai-placeholder-insertion] blocos estruturais falharam:", err);
    }
    plan.blocks.forEach((b, i) => {
      const r = outcome?.results[i];
      if (r?.status === "applied") {
        inserted.push({ token: b.token, trecho: b.trecho, structural: true });
        return;
      }
      skippedAmbiguous.push({
        token: b.token,
        trecho: b.trecho,
        reason: skipReasonFromDocEdit(r?.reason),
      });
    });
    if (outcome?.finalText) finalText = outcome.finalText;
  }

  return buildInsertionReport({
    modalidade,
    finalText,
    inserted,
    skippedAmbiguous,
    unconfirmed,
    flags,
  });
}

/** Motivo do `doc-edit` no vocabulário do passe; "não sei" nunca vira "deu certo". */
function skipReasonFromDocEdit(reason: DocEditReason | undefined): SkipReason {
  switch (reason) {
    case "not-found":
    case "ambiguous":
    case "unknown-token":
    case "batch-failed":
    case "replace-noop":
    case "over-matched":
    case "verify-failed":
    case "verify-unavailable":
    case "block-not-consecutive":
    case "structure-not-found":
      return reason;
    default:
      return "verify-unavailable";
  }
}

/**
 * Monta o relatório a partir do estado pós-passe. Separado de
 * {@link commitInsertion} porque é PURO: a avaliação monta o mesmo relatório
 * sobre um passe simulado, sem Doc.
 */
export function buildInsertionReport(input: {
  modalidade: string;
  /** Texto do Doc DEPOIS do passe (ou o de antes, se a releitura falhou). */
  finalText: string;
  inserted: InsertedToken[];
  skippedAmbiguous: SkippedToken[];
  unconfirmed: ReadonlySet<string>;
  flags: ProposalFlags;
}): InsertionReport {
  const { modalidade, finalText, inserted, skippedAmbiguous, unconfirmed, flags } = input;

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
  const catalogTokens = catalogForModalidade(modalidade).map((d) => d.token);
  const missingRequired = requiredTokens(modalidade).filter((t) => !present.has(t));

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
  const semProposta: UnmappedReason = flags.docTruncated
    ? "doc-truncated"
    : flags.responseTruncated
      ? "response-truncated"
      : flags.responseUnparsed
        ? "response-unparsed"
        : "no-mapping";
  const notMapped: UnmappedToken[] = catalogTokens
    .filter((t) => !present.has(t))
    .map((token) => {
      const s = lastSkip.get(token);
      return s
        ? { token, reason: s.reason, trecho: s.trecho, ...(s.neighbor ? { neighbor: s.neighbor } : {}) }
        : { token, reason: semProposta };
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
    docTruncated: flags.docTruncated,
    responseTruncated: flags.responseTruncated,
    responseUnparsed: flags.responseUnparsed,
    unconfirmed: Array.from(unconfirmed).filter((t) => !confirmed.has(t)).sort(),
  };
}

/**
 * O passe completo: propor → planejar → aplicar. Saída idêntica à de antes da
 * separação — as três etapas existem para poderem ser exercidas isoladamente
 * (bateria de avaliação, e o "propor sem aplicar" da revisão por IA).
 */
export async function insertPlaceholdersWithAI(input: {
  docId: string;
  modalidade: string;
  orgId: string;
}): Promise<InsertionReport> {
  const docText = await getDocPlainText(input.docId);
  const proposal = await proposeMapeamentos({
    docText,
    modalidade: input.modalidade,
    orgId: input.orgId,
  });
  const plan = planInsertion({
    docText,
    modalidade: input.modalidade,
    mapeamentos: proposal.mapeamentos,
  });
  return commitInsertion({
    docId: input.docId,
    docText,
    modalidade: input.modalidade,
    plan,
    flags: {
      docTruncated: proposal.docTruncated,
      responseTruncated: proposal.responseTruncated,
      responseUnparsed: proposal.responseUnparsed,
    },
  });
}
