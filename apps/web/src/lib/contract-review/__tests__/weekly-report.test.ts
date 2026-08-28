import { describe, expect, it } from "vitest";
import {
  buildWeeklyReviewMetrics,
  renderWeeklyReviewEmail,
} from "../weekly-report";

const SINCE = new Date("2026-08-21T12:00:00Z");
const UNTIL = new Date("2026-08-28T12:00:00Z");

function metrics(overrides: Partial<Parameters<typeof buildWeeklyReviewMetrics>[0]> = {}) {
  return buildWeeklyReviewMetrics({
    since: SINCE,
    until: UNTIL,
    runs: [],
    comments: [],
    costs: [],
    orgNames: new Map(),
    ...overrides,
  });
}

describe("buildWeeklyReviewMetrics", () => {
  it("agrega runs, achados, descartes e retries do report", () => {
    const m = metrics({
      runs: [
        {
          status: "done",
          orgId: "o1",
          report: {
            llm: {
              findings: [{ category: "dados_form" }, { category: "dados_form" }, { category: "estrutura_documento" }],
              discarded: 2,
              retried: true,
            },
          },
        },
        { status: "done", orgId: "o1", report: { llm: { findings: [], discarded: 0, retried: false } } },
        { status: "failed", orgId: "o2", report: { reason: "llm-error" } },
        { status: "skipped", orgId: "o2", report: { reason: "contract-approved" } },
        { status: "done", orgId: "o3", report: { llm: { skipped: "daily-cap" } } },
      ],
      comments: [
        { severity: "warning", resolved: true },
        { severity: "warning", resolved: false },
        { severity: "info", resolved: false },
      ],
      costs: [
        { orgId: "o1", costUsd: 0.5, calls: 8 },
        { orgId: "o2", costUsd: 1.2, calls: 15 },
      ],
      orgNames: new Map([
        ["o1", "Demo"],
        ["o2", "Ativa"],
      ]),
    });

    expect(m.runs).toEqual({ total: 5, done: 3, failed: 1, skipped: 1 });
    expect(m.skipReasons).toEqual({ "contract-approved": 1, "llm:daily-cap": 1 });
    expect(m.llm).toEqual({
      findingsByCategory: { dados_form: 2, estrutura_documento: 1 },
      discarded: 2,
      retried: 1,
    });
    expect(m.comments).toEqual({
      created: 3,
      resolved: 1,
      bySeverity: { warning: 2, info: 1 },
    });
    expect(m.cost.totalUsd).toBeCloseTo(1.7);
    // Ordenado por custo desc, com nome resolvido.
    expect(m.cost.byOrg[0]).toEqual({ orgId: "o2", orgName: "Ativa", costUsd: 1.2, calls: 15 });
  });

  it("report malformado não derruba a agregação", () => {
    const m = metrics({
      runs: [
        { status: "done", orgId: "o1", report: null },
        { status: "done", orgId: "o1", report: "lixo" },
        { status: "done", orgId: "o1", report: { llm: { findings: "não-array", discarded: "x" } } },
      ],
    });
    expect(m.runs.done).toBe(3);
    expect(m.llm.discarded).toBe(0);
    expect(m.llm.findingsByCategory).toEqual({});
  });
});

describe("renderWeeklyReviewEmail", () => {
  it("monta assunto com período e corpo com as seções", () => {
    const m = metrics({
      runs: [{ status: "done", orgId: "o1", report: { llm: { findings: [{ category: "dados_form" }], discarded: 1, retried: false } } }],
      comments: [{ severity: "warning", resolved: false }],
      costs: [{ orgId: "o1", costUsd: 0.07, calls: 1 }],
      orgNames: new Map([["o1", "Ativa"]]),
    });
    const email = renderWeeklyReviewEmail(m);
    expect(email.subject).toContain("Revisor pós-geração");
    expect(email.subject).toMatch(/21\/08.28\/08/);
    expect(email.text).toContain("Runs: 1");
    expect(email.text).toContain("dados_form=1");
    expect(email.text).toContain("1 descartado(s)");
    expect(email.text).toContain("Ativa: US$ 0.07");
  });

  it("semana sem run acusa possível pipeline quebrado (silêncio nunca)", () => {
    const email = renderWeeklyReviewEmail(metrics());
    expect(email.text).toContain("Nenhum run na semana");
    expect(email.text).toContain("pipeline de revisão pode estar quebrado");
  });
});
