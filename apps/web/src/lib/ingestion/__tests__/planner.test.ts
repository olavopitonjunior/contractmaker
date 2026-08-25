import { describe, it, expect, vi, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  MAX_DIGEST_CELL_CHARS,
  MIN_PLAN_CONFIDENCE,
  analyzeBatch,
  buildBatchDigest,
  planLibrary,
  type BatchAnalysis,
  type PlanLibraryInput,
  type PlannerItem,
} from "@/lib/ingestion/planner";
import { deterministicItemClassifier } from "@/lib/ingestion/classifier";
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
    items.push({ ...r, status: "classified", classification });
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
});

describe("planner — plano recusado", () => {
  it("template com sourceItemId inexistente derruba o plano", async () => {
    const bad = goodPlan();
    bad.templates[0].sourceItemId = "item-que-nao-existe";
    const r = runner(bad);
    const result = await planLibrary(input, { structured: r.fn });

    expect(result.accepted).toBe(false);
    expect(result.attempts[0].violations.map((v) => v.kind)).toContain(
      "unknown_source_item"
    );
    // Nada de conserto silencioso: o plano volta como veio, com issue.
    expect(result.plan.templates[0].sourceItemId).toBe("item-que-nao-existe");
    expect(result.plan.issues.some((i) => i.detail.includes("não está neste lote"))).toBe(
      true
    );
  });

  it("as violações voltam no prompt da tentativa seguinte", async () => {
    const bad = goodPlan();
    bad.templates[1].matchCriteria = {} as never;
    const r = runner(bad);
    await planLibrary(input, { structured: r.fn });

    expect(r.calls.length).toBeGreaterThan(1);
    expect(r.calls[1].userContent).toContain("O PLANO ANTERIOR FOI RECUSADO");
    expect(r.calls[1].userContent).toContain("missing_garantia_criteria");
  });

  it("inválido duas vezes sobe a PROFUNDIDADE antes de trocar de modelo", async () => {
    // Opus 4.8 e Opus 5 custam igual por token, então mais raciocínio no mesmo
    // modelo sai mais barato que outro modelo — e é mais previsível.
    const bad = goodPlan();
    bad.templates[1].matchCriteria = {} as never;
    const r = runner(bad);
    const result = await planLibrary(input, { structured: r.fn });

    expect(r.calls.map((c) => `${c.model}/${c.effort}`)).toEqual([
      `${INGEST_PLAN_MODEL}/high`,
      `${INGEST_PLAN_MODEL}/high`,
      `${INGEST_PLAN_MODEL}/xhigh`,
      `${INGEST_ESCALATION_MODEL}/xhigh`,
    ]);
    expect(result.escalated).toBe(true);
    expect(result.accepted).toBe(false);
    expect(result.attempts).toHaveLength(4);
  });

  it("duas cláusulas do mesmo garantidor: o acervo não as distingue", async () => {
    // As tags são DERIVADAS aqui (slot + valor + provider), então o modelo não
    // consegue errar o conjunto — mas consegue propor duas cláusulas que
    // colidem nele, que é o 422 que a ingestão de cláusulas já recusa.
    const bad = goodPlan();
    bad.clauses[1].provider = "Porto Seguro";
    const r = runner(bad);
    const { plan, accepted } = await planLibrary(input, { structured: r.fn });

    expect(accepted).toBe(false);
    const detalhes = plan.issues.map((i) => i.detail).join("\n");
    expect(detalhes).toContain("mesmas etiquetas");
  });
});

describe("planner — escalação por confiança baixa", () => {
  it("plano válido com confiança baixa pula a repetição e vai direto ao xhigh", async () => {
    const r = runner(goodPlan(0.4), goodPlan(0.95));
    const result = await planLibrary(input, { structured: r.fn });

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
    const result = await planLibrary(input, { structured: r.fn });

    expect(result.accepted).toBe(false);
    expect(r.calls.map((c) => `${c.model}/${c.effort}`)).toEqual([
      `${INGEST_PLAN_MODEL}/high`,
      `${INGEST_PLAN_MODEL}/xhigh`,
      `${INGEST_ESCALATION_MODEL}/xhigh`,
    ]);
    expect(result.plan.issues.some((i) => i.kind === "low_confidence")).toBe(true);
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
      planLibrary(input, { structured: r.fn, meter })
    ).rejects.toBeInstanceOf(IngestionCostCapError);
    // Uma chamada aconteceu (US$ 0,08 > teto); a seguinte foi barrada.
    expect(r.calls).toHaveLength(1);
  });
});
