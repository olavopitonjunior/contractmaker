import { describe, it, expect } from "vitest";
import {
  parseBoardFilters,
  boardFiltersWhere,
  hasActiveBoardFilters,
  PERIODO_DAYS,
} from "../list-filters";

const NOW = new Date("2026-08-06T12:00:00Z");

describe("parseBoardFilters", () => {
  it("URL vazia → tudo null, arquivados false", () => {
    const f = parseBoardFilters(undefined);
    expect(f).toEqual({
      q: null,
      responsavel: null,
      sla: null,
      periodo: null,
      canal: null,
      arquivados: false,
    });
    expect(hasActiveBoardFilters(f)).toBe(false);
  });

  it("parseia valores válidos e descarta inválidos (enum-guard)", () => {
    const f = parseBoardFilters({
      q: "  casa  ",
      responsavel: "u1",
      sla: "atrasado",
      periodo: "30d",
      canal: "form_publico",
      arquivados: "1",
    });
    expect(f).toEqual({
      q: "casa",
      responsavel: "u1",
      sla: "atrasado",
      periodo: "30d",
      canal: "form_publico",
      arquivados: true,
    });
    expect(hasActiveBoardFilters(f)).toBe(true);

    const bad = parseBoardFilters({ sla: "xpto", periodo: "1y", canal: "hack" });
    expect(bad.sla).toBeNull();
    expect(bad.periodo).toBeNull();
    expect(bad.canal).toBeNull();
  });

  it("arquivados sozinho NÃO conta como filtro ativo (só amplia)", () => {
    expect(hasActiveBoardFilters(parseBoardFilters({ arquivados: "1" }))).toBe(false);
  });
});

describe("boardFiltersWhere", () => {
  it("default oculta arquivados; arquivados=1 mostra tudo", () => {
    expect(boardFiltersWhere(parseBoardFilters(undefined), NOW)).toEqual({
      archivedAt: null,
    });
    expect(
      boardFiltersWhere(parseBoardFilters({ arquivados: "1" }), NOW)
    ).toEqual({});
  });

  it("q busca em title + clientName (insensitive)", () => {
    const where = boardFiltersWhere(parseBoardFilters({ q: "maria" }), NOW);
    expect(where.OR).toEqual([
      { title: { contains: "maria", mode: "insensitive" } },
      { clientName: { contains: "maria", mode: "insensitive" } },
    ]);
  });

  it("combina responsavel + canal + periodo + sla", () => {
    const where = boardFiltersWhere(
      parseBoardFilters({
        responsavel: "u1",
        canal: "manual",
        periodo: "7d",
        sla: "atencao",
      }),
      NOW
    );
    expect(where.userId).toBe("u1");
    expect(where.sourceChannel).toBe("manual");
    expect(where.createdAt).toEqual({
      gte: new Date(NOW.getTime() - PERIODO_DAYS["7d"] * 86_400_000),
    });
    // Paridade com slaStatusWhere("atencao") — ver sla.test.ts.
    expect(where.slaWarnAt).toEqual({ lt: NOW });
    expect(where.slaDueAt).toEqual({ gte: NOW });
  });
});
