import { describe, expect, it } from "vitest";
import {
  LOST_STAGE_NAME,
  REOPEN_FALLBACK_BY_KIND,
  TERMINAL_STAGES_BY_KIND,
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
