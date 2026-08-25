import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  DEFAULT_RUN_MAX_USD,
  IngestionAiMeter,
  IngestionCostCapError,
  readAiCostUsd,
  runMaxUsd,
} from "@/lib/ingestion/ai-budget";
import type { StructuredUsage } from "@/lib/ai/shared/anthropic-structured";

function usage(prompt: number, completion = 0): StructuredUsage {
  return {
    promptTokens: prompt,
    completionTokens: completion,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  };
}

function meter(overrides: Partial<ConstructorParameters<typeof IngestionAiMeter>[0]> = {}) {
  return new IngestionAiMeter({
    runId: "run-1",
    orgId: "org-1",
    persist: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  });
}

beforeEach(() => {
  delete process.env.INGESTION_RUN_MAX_USD;
});

describe("teto de custo por run", () => {
  it("usa o default quando a env não está setada ou é lixo", () => {
    expect(runMaxUsd()).toBe(DEFAULT_RUN_MAX_USD);
    process.env.INGESTION_RUN_MAX_USD = "não-é-número";
    expect(runMaxUsd()).toBe(DEFAULT_RUN_MAX_USD);
    process.env.INGESTION_RUN_MAX_USD = "-3";
    expect(runMaxUsd()).toBe(DEFAULT_RUN_MAX_USD);
  });

  it("é lido a cada chamada — a alavanca não pode exigir deploy", () => {
    process.env.INGESTION_RUN_MAX_USD = "0.25";
    expect(runMaxUsd()).toBe(0.25);
  });

  it("interrompe ANTES da chamada seguinte, não depois de estourar", async () => {
    const m = meter({ capUsd: 0.01 });
    expect(() => m.assertWithinCap()).not.toThrow();

    // 1M tokens de input no Opus 4.8 = US$5 — bem acima do teto de 1 centavo.
    await m.record({
      operation: "ingest_plan",
      model: "claude-opus-4-8",
      usage: usage(1_000_000),
      latencyMs: 10,
    });

    expect(m.spentUsd).toBeCloseTo(5, 6);
    expect(m.withinCap()).toBe(false);
    expect(() => m.assertWithinCap()).toThrow(IngestionCostCapError);
  });

  it("a mensagem do estouro diz o teto e o gasto, em português", async () => {
    const m = meter({ capUsd: 0.5 });
    await m.record({
      operation: "ingest_classify",
      model: "claude-haiku-4-5",
      usage: usage(1_000_000),
      latencyMs: 5,
    });
    try {
      m.assertWithinCap();
      expect.unreachable("deveria ter lançado");
    } catch (err) {
      expect(err).toBeInstanceOf(IngestionCostCapError);
      const capErr = err as IngestionCostCapError;
      expect(capErr.code).toBe("INGESTION_COST_CAP");
      expect(capErr.capUsd).toBe(0.5);
      expect(capErr.spentUsd).toBeCloseTo(1, 6);
      expect(capErr.message).toContain("teto de custo");
    }
  });

  it("acumula sobre o que invocações anteriores já gastaram", async () => {
    const persist = vi.fn().mockResolvedValue(undefined);
    const m = meter({ spentUsd: 0.9, capUsd: 1, persist });
    await m.record({
      operation: "ingest_classify",
      model: "claude-haiku-4-5",
      usage: usage(200_000),
      latencyMs: 3,
    });
    expect(m.spentUsd).toBeCloseTo(1.1, 6);
    expect(persist).toHaveBeenCalledWith("run-1", m.spentUsd);
    expect(m.withinCap()).toBe(false);
  });

  it("falha ao persistir não derruba o run — a chamada já foi paga", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const m = meter({ persist: vi.fn().mockRejectedValue(new Error("db fora")) });
    await expect(
      m.record({
        operation: "ingest_plan",
        model: "claude-opus-4-8",
        usage: usage(1_000),
        latencyMs: 1,
      })
    ).resolves.toBeGreaterThan(0);
    expect(m.spentUsd).toBeGreaterThan(0);
    warn.mockRestore();
  });

  it("modelo sem pricing na tabela custaria zero — os IDs da ingestão estão lá", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    for (const model of ["claude-haiku-4-5", "claude-opus-4-8", "claude-opus-5"]) {
      const m = meter();
      const cost = await m.record({
        operation: "ingest_plan",
        model,
        usage: usage(100_000, 1_000),
        latencyMs: 1,
      });
      expect(cost, model).toBeGreaterThan(0);
    }
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("readAiCostUsd", () => {
  it("aceita o Decimal do Prisma, número e null", () => {
    expect(readAiCostUsd(null)).toBe(0);
    expect(readAiCostUsd(undefined)).toBe(0);
    expect(readAiCostUsd(1.25)).toBe(1.25);
    // O Prisma devolve um objeto cujo toString é o número decimal.
    expect(readAiCostUsd({ toString: () => "2.500000" })).toBe(2.5);
  });

  it("valor inválido vira 0 — NaN aqui desligaria o cap em silêncio", () => {
    expect(readAiCostUsd({ toString: () => "não-é-número" })).toBe(0);
    expect(readAiCostUsd(-5)).toBe(0);
  });
});
