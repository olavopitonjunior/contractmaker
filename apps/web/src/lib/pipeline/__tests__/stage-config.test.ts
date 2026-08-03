import { describe, expect, it } from "vitest";
import {
  AGING_WARN_DAYS,
  LOST_STAGE_NAME,
  REOPEN_FALLBACK_BY_KIND,
  TERMINAL_STAGES_BY_KIND,
  daysInStage,
  isStaleDeal,
  stageConfigForKind,
} from "../stage-config";

describe("stageConfigForKind", () => {
  it("venda: terminais são Comissão paga + Negócio perdido, fallback Confecção", () => {
    const cfg = stageConfigForKind("venda");
    expect(cfg.terminalStages).toEqual(["Comissão paga", LOST_STAGE_NAME]);
    expect(cfg.reopenFallback).toBe("Confecção de Contrato");
  });

  it("locacao: terminais são ADM + Negócio perdido, fallback Em contrato", () => {
    const cfg = stageConfigForKind("locacao");
    expect(cfg.terminalStages).toEqual(["ADM", LOST_STAGE_NAME]);
    expect(cfg.reopenFallback).toBe("Em contrato");
  });

  it("kind null/undefined/desconhecido cai no comportamento de venda (legado)", () => {
    for (const kind of [null, undefined, "outro_kind"]) {
      const cfg = stageConfigForKind(kind);
      expect(cfg.terminalStages).toEqual(TERMINAL_STAGES_BY_KIND.venda);
      expect(cfg.reopenFallback).toBe(REOPEN_FALLBACK_BY_KIND.venda);
    }
  });
});

const DAY = 86_400_000;
const NOW = Date.parse("2026-08-03T12:00:00Z");

function isoDaysAgo(days: number): string {
  return new Date(NOW - days * DAY).toISOString();
}

describe("daysInStage", () => {
  it("conta dias inteiros desde stageEnteredAt", () => {
    expect(daysInStage(isoDaysAgo(7), isoDaysAgo(30), NOW)).toBe(7);
  });

  it("cai pra createdAt quando stageEnteredAt é null/undefined", () => {
    expect(daysInStage(null, isoDaysAgo(12), NOW)).toBe(12);
    expect(daysInStage(undefined, isoDaysAgo(3), NOW)).toBe(3);
  });

  it("trunca fração de dia pra baixo", () => {
    expect(
      daysInStage(new Date(NOW - 1.9 * DAY).toISOString(), isoDaysAgo(9), NOW)
    ).toBe(1);
  });
});

describe("isStaleDeal", () => {
  const staleDeal = {
    lostAt: null,
    stageEnteredAt: isoDaysAgo(AGING_WARN_DAYS),
    createdAt: isoDaysAgo(30),
  };

  it("parado no limiar exato (>= AGING_WARN_DAYS) é stale", () => {
    expect(isStaleDeal(staleDeal, "Formulário", NOW)).toBe(true);
  });

  it("abaixo do limiar não é stale", () => {
    const fresh = {
      ...staleDeal,
      stageEnteredAt: isoDaysAgo(AGING_WARN_DAYS - 1),
    };
    expect(isStaleDeal(fresh, "Formulário", NOW)).toBe(false);
  });

  it("deal perdido nunca é stale", () => {
    expect(
      isStaleDeal({ ...staleDeal, lostAt: isoDaysAgo(1) }, "Formulário", NOW)
    ).toBe(false);
  });

  it.each(["Comissão paga", "ADM", LOST_STAGE_NAME])(
    "stage terminal %s não envelhece",
    (stage) => {
      expect(isStaleDeal(staleDeal, stage, NOW)).toBe(false);
    }
  );

  it("usa createdAt quando stageEnteredAt é null", () => {
    expect(
      isStaleDeal(
        { lostAt: null, stageEnteredAt: null, createdAt: isoDaysAgo(30) },
        "Formulário",
        NOW
      )
    ).toBe(true);
  });
});
