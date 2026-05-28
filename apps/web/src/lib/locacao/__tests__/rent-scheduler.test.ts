import { describe, it, expect } from "vitest";
import {
  competenciaFor,
  dueDateFor,
  rentAmountFor,
} from "../rent-scheduler";

describe("rent-scheduler — funções puras", () => {
  describe("competenciaFor", () => {
    it("formata YYYY-MM com mês zero-padded", () => {
      expect(competenciaFor(new Date(2026, 0, 15))).toBe("2026-01");
      expect(competenciaFor(new Date(2026, 10, 1))).toBe("2026-11");
    });
  });

  describe("dueDateFor", () => {
    it("usa o dia de vencimento na competência", () => {
      const d = dueDateFor("2026-06", 10);
      expect(d.getFullYear()).toBe(2026);
      expect(d.getMonth()).toBe(5); // junho
      expect(d.getDate()).toBe(10);
    });

    it("clampa ao último dia do mês (dia 31 em fevereiro)", () => {
      const fev = dueDateFor("2026-02", 31);
      expect(fev.getMonth()).toBe(1);
      expect(fev.getDate()).toBe(28); // 2026 não é bissexto
    });

    it("clampa dia inválido (0) para 1", () => {
      expect(dueDateFor("2026-06", 0).getDate()).toBe(1);
    });
  });

  describe("rentAmountFor", () => {
    it("separa valor base e encargos", () => {
      expect(rentAmountFor({ valorAluguel: 2500, valorEncargos: 400 })).toEqual({
        valorBase: 2500,
        encargos: 400,
      });
    });

    it("trata valores ausentes como 0", () => {
      expect(
        rentAmountFor({ valorAluguel: NaN as unknown as number, valorEncargos: undefined as unknown as number })
      ).toEqual({ valorBase: 0, encargos: 0 });
    });
  });
});
