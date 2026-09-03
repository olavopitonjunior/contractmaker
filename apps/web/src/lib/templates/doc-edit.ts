/**
 * Edições CIRÚRGICAS no Doc-modelo, feitas de dentro do app.
 *
 * Por que existe: em 03/09/2026 os 16 modelos da RE/MAX Trio precisaram de
 * quatro tipos de conserto — trocar a chave da parte errada, apagar o CRECI que
 * ficou ao lado da chave, devolver a cláusula que uma chave engoliu e refazer
 * um item de lista. Nada disso tinha caminho no app: a única edição possível
 * era "trecho literal → chave" (`map-field`), e o resto foi feito à mão no
 * Google Docs, por um desenvolvedor, Doc a Doc. As checagens semânticas
 * (`semantic-checks.ts`) já dizem O QUE está errado e propõem o conserto; aqui
 * é onde o conserto acontece.
 *
 * A SEGURANÇA é a mesma do passe de IA, e por um motivo que não é opinião:
 * `replaceAllText` do Docs troca TODAS as ocorrências do trecho. Nada é enviado
 * sem `countOccurrences === 1` contra o texto SIMULADO (que acumula as trocas
 * já aceitas nesta chamada), e nada é declarado aplicado antes da releitura —
 * "a API aceitou" não é "está no texto", e "não sei" nunca vira "deu certo".
 *
 * `restore-paragraph` é ESTRUTURAL por necessidade: `replaceAllText` não cria
 * parágrafo (o `\n` no texto de troca não é documentado como quebra), então
 * devolver um trecho de várias linhas exige apagar o intervalo e inserir texto
 * novo, com a estrutura RELIDA antes de cada restauração — os índices absolutos
 * mudam a cada edição, e reaproveitá-los apagaria o intervalo errado.
 *
 * ORDEM: estrutural PRIMEIRO, texto depois. Restaurar antes deixa o texto
 * devolvido disponível para uma edição de texto na mesma chamada ("devolve a
 * cláusula e chaveia um campo dentro dela"), e `replaceAllText` não usa
 * índices, então o batch de texto não se importa com a estrutura ter mudado. O
 * planejamento segue a mesma ordem, de propósito: se o texto simulado descrever
 * um estado que a execução não produz, uma edição legítima falha como
 * `replace-noop` sem que ninguém entenda por quê.
 */
import type { docs_v1 } from "googleapis";
import { batchUpdateDoc, getDocPlainText, getDocStructure } from "@/lib/google/docs";
import { findBlockRange, findParagraphRange } from "@/lib/google/doc-index";
import { countOccurrences } from "@/lib/templates/apply-clause-slot";
import { isKnownToken } from "@/lib/templates/placeholder-catalog";

export type DocEditOp =
  /** Trecho literal → `{{token}}` (o que a tela já fazia via `map-field`). */
  | { op: "map-field"; phrase: string; token: string }
  /** A chave está errada para o que a frase diz: troca de chave, mantendo o resto. */
  | { op: "rekey"; phrase: string; fromToken: string; toToken: string }
  /** Sobra do titular ao lado da chave (CRECI, CPF, conta): remove o trecho. */
  | { op: "remove-leftover"; phrase: string; replacement?: string }
  /** A chave engoliu a cláusula: devolve o texto do contrato-fonte. */
  | { op: "restore-paragraph"; current: string; source: string }
  /**
   * Um BLOCO de parágrafos — que pode já conter chaves — vira UMA chave
   * composta.
   *
   * É a operação que faltava, e a falta tinha custo: os 16 modelos da Trio
   * tiveram a lista de rateio do 1º aluguel chaveada item a item
   * (`{{corretagem_qualificacao}}` num item, `{{corretagem_dados_pagamento}}`
   * noutro), e cada uma dessas chaves imprime a lista INTEIRA de beneficiários —
   * um item sai com nome sem conta, o outro com conta sem nome. A chave certa
   * (`rateio_primeiro_aluguel`) passou a existir, e NADA conseguia aplicá-la:
   * `map-field` recusa trecho que já tem chave (trava correta, para não apagar
   * campo por acidente) e o passe de IA recusa trecho já tokenizado pelo mesmo
   * motivo. A migração ficava sem caminho.
   */
  | { op: "replace-block"; paragraphs: string[]; token: string };

export type DocEditReason =
  // Decididos no texto plano, antes de qualquer escrita.
  | "not-found"
  | "ambiguous"
  | "unknown-token"
  | "same-token"
  | "token-missing-in-phrase"
  | "phrase-has-token"
  | "empty-source"
  | "empty-block"
  | "block-not-consecutive"
  // Decididos pela resposta da API e pela releitura.
  | "batch-failed"
  | "replace-noop"
  | "over-matched"
  | "structure-not-found"
  | "verify-failed"
  | "verify-unavailable";

export interface DocEditResult {
  op: DocEditOp["op"];
  status: "applied" | "skipped" | "failed";
  reason?: DocEditReason;
  /** Frase/token que identifica a edição na resposta (nunca mascarada aqui). */
  target?: string;
}

export interface ApplyDocEditsResult {
  results: DocEditResult[];
  /** Texto do Doc DEPOIS das edições; `null` quando a releitura falhou. */
  finalText: string | null;
  appliedAt: string;
}

/** Uma edição de texto já planejada contra o texto simulado. */
interface PlannedText {
  index: number;
  op: DocEditOp["op"];
  target: string;
  needle: string;
  replacement: string;
  requestIdx: number;
}

/** Uma edição estrutural: apaga um intervalo e insere texto no lugar. */
interface PlannedStructural {
  index: number;
  op: "restore-paragraph" | "replace-block";
  target: string;
  /** Parágrafos a substituir, na ordem em que aparecem no Doc. */
  paragrafos: string[];
  /** Texto que entra no lugar. */
  texto: string;
}

const HAS_PLACEHOLDER = /\{\{[^{}]+\}\}/;

function tokenRe(token: string): RegExp {
  return new RegExp(`\\{\\{\\s*${token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\}\\}`, "g");
}

export async function applyDocEdits(input: {
  docId: string;
  modalidade: string;
  ops: readonly DocEditOp[];
}): Promise<ApplyDocEditsResult> {
  const { docId, modalidade, ops } = input;
  const results: DocEditResult[] = ops.map((o) => ({
    op: o.op,
    status: "skipped",
    reason: "not-found",
  }));
  const appliedAt = () => new Date().toISOString();

  let docText: string;
  try {
    docText = await getDocPlainText(docId);
  } catch (err) {
    console.error("[doc-edit] não consegui ler o doc:", err);
    for (const r of results) {
      r.status = "failed";
      r.reason = "verify-unavailable";
    }
    return { results, finalText: null, appliedAt: appliedAt() };
  }

  // ── PLANEJAMENTO (puro, contra o texto simulado) ────────────────────────
  const requests: docs_v1.Schema$Request[] = [];
  const planejadas: PlannedText[] = [];
  const estruturais: PlannedStructural[] = [];
  let sim = docText;
  const aplicarSim = (needle: string, replacement: string) => {
    sim = sim.split(needle).join(replacement);
  };
  const recusar = (i: number, reason: DocEditReason, target: string) => {
    results[i] = { op: ops[i].op, status: "skipped", reason, target };
  };

  // PASSO 1 — estruturais. Planejadas ANTES das de texto porque é nessa ordem
  // que são executadas: restaurar primeiro deixa o texto novo disponível para
  // uma edição de texto na mesma chamada ("devolve a cláusula e chaveia um campo
  // dentro dela"), e `replaceAllText` não usa índices, então o batch de texto
  // não se importa com a estrutura ter mudado. Planejar na ordem do array —
  // como estava — fazia o texto simulado descrever um estado que a execução
  // nunca produzia, e uma edição legítima falhava como `replace-noop`.
  ops.forEach((op, i) => {
    if (op.op === "restore-paragraph") {
      const current = op.current.trim();
      const source = op.source.trim();
      if (!source) return recusar(i, "empty-source", current);
      if (countOccurrences(sim, current) === 0) return recusar(i, "not-found", current);
      if (countOccurrences(sim, current) > 1) return recusar(i, "ambiguous", current);
      estruturais.push({
        index: i,
        op: "restore-paragraph",
        target: current,
        paragrafos: [current],
        texto: source,
      });
      aplicarSim(current, source);
      return;
    }

    if (op.op === "replace-block") {
      const paragrafos = op.paragraphs.map((x) => x.trim()).filter(Boolean);
      if (paragrafos.length === 0) return recusar(i, "empty-block", op.token);
      if (!isKnownToken(op.token, modalidade)) return recusar(i, "unknown-token", op.token);
      // Cada parágrafo tem de ser único: o intervalo a apagar é decidido pela
      // estrutura, e um parágrafo repetido tornaria a escolha arbitrária.
      for (const par of paragrafos) {
        const conta = countOccurrences(sim, par);
        if (conta === 0) return recusar(i, "not-found", par);
        if (conta > 1) return recusar(i, "ambiguous", par);
      }
      // Consecutivos no texto: o intervalo vai do primeiro ao último, e o que
      // estiver entre eles seria apagado junto. Conferido de novo na estrutura
      // antes de escrever (`findBlockRange`), mas recusar aqui evita a chamada.
      const juntos = paragrafos.join("\n");
      if (countOccurrences(sim, juntos) !== 1) {
        return recusar(i, "block-not-consecutive", paragrafos[0]!);
      }
      estruturais.push({
        index: i,
        op: "replace-block",
        target: paragrafos[0]!,
        paragrafos,
        texto: `{{${op.token}}}`,
      });
      aplicarSim(juntos, `{{${op.token}}}`);
      return;
    }
  });

  // PASSO 2 — de texto, contra o simulado que JÁ inclui as estruturais.
  ops.forEach((op, i) => {
    if (op.op === "restore-paragraph" || op.op === "replace-block") return;
    const phrase = op.phrase.trim();
    if (!phrase) return recusar(i, "not-found", phrase);

    let replacement: string;
    if (op.op === "map-field") {
      // Frase que já carrega chave não pode ser tokenizada de novo — seria
      // aninhar chave dentro de chave.
      if (HAS_PLACEHOLDER.test(phrase)) return recusar(i, "phrase-has-token", phrase);
      if (!isKnownToken(op.token, modalidade)) return recusar(i, "unknown-token", op.token);
      replacement = `{{${op.token}}}`;
    } else if (op.op === "rekey") {
      if (op.fromToken === op.toToken) return recusar(i, "same-token", op.fromToken);
      if (!isKnownToken(op.toToken, modalidade)) return recusar(i, "unknown-token", op.toToken);
      const re = tokenRe(op.fromToken);
      const ocorrencias = phrase.match(re)?.length ?? 0;
      // Exatamente uma: com duas, não há como saber qual o operador quis.
      if (ocorrencias !== 1) return recusar(i, "token-missing-in-phrase", op.fromToken);
      replacement = phrase.replace(tokenRe(op.fromToken), `{{${op.toToken}}}`);
    } else {
      // remove-leftover: a frase é dado literal, não pode levar chave embora.
      if (HAS_PLACEHOLDER.test(phrase)) return recusar(i, "phrase-has-token", phrase);
      replacement = op.replacement ?? "";
    }

    const conta = countOccurrences(sim, phrase);
    if (conta === 0) return recusar(i, "not-found", phrase);
    if (conta > 1) return recusar(i, "ambiguous", phrase);

    planejadas.push({
      index: i,
      op: op.op,
      target: phrase,
      needle: phrase,
      replacement,
      requestIdx: requests.length,
    });
    requests.push({
      replaceAllText: {
        containsText: { text: phrase, matchCase: true },
        replaceText: replacement,
      },
    });
    aplicarSim(phrase, replacement);
  });

  // ── BATCH ESTRUTURAL (PRIMEIRO, com a estrutura RELIDA a cada uma) ─────
  const estruturaisOk: PlannedStructural[] = [];
  for (const e of estruturais) {
    let doc: docs_v1.Schema$Document;
    try {
      doc = await getDocStructure(docId);
    } catch (err) {
      console.error("[doc-edit] não consegui ler a estrutura:", err);
      results[e.index] = {
        op: e.op,
        status: "failed",
        reason: "verify-unavailable",
        target: e.target,
      };
      continue;
    }
    // Uma edição por batch, relendo a estrutura antes de cada uma: os índices
    // absolutos mudam a cada edição, e reaproveitá-los apagaria o intervalo
    // errado. O bloco tem de estar CONSECUTIVO na estrutura — o intervalo vai
    // do primeiro parágrafo ao último, e o que estiver no meio some junto.
    const range =
      e.paragrafos.length === 1
        ? findParagraphRange(doc, e.paragrafos[0]!)
        : findBlockRange(doc, e.paragrafos);
    if (!range) {
      results[e.index] = {
        op: e.op,
        status: "failed",
        reason: "structure-not-found",
        target: e.target,
      };
      continue;
    }
    try {
      await batchUpdateDoc(docId, [
        { deleteContentRange: { range: { startIndex: range.startIndex, endIndex: range.endIndex } } },
        { insertText: { location: { index: range.startIndex }, text: e.texto } },
      ]);
      estruturaisOk.push(e);
    } catch (err) {
      console.error("[doc-edit] batchUpdate estrutural falhou:", err);
      results[e.index] = {
        op: e.op,
        status: "failed",
        reason: "batch-failed",
        target: e.target,
      };
    }
  }

  // ── BATCH DE TEXTO (depois; `replaceAllText` não usa índices) ───────────
  const pendentes: PlannedText[] = [];
  if (requests.length > 0) {
    let replies: docs_v1.Schema$Response[] | null = null;
    try {
      const res = await batchUpdateDoc(docId, requests);
      replies = res?.data?.replies ?? [];
    } catch (err) {
      console.error("[doc-edit] batchUpdate falhou:", err);
    }
    if (replies === null) {
      // batchUpdate é atômico: nada entrou.
      for (const p of planejadas) {
        results[p.index] = { op: p.op, status: "failed", reason: "batch-failed", target: p.target };
      }
    } else {
      for (const p of planejadas) {
        const reply = replies[p.requestIdx];
        // Reply ausente não decide nada — fica para a releitura.
        const changed =
          reply === undefined ? null : Number(reply.replaceAllText?.occurrencesChanged ?? 0);
        if (changed === 0) {
          results[p.index] = { op: p.op, status: "failed", reason: "replace-noop", target: p.target };
        } else if (changed !== null && changed > 1) {
          // Casou onde a trava de unicidade não olhou (cabeçalho/rodapé não
          // entram no texto plano). Editar ali é tão ruim quanto não editar.
          results[p.index] = { op: p.op, status: "failed", reason: "over-matched", target: p.target };
        } else {
          pendentes.push(p);
        }
      }
    }
  }

  // ── VERIFICAÇÃO (o documento decide) ────────────────────────────────────
  let finalText: string | null = null;
  try {
    finalText = await getDocPlainText(docId);
  } catch (err) {
    console.error("[doc-edit] releitura falhou:", err);
  }
  if (finalText === null) {
    for (const p of pendentes) {
      results[p.index] = {
        op: p.op,
        status: "failed",
        reason: "verify-unavailable",
        target: p.target,
      };
    }
    for (const e of estruturaisOk) {
      results[e.index] = {
        op: "restore-paragraph",
        status: "failed",
        reason: "verify-unavailable",
        target: e.target,
      };
    }
    return { results, finalText, appliedAt: appliedAt() };
  }

  for (const p of pendentes) {
    const foiEmbora = countOccurrences(finalText, p.needle) === 0;
    // Substituição por "" não deixa nada para procurar; o que se confere é a
    // ausência do trecho.
    const chegou = p.replacement === "" || finalText.includes(p.replacement);
    results[p.index] =
      foiEmbora && chegou
        ? { op: p.op, status: "applied", target: p.target }
        : { op: p.op, status: "failed", reason: "verify-failed", target: p.target };
  }
  // As de texto podem ter ALTERADO o que a restauração devolveu (é para isso
  // que a ordem é estrutural→texto). Então o que se procura no documento não é
  // o texto-fonte literal: é ele com as substituições que de fato entraram —
  // senão uma edição bem-sucedida faria a restauração parecer ter falhado.
  const aplicadasDeTexto = pendentes.filter((p) => results[p.index]?.status === "applied");
  for (const e of estruturaisOk) {
    const esperado = aplicadasDeTexto.reduce(
      (acc, p) => acc.split(p.needle).join(p.replacement),
      e.texto
    );
    const primeiraLinha = esperado.split("\n")[0]!.trim();
    const entrou = primeiraLinha.length === 0 || finalText.includes(primeiraLinha);
    // TODOS os parágrafos do bloco têm de ter saído — um sobrevivente significa
    // que o intervalo apagado não era o que se pensava.
    const sumiu = e.paragrafos.every((par) => countOccurrences(finalText, par) === 0);
    results[e.index] =
      entrou && sumiu
        ? { op: e.op, status: "applied", target: e.target }
        : { op: e.op, status: "failed", reason: "verify-failed", target: e.target };
  }

  return { results, finalText, appliedAt: appliedAt() };
}
