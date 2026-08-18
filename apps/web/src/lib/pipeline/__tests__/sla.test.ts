import { describe, it, expect } from "vitest";
import { slaStatusFrom, slaStatusWhere } from "../sla";

const NOW = new Date("2026-08-06T12:00:00Z");
const NOW_MS = NOW.getTime();
const h = (hours: number) => new Date(NOW_MS + hours * 3600_000);

describe("slaStatusFrom", () => {
  it("sem deadlines → null (terminal/desabilitado/pré-backfill)", () => {
    expect(slaStatusFrom({ slaWarnAt: null, slaDueAt: null }, NOW_MS)).toBeNull();
  });

  it("dentro do prazo → em_dia", () => {
    expect(
      slaStatusFrom({ slaWarnAt: h(24), slaDueAt: h(48) }, NOW_MS)
    ).toBe("em_dia");
  });

  it("warn vencido mas due no futuro → atencao", () => {
    expect(
      slaStatusFrom({ slaWarnAt: h(-2), slaDueAt: h(48) }, NOW_MS)
    ).toBe("atencao");
  });

  it("due vencido → atrasado (independe do warn)", () => {
    expect(
      slaStatusFrom({ slaWarnAt: h(-48), slaDueAt: h(-1) }, NOW_MS)
    ).toBe("atrasado");
  });

  it("aceita ISO string (DTO do card) igual a Date", () => {
    expect(
      slaStatusFrom(
        { slaWarnAt: h(-2).toISOString(), slaDueAt: h(48).toISOString() },
        NOW_MS
      )
    ).toBe("atencao");
  });
});

describe("slaStatusWhere — paridade com slaStatusFrom", () => {
  it("atrasado: slaDueAt < now", () => {
    expect(slaStatusWhere("atrasado", NOW)).toEqual({ slaDueAt: { lt: NOW } });
  });

  it("atencao: slaWarnAt < now E slaDueAt >= now", () => {
    expect(slaStatusWhere("atencao", NOW)).toEqual({
      slaWarnAt: { lt: NOW },
      slaDueAt: { gte: NOW },
    });
  });

  it("em_dia: slaWarnAt >= now (sem-SLA fica fora, como o null da função pura)", () => {
    expect(slaStatusWhere("em_dia", NOW)).toEqual({ slaWarnAt: { gte: NOW } });
  });
});
