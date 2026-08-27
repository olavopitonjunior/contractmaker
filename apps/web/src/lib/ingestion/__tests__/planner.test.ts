import { describe, it, expect, vi, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  MAX_DIGEST_CELL_CHARS,
  MAX_INDEXED_BLOCKS,
  MIN_PLAN_CONFIDENCE,
  PLAN_LADDER_STEPS,
  analyzeBatch,
  buildBatchDigest,
  materializePlan,
  planLibrary,
  planMaxTokens,
  type BatchAnalysis,
  type PlanLibraryInput,
  type PlanLibraryOptions,
  type PlanLibraryResult,
  type PlannerItem,
} from "@/lib/ingestion/planner";
import {
  deterministicItemClassifier,
  summarizePii,
  type ItemPiiReport,
} from "@/lib/ingestion/classifier";
import { detectPii, type ExternalEntity } from "@/lib/ingestion/pii";
import { buildGroupingReport } from "@/lib/ingestion/grouping";
import { IngestionAiMeter, IngestionCostCapError } from "@/lib/ingestion/ai-budget";
import { INGEST_ESCALATION_MODEL, INGEST_PLAN_MODEL } from "@/lib/ai/shared/models";
import type {
  StructuredCallInput,
  StructuredCallResult,
} from "@/lib/ai/shared/anthropic-structured";
import type { UploadClassification } from "@/lib/knowledge/upload-classifier";

const CORPUS = join(
  __dirname,
  "..",
  "..",
  "templates",
  "__tests__",
  "fixtures",
  "ativa-residencial"
);
const read = (f: string) => readFileSync(join(CORPUS, f), "utf8");

const UPLOAD: UploadClassification = {
  kind: "template",
  confidence: 0.93,
  reason: "Estrutura de contrato completo.",
};

/**
 * As quatro minutas de seguro-fiança da imobiliária. O corpus versionado tem só
 * a da Porto Seguro; as outras três são a MESMA minuta com o garantidor
 * trocado — que é exatamente o caso real que a regra 2 descreve ("só o
 * fornecedor muda").
 */
function withProvider(text: string, provider: string): string {
  return text
    .replace(/PORTO SEGURO CIA\. DE SEGUROS GERAIS/g, `${provider.toUpperCase()} S.A.`)
    .replace(/PORTO SEGURO/g, provider.toUpperCase())
    .replace(/Porto Seguro/g, provider);
}

let items: PlannerItem[];
let input: PlanLibraryInput;
let analysis: BatchAnalysis;

/**
 * Nome e endereço do FIADOR na minuta — dados fictícios do corpus versionado.
 * São as duas categorias que só o classificador LLM acha; aqui elas entram como
 * se ele as tivesse apontado.
 */
const FIADOR_ENTITIES: ExternalEntity[] = [
  { kind: "person_name", excerpt: "PEDRO FIADOR TESTE" },
  { kind: "address", excerpt: "Rua das Acácias Fictícias, nº 88" },
];

/** O `piiReport` que o classificador LLM gravaria para o item do fiador. */
function fiadorPiiReport(text: string): ItemPiiReport {
  return summarizePii(detectPii(text, { externalEntities: FIADOR_ENTITIES }), text);
}

beforeAll(async () => {
  const porto = read("03-RES-PORTO-SEGURO.txt");
  const raw = [
    { id: "porto", filename: "03-RES-PORTO-SEGURO.docx", text: porto },
    { id: "tokio", filename: "05-RES-TOKIO.docx", text: withProvider(porto, "Tokio Marine") },
    { id: "pottencial", filename: "06-RES-POTTENCIAL.docx", text: withProvider(porto, "Pottencial") },
    { id: "too", filename: "07-RES-TOO.docx", text: withProvider(porto, "Too") },
    { id: "fiador", filename: "01-RES-FIADOR.docx", text: read("01-RES-FIADOR.txt") },
    { id: "titulo", filename: "04-RES-TITULO.docx", text: read("04-RES-TITULO-CAPITALIZACAO.txt") },
  ];

  items = [];
  for (const r of raw) {
    const { classification } = await deterministicItemClassifier.classify({
      filename: r.filename,
      text: r.text,
      upload: UPLOAD,
    });
    items.push({
      ...r,
      status: "classified",
      classification,
      piiReport: r.id === "fiador" ? fiadorPiiReport(r.text) : null,
    });
  }

  const grouping = buildGroupingReport(
    items.map((i) => ({
      id: i.id,
      filename: i.filename,
      text: i.text,
      familyKey: i.classification!.familyKey,
    })),
    new Date("2026-08-25T12:00:00Z")
  );
  input = { items, grouping };
  analysis = analyzeBatch(input);
});

/** Referência do bloco da cláusula de fiança daquele item. */
function fiancaRef(itemId: string): string {
  const block = (analysis.index.byItem.get(itemId) ?? []).find((b) =>
    b.text.includes("Fiança Locatícia")
  );
  if (!block) throw new Error(`sem bloco de fiança indexado para ${itemId}`);
  return block.ref;
}

function garantiaRef(itemId: string, needle: string): string {
  const block = (analysis.index.byItem.get(itemId) ?? []).find((b) =>
    b.text.includes(needle)
  );
  if (!block) throw new Error(`sem bloco "${needle}" para ${itemId}`);
  return block.ref;
}

// ────────────────────────────────────────────────────────────────────────────
// O caso real do corpus
// ────────────────────────────────────────────────────────────────────────────

describe("análise do lote — corpus real da Ativa", () => {
  it("as 4 minutas de seguro-fiança formam UM grupo; fiador e título ficam de fora", () => {
    expect(input.grouping.groups).toHaveLength(1);
    expect(input.grouping.groups[0].memberIds.slice().sort()).toEqual([
      "porto",
      "pottencial",
      "tokio",
      "too",
    ]);
    expect(analysis.singles.map((s) => s.id).sort()).toEqual(["fiador", "titulo"]);
  });

  it("garantias diferentes caem em famílias diferentes — a regra 1", () => {
    const keys = input.grouping.families.map((f) => f.familyKey).sort();
    expect(keys).toEqual([
      "contrato_locacao:locacao:fiador",
      "contrato_locacao:locacao:seguro_fianca",
      "contrato_locacao:locacao:titulo_capitalizacao",
    ]);
  });

  it("a cláusula de FIANÇA fica indexada, não só a maior divergência", () => {
    // O relatório do agrupamento elege como maior divergência a cláusula de
    // PINTURA INTERNA (mais longa). Se o índice viesse só dela, o planner não
    // teria como referenciar a cláusula que de fato vira acervo.
    for (const id of ["porto", "tokio", "pottencial", "too"]) {
      expect(() => fiancaRef(id), id).not.toThrow();
    }
    const primary = analysis.groups[0].rows.find((r) => r.primary);
    expect(primary?.cells[0].blocks[0].text).toContain("Pintura");
  });

  it("os documentos que não agruparam trazem o próprio trecho de garantia", () => {
    expect(garantiaRef("fiador", "CONDIÇÃO DE FIADOR")).toBeTruthy();
    expect(garantiaRef("titulo", "TÍTULO DE CAPITALIZAÇÃO")).toBeTruthy();
  });
});

describe("digest do lote", () => {
  it("leva classificação, matriz e base comum resumida", () => {
    const digest = buildBatchDigest(input, analysis);
    expect(digest).toContain("## DOCUMENTOS DO LOTE (6)");
    expect(digest).toContain("Dice mínimo:");
    expect(digest).toContain("contenção mínima:");
    expect(digest).toContain("parágrafos idênticos entre TODOS os membros");
    expect(digest).toContain("(MAIOR divergência)");
    expect(digest).toContain("## DOCUMENTOS QUE NÃO AGRUPARAM COM NINGUÉM");
  });

  it("a biblioteca existente entra ANTES dos documentos, com a regra de uso", () => {
    // O insumo que faltou nos dois runs de staging: sem isto o planner propôs
    // os pares "(2)" com o mesmo matchCriteria dos modelos da véspera.
    const digest = buildBatchDigest(
      {
        ...input,
        library: {
          templates: [
            {
              name: "Seguro-Fiança",
              modalidade: "locacao",
              matchCriteria: { garantia: "seguro_fianca" },
            },
          ],
          clauseTagSets: [["garantia:seguro_fianca", "provider:porto_seguro", "slot:garantia"]],
          operatorNotes: ["Nunca criar template amarrado a fornecedor."],
        },
      },
      analysis
    );
    expect(digest).toContain("## BIBLIOTECA ATUAL DO CLIENTE");
    expect(digest).toContain("locacao · {garantia=seguro_fianca} · \"Seguro-Fiança\"");
    expect(digest).toContain("already_covered");
    expect(digest).toContain("## INSTRUÇÕES DO OPERADOR DESTE CLIENTE");
    expect(digest).toContain("Nunca criar template amarrado a fornecedor.");
    expect(digest.indexOf("BIBLIOTECA ATUAL")).toBeLessThan(
      digest.indexOf("## DOCUMENTOS DO LOTE")
    );
  });

  it("sem biblioteca no input, o digest é o de sempre (compat)", () => {
    const digest = buildBatchDigest(input, analysis);
    expect(digest).not.toContain("BIBLIOTECA ATUAL");
  });

  it("trunca cada célula da matriz — um lote de 20 docs tem de caber", () => {
    const digest = buildBatchDigest(input, analysis);
    const cells = digest.split("\n").filter((l) => /^\s+B\d+: /.test(l));
    expect(cells.length).toBeGreaterThan(0);
    for (const line of cells) {
      expect(line.length).toBeLessThanOrEqual(MAX_DIGEST_CELL_CHARS + 40);
    }
    expect(digest).toContain("…");
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Runner falso — nenhum teste toca a API de verdade
// ────────────────────────────────────────────────────────────────────────────

function runner(...responses: unknown[]) {
  const calls: StructuredCallInput[] = [];
  let i = 0;
  const fn = vi.fn(
    async <T,>(call: StructuredCallInput): Promise<StructuredCallResult<T>> => {
      calls.push(call);
      const data = responses[Math.min(i, responses.length - 1)];
      i += 1;
      return {
        data: data as T,
        model: call.model,
        usage: {
          promptTokens: 20_000,
          completionTokens: 1_500,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
        },
        latencyMs: 900,
      };
    }
  );
  return { fn: fn as never, calls };
}

/**
 * Roda a escada INTEIRA, uma invocação por degrau — o que o executor do run faz
 * ao longo de várias fatias. `planLibrary` sozinho dá um degrau e volta.
 */
async function runLadder(
  batch: PlanLibraryInput,
  options: PlanLibraryOptions = {}
): Promise<PlanLibraryResult> {
  let result = await planLibrary(batch, options);
  for (let i = 0; i < PLAN_LADDER_STEPS && result.nextLadder; i++) {
    result = await planLibrary(batch, { ...options, ladder: result.nextLadder });
  }
  return result;
}

/** O plano que o corpus real deveria produzir. */
function goodPlan(confidence = 0.88) {
  const providers: Array<[string, string]> = [
    ["porto", "Porto Seguro"],
    ["tokio", "Tokio Marine"],
    ["pottencial", "Pottencial"],
    ["too", "Too"],
  ];
  return {
    templates: [
      {
        sourceItemId: "porto",
        name: "Locação residencial — seguro-fiança",
        modalidade: "locacao",
        matchCriteria: { garantia: "seguro_fianca" },
        slotBlocks: [{ slot: "garantia", blockRefs: [fiancaRef("porto")] }],
        isDefaultSuggested: true,
        groupId: "porto",
        rationale: "As quatro minutas só diferem no garantidor.",
      },
      {
        sourceItemId: "fiador",
        name: "Locação residencial — fiador",
        modalidade: "locacao",
        matchCriteria: { garantia: "fiador" },
        rationale: "Contrato com fiador e devedor solidário.",
      },
      {
        sourceItemId: "titulo",
        name: "Locação residencial — título de capitalização",
        modalidade: "locacao",
        matchCriteria: { garantia: "titulo_capitalizacao" },
        rationale: "Garantia por título de capitalização.",
      },
    ],
    clauses: providers.map(([itemId, provider]) => ({
      slot: "garantia",
      value: "seguro_fianca",
      provider,
      title: `Seguro-fiança — ${provider}`,
      blockRefs: [fiancaRef(itemId)],
      sourceItemId: itemId,
      rationale: `Variante do garantidor ${provider}.`,
    })),
    discards: [],
    issues: [],
    confidence,
  };
}

describe("planner — o plano do corpus real", () => {
  it("4 seguro-fiança viram 1 template + 4 cláusulas; fiador e título, templates próprios", async () => {
    const r = runner(goodPlan());
    const result = await planLibrary(input, { structured: r.fn });

    expect(result.accepted).toBe(true);
    expect(r.calls).toHaveLength(1);
    expect(result.plan.templates).toHaveLength(3);

    const garantias = result.plan.templates.map((t) => t.matchCriteria.garantia).sort();
    expect(garantias).toEqual(["fiador", "seguro_fianca", "titulo_capitalizacao"]);
    // Regra 1: um template físico por garantia, cada um alcançável pelo form.
    expect(result.plan.templates.every((t) => t.modalidade === "locacao")).toBe(true);

    // Regra 2: o que separa as quatro minutas é UMA cláusula por garantidor.
    expect(result.plan.clauses).toHaveLength(4);
    expect(result.plan.clauses.map((c) => c.tags.sort().join("|")).sort()).toEqual(
      [
        "garantia:seguro_fianca|provider:porto_seguro|slot:garantia",
        "garantia:seguro_fianca|provider:pottencial|slot:garantia",
        "garantia:seguro_fianca|provider:tokio_marine|slot:garantia",
        "garantia:seguro_fianca|provider:too|slot:garantia",
      ].sort()
    );
  });

  it("o conteúdo da cláusula é o parágrafo LITERAL do documento, não uma paráfrase", async () => {
    const r = runner(goodPlan());
    const { plan } = await planLibrary(input, { structured: r.fn });
    const porto = plan.clauses.find((c) => c.provider === "Porto Seguro")!;
    const original = items.find((i) => i.id === "porto")!.text;
    expect(porto.content).toContain("PORTO SEGURO CIA. DE SEGUROS GERAIS");
    expect(original).toContain(porto.content.slice(0, 80));
  });

  it("o bloco de slot sai do documento fonte e sobrevive ao guardrail", async () => {
    const r = runner(goodPlan());
    const { plan, accepted } = await planLibrary(input, { structured: r.fn });
    expect(accepted).toBe(true);
    const seguro = plan.templates.find((t) => t.sourceItemId === "porto")!;
    expect(seguro.slotBlocks?.garantia?.[0]).toContain("Fiança Locatícia");
  });

  it("o corpo do modelo ainda nomeia a seguradora ⇒ issue provider_in_template", async () => {
    // Caso REAL do corpus: a cláusula de pintura interna cita "Porto Seguro"
    // fora da cláusula de garantia. O modelo não é inválido — precisa de olho.
    const r = runner(goodPlan());
    const { plan } = await planLibrary(input, { structured: r.fn });
    const issue = plan.issues.find((i) => i.kind === "provider_in_template");
    expect(issue?.itemId).toBe("porto");
    expect(issue?.detail).toContain("Porto Seguro");
  });

  it("não manda sampling param e cacheia o playbook, não o digest", async () => {
    const r = runner(goodPlan());
    await planLibrary(input, { structured: r.fn });
    const call = r.calls[0];
    expect(call.model).toBe(INGEST_PLAN_MODEL);
    expect(call.effort).toBe("high");
    expect(JSON.stringify(call)).not.toContain("temperature");
    // O breakpoint fica no ÚLTIMO bloco estável (os playbooks); o digest é
    // volátil e viaja no turno do usuário.
    expect(call.system.at(-1)?.cache).toBe(true);
    expect(call.system.at(-1)?.text).toContain("Playbook — CONTRATO DE LOCAÇÃO");
    expect(call.system.map((b) => b.text).join()).not.toContain("Playbook — CONTRATO DE COMPRA");
    expect(call.userContent).toContain("## DOCUMENTOS DO LOTE");
  });

  it("pede a resposta em STREAMING — saída longa não cabe numa chamada muda", async () => {
    // Foi assim que a chamada morreu em staging: 504 na Vercel, sem plano e sem
    // erro registrado. Saída longa sem streaming é o caso clássico de timeout.
    const r = runner(goodPlan());
    await planLibrary(input, { structured: r.fn });
    expect(r.calls[0].stream).toBe(true);
  });

  it("o teto de saída vem do TAMANHO do lote, não de uma constante", async () => {
    // Constante de 16k: coube em 11 documentos, cortou o plano de 20 no meio de
    // um `matchCriteria`. O plano carrega o texto das cláusulas, então cresce
    // com o acervo.
    const r = runner(goodPlan());
    await planLibrary(input, { structured: r.fn });
    expect(r.calls[0].maxTokens).toBe(planMaxTokens(input.items.length));
  });

  it("registra a duração de cada tentativa — é o que faltava para ver o aperto", async () => {
    const r = runner(goodPlan());
    const result = await planLibrary(input, { structured: r.fn });
    expect(result.attempts[0].durationMs).toBe(900);
  });
});

describe("planner — plano recusado", () => {
  it("template com sourceItemId inexistente derruba o plano", async () => {
    const bad = goodPlan();
    bad.templates[0].sourceItemId = "item-que-nao-existe";
    const r = runner(bad);
    const result = await runLadder(input, { structured: r.fn });

    expect(result.accepted).toBe(false);
    expect(result.attempts[0].violations.map((v) => v.kind)).toContain(
      "unknown_source_item"
    );
    // Nada de conserto silencioso: o plano volta como veio, com issue.
    expect(result.plan.templates[0].sourceItemId).toBe("item-que-nao-existe");

    // Regra dura violada é `plan_invalid`, NÃO `low_confidence`: o operador
    // precisa distinguir "o modelo hesitou" de "o modelo propôs algo proibido".
    const recusa = result.plan.issues.find((i) => i.kind === "plan_invalid");
    expect(recusa?.detail).toContain("não está neste lote");
    expect(result.plan.issues.some((i) => i.kind === "low_confidence")).toBe(false);
  });

  it("problema de slot mantém o kind que o nomeia, em vez de virar plan_invalid", async () => {
    // `slot_not_applicable` e `pii_leftover` continuam nomeando o problema com
    // mais precisão que "recusado" — só o resto vira `plan_invalid`.
    const bad = goodPlan();
    bad.templates[0].slotBlocks = [{ slot: "garantia", blockRefs: ["B999"] }];
    const r = runner(bad);
    const { plan, accepted } = await runLadder(input, { structured: r.fn });

    expect(accepted).toBe(false);
    expect(plan.issues.some((i) => i.kind === "slot_not_applicable")).toBe(true);
  });

  it("o conteúdo da cláusula sai sanitizado — o CPF do fiador não vira embedding", async () => {
    const comFiador = goodPlan();
    comFiador.clauses[0].blockRefs = [garantiaRef("fiador", "CONDIÇÃO DE FIADOR")];
    comFiador.clauses[0].sourceItemId = "fiador";
    const r = runner(comFiador);
    const { plan } = await planLibrary(input, { structured: r.fn });

    const clausula = plan.clauses[0];
    const original = items.find((i) => i.id === "fiador")!.text;
    // O bloco original tem CPF e RG; o do plano, só placeholder.
    expect(original).toContain("555.666.777-20");
    expect(clausula.content).not.toContain("555.666.777-20");
    expect(clausula.content).toContain("000.000.000-00");
    expect(plan.issues.some((i) => i.kind === "pii_leftover")).toBe(false);
  });

  it("nome e endereço do fiador também saem — os offsets do item os alcançam", async () => {
    // Era a lacuna: `pii.ts` não faz NER, então NOME/ENDEREÇO só existiam
    // enquanto o classificador rodava. Com os offsets no `piiReport`, o trecho
    // volta a ser localizável no texto do item e some da cláusula.
    const comFiador = goodPlan();
    comFiador.clauses[0].blockRefs = [garantiaRef("fiador", "CONDIÇÃO DE FIADOR")];
    comFiador.clauses[0].sourceItemId = "fiador";
    const r = runner(comFiador);
    const { plan } = await planLibrary(input, { structured: r.fn });

    const clausula = plan.clauses[0];
    const original = items.find((i) => i.id === "fiador")!.text;
    expect(original).toContain("PEDRO FIADOR TESTE");
    expect(clausula.content).not.toContain("PEDRO FIADOR TESTE");
    expect(clausula.content).toContain("[NOME]");
    expect(clausula.content).not.toContain("Rua das Acácias Fictícias");
    expect(clausula.content).toContain("[ENDEREÇO]");
  });

  it("item sem offsets confiáveis: a cláusula sai como veio, para o executor barrar", async () => {
    // O planner não é o gate. Quando os offsets não batem com o texto (item
    // reprocessado), ele não inventa sanitização — quem falha fechado é o
    // `plan-executor`, antes de gravar.
    const semOffsets: PlanLibraryInput = {
      ...input,
      items: input.items.map((i) =>
        i.id === "fiador"
          ? { ...i, piiReport: { ...i.piiReport!, textFingerprint: "outro-texto" } }
          : i
      ),
    };
    const comFiador = goodPlan();
    comFiador.clauses[0].blockRefs = [garantiaRef("fiador", "CONDIÇÃO DE FIADOR")];
    comFiador.clauses[0].sourceItemId = "fiador";
    const r = runner(comFiador);
    const { plan } = await planLibrary(semOffsets, { structured: r.fn });

    expect(plan.clauses[0].content).toContain("PEDRO FIADOR TESTE");
    // O CPF continua sendo pego pelo detector determinístico.
    expect(plan.clauses[0].content).toContain("000.000.000-00");
  });

  it("duas cláusulas do mesmo garantidor: o acervo não as distingue", async () => {
    // As tags são DERIVADAS aqui (slot + valor + provider), então o modelo não
    // consegue errar o conjunto — mas consegue propor duas cláusulas que
    // colidem nele, que é o 422 que a ingestão de cláusulas já recusa.
    const bad = goodPlan();
    bad.clauses[1].provider = "Porto Seguro";
    const r = runner(bad);
    const { plan, accepted } = await runLadder(input, { structured: r.fn });

    expect(accepted).toBe(false);
    const detalhes = plan.issues.map((i) => i.detail).join("\n");
    expect(detalhes).toContain("mesmas etiquetas");
  });
});

// ────────────────────────────────────────────────────────────────────────────
// A escada em degraus
//
// O defeito que estes testes fecham: a escada inteira rodava dentro de UMA
// invocação. Com 147s medidos por chamada contra os 300s de `maxDuration`, o
// segundo degrau matava a função — e levava junto o motivo da recusa do
// primeiro, que é informação de produto.
// ────────────────────────────────────────────────────────────────────────────

describe("planner — um degrau por invocação", () => {
  /** Um plano que os guardrails recusam: locação sem critério de garantia. */
  function invalidPlan() {
    const bad = goodPlan();
    bad.templates[1].matchCriteria = {} as never;
    return bad;
  }

  it("uma invocação faz UMA chamada, mesmo com o plano recusado", async () => {
    const r = runner(invalidPlan());
    const result = await planLibrary(input, { structured: r.fn });

    expect(r.calls).toHaveLength(1);
    expect(result.accepted).toBe(false);
    // O degrau seguinte volta como estado, não como outra chamada.
    expect(result.nextLadder?.stepIndex).toBe(1);
    expect(result.attempts).toHaveLength(1);
  });

  it("o degrau recusado GRAVA as violações — é o insumo do degrau seguinte", async () => {
    const r = runner(invalidPlan());
    const primeiro = await planLibrary(input, { structured: r.fn });

    const violacoes = primeiro.nextLadder!.attempts[0].violations;
    expect(violacoes.map((v) => v.kind)).toContain("missing_garantia_criteria");

    // A invocação seguinte monta o prompt com o que ficou gravado.
    const segundo = await planLibrary(input, {
      structured: r.fn,
      ladder: primeiro.nextLadder!,
    });
    expect(r.calls[1].userContent).toContain("O PLANO ANTERIOR FOI RECUSADO");
    expect(r.calls[1].userContent).toContain("missing_garantia_criteria");
    expect(segundo.attempts).toHaveLength(2);
  });

  it("aceito no degrau 2: o plano volta pronto e a escada acaba", async () => {
    const r = runner(invalidPlan(), goodPlan());
    const primeiro = await planLibrary(input, { structured: r.fn });
    const segundo = await planLibrary(input, {
      structured: r.fn,
      ladder: primeiro.nextLadder!,
    });

    expect(segundo.accepted).toBe(true);
    expect(segundo.nextLadder).toBeNull();
    expect(r.calls).toHaveLength(2);
    expect(segundo.plan.templates).toHaveLength(3);
    // O histórico atravessa as invocações inteiro.
    expect(segundo.attempts.map((a) => a.ok)).toEqual([false, true]);
    expect(segundo.attempts.map((a) => a.attempt)).toEqual([1, 2]);
  });

  it("inválido duas vezes sobe a PROFUNDIDADE antes de trocar de modelo", async () => {
    // Opus 4.8 e Opus 5 custam igual por token, então mais raciocínio no mesmo
    // modelo sai mais barato que outro modelo — e é mais previsível.
    const r = runner(invalidPlan());
    const result = await runLadder(input, { structured: r.fn });

    expect(r.calls.map((c) => `${c.model}/${c.effort}`)).toEqual([
      `${INGEST_PLAN_MODEL}/high`,
      `${INGEST_PLAN_MODEL}/high`,
      `${INGEST_PLAN_MODEL}/xhigh`,
      `${INGEST_ESCALATION_MODEL}/xhigh`,
    ]);
    expect(result.escalated).toBe(true);
    expect(result.accepted).toBe(false);
    expect(result.attempts).toHaveLength(PLAN_LADDER_STEPS);
    expect(result.nextLadder).toBeNull();
  });

  it("escada esgotada devolve as issues — todas as violações continuam no relatório", async () => {
    const r = runner(invalidPlan());
    const result = await runLadder(input, { structured: r.fn });

    // O plano final chega à revisão humana com o motivo da recusa…
    expect(result.plan.issues.some((i) => i.kind === "plan_invalid")).toBe(true);
    // …e o degrau 1 continua gravado com o que ele propôs de errado.
    expect(result.attempts[0].violations.map((v) => v.kind)).toContain(
      "missing_garantia_criteria"
    );
  });

  it("o orçamento de degraus encerra a escada antes do fim dela", async () => {
    // É o que sobra quando degraus anteriores morreram no timeout: o run não
    // tem mais chamada para comprar, e o plano em mãos vai para a revisão em
    // vez de virar `failed`.
    const r = runner(invalidPlan());
    const result = await planLibrary(input, { structured: r.fn, stepBudget: 1 });

    expect(r.calls).toHaveLength(1);
    expect(result.nextLadder).toBeNull();
    expect(result.accepted).toBe(false);
    expect(result.plan.issues.some((i) => i.kind === "plan_invalid")).toBe(true);
  });
});

describe("planner — escalação por confiança baixa", () => {
  it("plano válido com confiança baixa pula a repetição e vai direto ao xhigh", async () => {
    const r = runner(goodPlan(0.4), goodPlan(0.95));
    const result = await runLadder(input, { structured: r.fn });

    // Sem violação a devolver, refazer a MESMA pergunta com a MESMA
    // profundidade não mudaria nada — o degrau do meio é pulado.
    expect(r.calls.map((c) => `${c.model}/${c.effort}`)).toEqual([
      `${INGEST_PLAN_MODEL}/high`,
      `${INGEST_PLAN_MODEL}/xhigh`,
    ]);
    expect(result.escalated).toBe(true);
    expect(result.accepted).toBe(true);
    expect(result.plan.confidence).toBeGreaterThanOrEqual(MIN_PLAN_CONFIDENCE);
    expect(r.calls[1].userContent).not.toContain("O PLANO ANTERIOR FOI RECUSADO");
  });

  it("confiança baixa até no último degrau vira issue low_confidence", async () => {
    const r = runner(goodPlan(0.3));
    const result = await runLadder(input, { structured: r.fn });

    expect(result.accepted).toBe(false);
    expect(r.calls.map((c) => `${c.model}/${c.effort}`)).toEqual([
      `${INGEST_PLAN_MODEL}/high`,
      `${INGEST_PLAN_MODEL}/xhigh`,
      `${INGEST_ESCALATION_MODEL}/xhigh`,
    ]);
    expect(result.plan.issues.some((i) => i.kind === "low_confidence")).toBe(true);
    // O plano é VÁLIDO — só pouco confiável. Nada de `plan_invalid` aqui.
    expect(result.plan.issues.some((i) => i.kind === "plan_invalid")).toBe(false);
  });
});

/**
 * O modo estrito exige TODO campo em `required`, então os campos que o modelo
 * antes omitia (`slotBlocks`, `isDefaultSuggested`, `groupId` e os quatro de
 * `matchCriteria`) passam a vir com um valor de AUSÊNCIA explícito.
 *
 * O que estes testes fixam é a condição que torna a mudança segura: o parse
 * trata o valor de ausência EXATAMENTE como tratava a omissão. Sem isso, a
 * guarda contra o 400 teria trocado um erro barulhento por um plano errado — e
 * os planos já gravados no banco (que vieram do formato antigo, com o campo
 * ausente) deixariam de bater com os novos.
 */
describe("planner — ausência omitida × ausência explícita produzem o MESMO plano", () => {
  // `input` só existe depois do `beforeAll` que lê o corpus — resolver o índice
  // no corpo do describe rodaria cedo demais.
  const index = () => analysis.index;

  /** Um template no formato ANTIGO: campos opcionais simplesmente omitidos. */
  const omitido = {
    sourceItemId: "fiador",
    name: "Locação residencial — fiador",
    modalidade: "locacao",
    matchCriteria: { garantia: "fiador" },
    rationale: "Contrato com fiador.",
  };

  /** O mesmo template no formato NOVO: cada ausência dita explicitamente. */
  const explicito = {
    ...omitido,
    matchCriteria: {
      garantia: "fiador",
      fiadorPessoa: null,
      pessoa: null,
      admImobiliaria: null,
    },
    slotBlocks: [],
    isDefaultSuggested: false,
    groupId: null,
  };

  it("o template sai idêntico nos dois formatos", () => {
    const antigo = materializePlan({ templates: [omitido], confidence: 0.9 }, index());
    const novo = materializePlan({ templates: [explicito], confidence: 0.9 }, index());

    expect(novo.templates[0]).toEqual(antigo.templates[0]);
    // E a ausência continua sendo ausência no objeto GRAVADO: nada de
    // `slotBlocks: {}` ou `isDefaultSuggested: false` vazando para o banco.
    expect(novo.templates[0]).not.toHaveProperty("slotBlocks");
    expect(novo.templates[0]).not.toHaveProperty("isDefaultSuggested");
    expect(novo.templates[0]).not.toHaveProperty("groupId");
    expect(novo.templates[0].matchCriteria).toEqual({ garantia: "fiador" });
  });

  it("slotBlocks aceita lista vazia, null e ausência como a mesma coisa", () => {
    const shapes = [undefined, null, []];
    const saidas = shapes.map(
      (slotBlocks) =>
        materializePlan(
          { templates: [{ ...omitido, slotBlocks }], confidence: 0.9 },
          index()
        ).templates[0]
    );
    for (const saida of saidas) expect(saida).toEqual(saidas[0]);
    expect(saidas[0]).not.toHaveProperty("slotBlocks");
  });

  it("isDefaultSuggested: false é o mesmo que omitido, e true continua valendo", () => {
    const comFalse = materializePlan(
      { templates: [{ ...omitido, isDefaultSuggested: false }], confidence: 0.9 },
      index()
    );
    expect(comFalse.templates[0]).not.toHaveProperty("isDefaultSuggested");

    const comTrue = materializePlan(
      { templates: [{ ...omitido, isDefaultSuggested: true }], confidence: 0.9 },
      index()
    );
    expect(comTrue.templates[0].isDefaultSuggested).toBe(true);
  });

  it("groupId null é o mesmo que omitido, e a string continua valendo", () => {
    const nulo = materializePlan(
      { templates: [{ ...omitido, groupId: null }], confidence: 0.9 },
      index()
    );
    expect(nulo.templates[0]).not.toHaveProperty("groupId");

    const comId = materializePlan(
      { templates: [{ ...omitido, groupId: "porto" }], confidence: 0.9 },
      index()
    );
    expect(comId.templates[0].groupId).toBe("porto");
  });

  it("os quatro campos de matchCriteria em null não entram no critério", () => {
    const todosNulos = materializePlan(
      {
        templates: [
          {
            ...omitido,
            matchCriteria: {
              garantia: null,
              fiadorPessoa: null,
              pessoa: null,
              admImobiliaria: null,
            },
          },
        ],
        confidence: 0.9,
      },
      index()
    );
    expect(todosNulos.templates[0].matchCriteria).toEqual({});
  });

  it("o slotBlocks preenchido segue funcionando — a mudança não é só permissiva", () => {
    const comBloco = materializePlan(
      {
        templates: [
          {
            ...explicito,
            sourceItemId: "porto",
            slotBlocks: [{ slot: "garantia", blockRefs: [fiancaRef("porto")] }],
          },
        ],
        confidence: 0.9,
      },
      index()
    );
    expect(comBloco.templates[0].slotBlocks?.garantia?.length).toBeGreaterThan(0);
  });
});

/**
 * `minimum`/`maximum` saíram do PLAN_SCHEMA porque `output_config.format` os
 * recusa ("For 'number' type, properties maximum, minimum are not supported").
 * Com isso, o parse é o ÚNICO lugar que impõe a faixa.
 */
describe("planner — a faixa de confidence agora é imposta no parse", () => {
  it("valor acima de 1 é truncado, não aceito como veio", async () => {
    const r = runner(goodPlan(7));
    const result = await planLibrary(input, { structured: r.fn });

    expect(result.plan.confidence).toBe(1);
    expect(result.accepted).toBe(true);
    // Truncar, e não rejeitar: um número cosmético não vale jogar fora o plano
    // inteiro que a chamada cara acabou de produzir.
    expect(r.calls).toHaveLength(1);
  });

  it("valor negativo vira 0", async () => {
    const r = runner(goodPlan(-3), goodPlan(0.95));
    const result = await planLibrary(input, { structured: r.fn });
    expect(result.attempts[0].confidence).toBe(0);
  });

  it("confidence ausente ou não numérica vira 0 e faz a escada escalar", async () => {
    const semNumero = { ...goodPlan(), confidence: "muito alta" };
    const r = runner(semNumero, goodPlan(0.95));
    const result = await runLadder(input, { structured: r.fn });

    // 0 fica abaixo do piso: o lado seguro de errar quando o campo não veio.
    expect(result.attempts[0].confidence).toBe(0);
    expect(result.escalated).toBe(true);
    expect(result.accepted).toBe(true);
  });
});

describe("planner — divergência de classificação e custo", () => {
  it("conflito heurística×LLM registrado no item vira issue no plano", async () => {
    const comConflito: PlanLibraryInput = {
      ...input,
      items: input.items.map((i) =>
        i.id === "porto"
          ? {
              ...i,
              classification: {
                ...i.classification!,
                via: "llm" as const,
                conflicts: [
                  { field: "garantiaTipo" as const, heuristic: "fiador", llm: "seguro_fianca" },
                ],
              },
            }
          : i
      ),
    };
    const r = runner(goodPlan());
    const { plan } = await planLibrary(comConflito, { structured: r.fn });

    const issue = plan.issues.find((i) => i.kind === "classification_conflict");
    expect(issue?.itemId).toBe("porto");
    expect(issue?.detail).toContain("fiador");
    expect(issue?.detail).toContain("seguro_fianca");
  });

  it("registra a chamada como ingest_plan e acumula no run", async () => {
    const persist = vi.fn().mockResolvedValue(undefined);
    const meter = new IngestionAiMeter({ runId: "run-9", orgId: "org-1", persist });
    const r = runner(goodPlan());
    await planLibrary(input, { structured: r.fn, meter });

    expect(meter.spentUsd).toBeGreaterThan(0);
    expect(persist).toHaveBeenCalledWith("run-9", meter.spentUsd);
  });

  it("teto de custo estourado interrompe ANTES de chamar o modelo", async () => {
    const meter = new IngestionAiMeter({
      runId: "run-9",
      orgId: "org-1",
      spentUsd: 6,
      capUsd: 5,
      persist: vi.fn(),
    });
    const r = runner(goodPlan());
    await expect(
      planLibrary(input, { structured: r.fn, meter })
    ).rejects.toBeInstanceOf(IngestionCostCapError);
    expect(r.calls).toHaveLength(0);
  });

  it("o teto também interrompe no meio da escalação", async () => {
    const persist = vi.fn().mockResolvedValue(undefined);
    const meter = new IngestionAiMeter({
      runId: "run-9",
      orgId: "org-1",
      capUsd: 0.05,
      persist,
    });
    const bad = goodPlan();
    bad.templates[1].matchCriteria = {} as never;
    const r = runner(bad);

    await expect(
      runLadder(input, { structured: r.fn, meter })
    ).rejects.toBeInstanceOf(IngestionCostCapError);
    // Um degrau aconteceu (US$ 0,08 > teto); o seguinte foi barrado.
    expect(r.calls).toHaveLength(1);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// O orçamento do índice de blocos
//
// O defeito que estes testes fecham: o teto era GLOBAL e gasto por ordem de
// chegada. Passado ele, as famílias seguintes não entravam no índice, o planner
// ficava sem referência para citá-las e o plano saía "válido" — sem erro, sem
// aviso, com famílias inteiras ausentes da revisão humana.
// ────────────────────────────────────────────────────────────────────────────

/**
 * Um lote sintético: uma entrada por família, dizendo quantos documentos ela
 * tem e quantos parágrafos de garantia cada documento traz.
 *
 * Ninguém agrupa — todo documento entra pelo caminho dos avulsos, que é
 * exatamente onde o teto cego apagava as últimas famílias do índice.
 */
function syntheticBatch(
  families: ReadonlyArray<{ docs: number; paragraphs: number }>
): PlanLibraryInput {
  const items: PlannerItem[] = [];
  const reportFamilies = families.map((family, f) => {
    const itemIds: string[] = [];
    for (let d = 0; d < family.docs; d++) {
      const id = `f${f}-d${d}`;
      itemIds.push(id);
      const text = Array.from(
        { length: family.paragraphs },
        (_, p) =>
          `CLÁUSULA ${p + 1} — DA GARANTIA LOCATÍCIA. O LOCATÁRIO apresenta a ` +
          `garantia ${p + 1} da família ${f}, documento ${d}, nos termos deste contrato.`
      ).join("\n\n");
      items.push({
        id,
        filename: `${id}.docx`,
        text,
        status: "classified",
        classification: null,
      });
    }
    return { familyKey: `contrato_locacao:locacao:garantia_${f}`, itemIds };
  });

  return {
    items,
    grouping: {
      families: reportFamilies,
      groups: [],
      singles: items.map((i) => i.id),
      groupedAt: "2026-08-25T12:00:00Z",
    },
  };
}

/** Quantos blocos a família levou para o índice. */
function indexedIn(analysis: BatchAnalysis, itemIds: readonly string[]): number {
  return itemIds.reduce(
    (n, id) => n + (analysis.index.byItem.get(id)?.length ?? 0),
    0
  );
}

describe("planner — o índice é repartido entre as famílias", () => {
  it("lote grande: nenhuma família fica sem blocos e o corte é distribuído", () => {
    const grande = syntheticBatch(
      Array.from({ length: 8 }, () => ({ docs: 3, paragraphs: 20 }))
    );
    const a = analyzeBatch(grande);

    expect(a.budget.truncated).toBe(true);
    expect(a.budget.indexed).toBe(MAX_INDEXED_BLOCKS);
    expect(a.budget.indexed + a.budget.dropped).toBe(8 * 3 * 20);

    const porFamilia = grande.grouping.families.map((f) =>
      indexedIn(a, f.itemIds)
    );
    // O que o teto cego fazia: as primeiras famílias com tudo, as últimas com
    // zero. Agora a diferença entre a maior e a menor fatia é de um bloco.
    expect(Math.min(...porFamilia)).toBeGreaterThan(0);
    expect(Math.max(...porFamilia) - Math.min(...porFamilia)).toBeLessThanOrEqual(1);

    // E dentro da família o corte também é por rodadas: nenhum DOCUMENTO fica
    // mudo enquanto a fatia da família comporta um bloco para cada um.
    for (const item of grande.items) {
      expect(a.index.byItem.get(item.id)?.length ?? 0, item.id).toBeGreaterThan(0);
    }
  });

  it("quem pede acima da média é cortado; a família pequena sai inteira", () => {
    const misto = syntheticBatch([
      { docs: 1, paragraphs: 3 },
      { docs: 2, paragraphs: 150 },
      { docs: 2, paragraphs: 150 },
    ]);
    const a = analyzeBatch(misto);
    const [pequena, ...grandes] = misto.grouping.families;

    expect(indexedIn(a, pequena.itemIds)).toBe(3);
    expect(a.budget.families.map((f) => f.familyKey)).toEqual(
      grandes.map((f) => f.familyKey)
    );
    for (const familia of grandes) {
      expect(indexedIn(a, familia.itemIds), familia.familyKey).toBeGreaterThan(90);
    }
    expect(a.budget.indexed).toBe(MAX_INDEXED_BLOCKS);
  });

  it("mais famílias que orçamento: cada uma ainda leva um bloco", () => {
    const espalhado = syntheticBatch(
      Array.from({ length: 260 }, () => ({ docs: 1, paragraphs: 2 }))
    );
    const a = analyzeBatch(espalhado);

    // O teto é ultrapassado de propósito: família muda no índice é o defeito
    // que o rateio existe para não ter.
    expect(a.index.byRef.size).toBe(260);
    for (const f of espalhado.grouping.families) {
      expect(indexedIn(a, f.itemIds), f.familyKey).toBe(1);
    }
  });

  it("truncar vira issue index_truncated, com os números e as famílias", async () => {
    const grande = syntheticBatch(
      Array.from({ length: 8 }, () => ({ docs: 3, paragraphs: 20 }))
    );
    const r = runner({
      templates: [],
      clauses: [],
      discards: [],
      issues: [],
      confidence: 0.9,
    });
    const result = await planLibrary(grande, { structured: r.fn });

    // O `report` do run recebe os números — é isso que o operador lê.
    expect(result.indexBudget.indexed).toBe(MAX_INDEXED_BLOCKS);
    expect(result.indexBudget.dropped).toBe(8 * 3 * 20 - MAX_INDEXED_BLOCKS);
    expect(result.indexBudget.families).toHaveLength(8);

    // `index_truncated`, e não `acervo_incompleto`: a lacuna é do índice (o
    // material veio e não coube), não do que a imobiliária mandou.
    const issue = result.plan.issues.find((i) => i.kind === "index_truncated");
    expect(issue?.itemId).toBeNull();
    expect(issue?.detail).toContain(String(result.indexBudget.indexed));
    expect(issue?.detail).toContain(String(result.indexBudget.dropped));
    expect(issue?.detail).toContain("contrato_locacao:locacao:garantia_0");
    expect(result.plan.issues.some((i) => i.kind === "acervo_incompleto")).toBe(
      false
    );
  });

  it("o digest avisa que o índice é amostra e os números batem com o indexado", () => {
    const grande = syntheticBatch(
      Array.from({ length: 8 }, () => ({ docs: 3, paragraphs: 20 }))
    );
    const a = analyzeBatch(grande);
    const digest = buildBatchDigest(grande, a);

    expect(digest).toContain("AMOSTRA DO LOTE");
    expect(digest).toContain(`${a.budget.indexed} parágrafos foram indexados`);
    expect(digest).toContain(`${a.budget.dropped} ficaram de fora`);
    // O aviso vem ANTES dos documentos: é premissa de tudo o que vem depois.
    expect(digest.indexOf("AMOSTRA DO LOTE")).toBeLessThan(
      digest.indexOf("## DOCUMENTOS DO LOTE")
    );
    // E a descrição é verdadeira: tantas referências exibidas quantos blocos
    // realmente entraram no índice.
    const refs = digest.split("\n").filter((l) => /^\s+B\d+: /.test(l));
    expect(refs).toHaveLength(a.budget.indexed);
  });

  it("documento que perdeu tudo é dito como tal, não como documento sem garantia", () => {
    // 30 documentos numa família cuja fatia comporta 10: a família continua
    // representada, mas 20 documentos ficam de fora — e o digest não pode
    // sugerir que eles não falam de garantia.
    const lotado = syntheticBatch(
      Array.from({ length: 20 }, () => ({ docs: 30, paragraphs: 1 }))
    );
    const a = analyzeBatch(lotado);
    for (const f of lotado.grouping.families) {
      expect(indexedIn(a, f.itemIds), f.familyKey).toBeGreaterThan(0);
    }

    const digest = buildBatchDigest(lotado, a);
    expect(digest).toContain("não couberam no índice");
    expect(digest).not.toContain("(sem trecho de garantia indexado)");
  });
});

describe("planner — o lote que funciona hoje não muda", () => {
  it("o corpus real não é cortado: sem corte, sem aviso, mesmas referências", () => {
    expect(analysis.budget.truncated).toBe(false);
    expect(analysis.budget.dropped).toBe(0);
    expect(analysis.budget.families).toEqual([]);
    expect(analysis.budget.droppedItemIds).toEqual([]);

    // As referências continuam sendo B1…Bn na ordem de coleta.
    expect([...analysis.index.byRef.keys()]).toEqual(
      Array.from({ length: analysis.index.byRef.size }, (_, i) => `B${i + 1}`)
    );
    expect(buildBatchDigest(input, analysis)).not.toContain("AMOSTRA DO LOTE");
  });

  it("nenhuma issue de truncamento aparece no plano do lote pequeno", async () => {
    const r = runner(goodPlan());
    const result = await planLibrary(input, { structured: r.fn });

    expect(result.accepted).toBe(true);
    expect(result.indexBudget.truncated).toBe(false);
    expect(result.plan.issues.some((i) => i.kind === "index_truncated")).toBe(false);
  });
});

describe("planMaxTokens — o teto de saída acompanha o lote", () => {
  it("dá mais espaço para lote maior", () => {
    expect(planMaxTokens(20)).toBeGreaterThan(planMaxTokens(11));
  });

  it("cabe o plano de 11 documentos, que já ocupava quase os 16k fixos", () => {
    // O piloto da Ativa: 6 templates com slotBlocks literais e 7 cláusulas
    // inteiras chegaram perto de estourar o teto que era constante.
    expect(planMaxTokens(11)).toBeGreaterThan(16_000);
  });

  it("cabe o plano de 20, que estourou com o teto fixo", () => {
    expect(planMaxTokens(20)).toBeGreaterThan(30_000);
  });

  it("tem teto duro — acima dele o certo é dividir o lote, não pedir mais tokens", () => {
    expect(planMaxTokens(500)).toBe(planMaxTokens(1000));
    expect(planMaxTokens(1000)).toBeLessThanOrEqual(48_000);
  });

  it("lote vazio ou absurdo não produz teto inválido", () => {
    expect(planMaxTokens(0)).toBeGreaterThan(0);
    expect(planMaxTokens(-3)).toBeGreaterThan(0);
  });
});
