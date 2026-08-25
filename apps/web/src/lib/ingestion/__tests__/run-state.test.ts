import { describe, it, expect } from "vitest";
import {
  AUTO_ADVANCE_STATUSES,
  EXTRACT_BATCH_SIZE,
  RUN_STATUSES,
  batchSizeFor,
  canTransition,
  isAutoAdvanceable,
  isClaimable,
  isRunStatus,
  isTerminalRunStatus,
  itemsForSlice,
  nextRunStatus,
  runClaimWhere,
  stageProgress,
  type ItemStatus,
  type RunStatus,
} from "@/lib/ingestion/run-state";

const item = (id: string, status: ItemStatus) => ({ id, status });

describe("máquina de estados do run", () => {
  it("percorre o pipeline na ordem esperada até parar em planning", () => {
    const path: RunStatus[] = ["queued"];
    let cur: RunStatus | null = "queued";
    while (cur && path.length < 20) {
      cur = nextRunStatus(cur);
      if (cur) path.push(cur);
    }
    expect(path).toEqual([
      "queued",
      "extracting",
      "classifying",
      "grouping",
      "planning",
      "awaiting_review",
      "executing",
      "done",
    ]);
  });

  it("permite ficar no mesmo estágio — é o caso normal do fatiamento", () => {
    expect(canTransition("extracting", "extracting")).toBe(true);
    expect(canTransition("classifying", "classifying")).toBe(true);
  });

  it("recusa pular estágio", () => {
    expect(canTransition("queued", "grouping")).toBe(false);
    expect(canTransition("extracting", "planning")).toBe(false);
    expect(canTransition("grouping", "executing")).toBe(false);
  });

  it("aceita failed/cancelled de qualquer estágio vivo", () => {
    for (const status of RUN_STATUSES) {
      if (isTerminalRunStatus(status)) continue;
      expect(canTransition(status, "failed")).toBe(true);
      expect(canTransition(status, "cancelled")).toBe(true);
    }
  });

  it("estado terminal não transita pra lugar nenhum", () => {
    expect(canTransition("done", "executing")).toBe(false);
    expect(canTransition("failed", "queued")).toBe(false);
    expect(canTransition("cancelled", "cancelled")).toBe(false);
  });

  it("planning avança sozinho; o que espera gente não", () => {
    // `planning` é trabalho de máquina: sem ele na lista, a corrente e o cron
    // parariam a um passo da tela de revisão. E é ele que torna a chamada do
    // planner retomável quando o claim vence.
    expect(isAutoAdvanceable("planning")).toBe(true);
    expect(isAutoAdvanceable("awaiting_review")).toBe(false);
    expect(isAutoAdvanceable("executing")).toBe(false);
    expect([...AUTO_ADVANCE_STATUSES]).toEqual([
      "queued",
      "extracting",
      "classifying",
      "grouping",
      "planning",
    ]);
  });

  it("isRunStatus rejeita string arbitrária", () => {
    expect(isRunStatus("extracting")).toBe(true);
    expect(isRunStatus("extraindo")).toBe(false);
    expect(isRunStatus(null)).toBe(false);
  });
});

describe("fatiamento", () => {
  const items = [
    item("a", "pending"),
    item("b", "pending"),
    item("c", "pending"),
    item("d", "pending"),
    item("e", "pending"),
    item("f", "pending"),
    item("g", "pending"),
  ];

  it("a extração leva no máximo EXTRACT_BATCH_SIZE por invocação", () => {
    const slice = itemsForSlice(items, "extracting");
    expect(slice).toHaveLength(EXTRACT_BATCH_SIZE);
    expect(slice.map((i) => i.id)).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("a segunda invocação pega o resto — nenhum item aparece duas vezes", () => {
    const first = itemsForSlice(items, "extracting").map((i) => i.id);
    // Simula o efeito da 1ª fatia: os cinco viraram `extracted`.
    const after = items.map((i) =>
      first.includes(i.id) ? item(i.id, "extracted") : i
    );
    const second = itemsForSlice(after, "extracting").map((i) => i.id);
    expect(second).toEqual(["f", "g"]);
    expect(first.filter((id) => second.includes(id))).toEqual([]);
  });

  it("fatia vazia é o sinal de que o estágio acabou", () => {
    const done = items.map((i) => item(i.id, "extracted"));
    expect(itemsForSlice(done, "extracting")).toEqual([]);
    expect(itemsForSlice(done, "classifying")).toHaveLength(7);
  });

  it("item quebrado ou descartado nunca volta pra fatia", () => {
    const mixed = [
      item("a", "error"),
      item("b", "discarded"),
      item("c", "pending"),
    ];
    expect(itemsForSlice(mixed, "extracting").map((i) => i.id)).toEqual(["c"]);
  });

  it("grouping não é item-a-item — não tem fatia", () => {
    expect(itemsForSlice(items, "grouping")).toEqual([]);
    expect(batchSizeFor("classifying")).toBeGreaterThan(EXTRACT_BATCH_SIZE);
  });
});

describe("progresso por estágio", () => {
  it("queued é sempre zero", () => {
    expect(stageProgress([item("a", "pending")], "queued")).toBe(0);
  });

  it("na extração conta o que já saiu de pending", () => {
    const items = [
      item("a", "extracted"),
      item("b", "error"),
      item("c", "pending"),
    ];
    expect(stageProgress(items, "extracting")).toBe(2);
  });

  it("na classificação conta o que já saiu de extracted", () => {
    const items = [
      item("a", "classified"),
      item("b", "extracted"),
      item("c", "discarded"),
    ];
    expect(stageProgress(items, "classifying")).toBe(2);
  });

  it("no agrupamento todos os itens já foram processados", () => {
    const items = [item("a", "classified"), item("b", "error")];
    expect(stageProgress(items, "grouping")).toBe(2);
  });
});

describe("claim", () => {
  const NOW = new Date("2026-08-25T12:00:00.000Z");
  const STALE_MS = 300_000;

  it("põe a condição de disponibilidade DENTRO do where", () => {
    const where = runClaimWhere({
      runId: "run-1",
      orgId: "org-1",
      now: NOW,
      staleMs: STALE_MS,
    });
    expect(where.id).toBe("run-1");
    expect(where.orgId).toBe("org-1");
    expect(where.status.in).toEqual([...AUTO_ADVANCE_STATUSES]);
    // Livre OU vencido — é isso que torna o updateMany atômico.
    expect(where.OR[0]).toEqual({ startedAt: null });
    expect(where.OR[1].startedAt.lt).toEqual(
      new Date(NOW.getTime() - STALE_MS)
    );
  });

  it("omite orgId quando a chamada é interna (cron)", () => {
    const where = runClaimWhere({ runId: "run-1", now: NOW });
    expect(where.orgId).toBeUndefined();
  });

  it("run livre é reivindicável", () => {
    expect(
      isClaimable({ status: "extracting", startedAt: null }, NOW, STALE_MS)
    ).toBe(true);
  });

  it("run reivindicado há pouco NÃO é reivindicável — a 2ª invocação desiste", () => {
    const recent = new Date(NOW.getTime() - 10_000);
    expect(
      isClaimable({ status: "extracting", startedAt: recent }, NOW, STALE_MS)
    ).toBe(false);
  });

  it("claim vencido é retomável — worker morto não trava o lote pra sempre", () => {
    const old = new Date(NOW.getTime() - STALE_MS - 1);
    expect(
      isClaimable({ status: "extracting", startedAt: old }, NOW, STALE_MS)
    ).toBe(true);
  });

  it("estágio que espera gente não é reivindicável; planning é", () => {
    // A chamada do planner é a mais longa do pipeline e a que mais morre no
    // timeout — ela PRECISA ser reivindicável de novo.
    expect(
      isClaimable({ status: "planning", startedAt: null }, NOW, STALE_MS)
    ).toBe(true);
    expect(
      isClaimable({ status: "awaiting_review", startedAt: null }, NOW, STALE_MS)
    ).toBe(false);
    expect(
      isClaimable({ status: "executing", startedAt: null }, NOW, STALE_MS)
    ).toBe(false);
    expect(isClaimable({ status: "done", startedAt: null }, NOW, STALE_MS)).toBe(
      false
    );
  });
});
