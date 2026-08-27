import { describe, it, expect } from "vitest";
import {
  DEFAULT_GARANTIA_OPTIONS,
  TIPOS_COM_GARANTIDOR,
  providersForTipo,
  tipoTemGarantidor,
  type GarantiaOptionLike,
} from "../garantia-catalog";
import { GARANTIA_TIPOS } from "@/lib/contracts/template-category";

describe("TIPOS_COM_GARANTIDOR", () => {
  it("são os três tipos com prestadora — e todos existem na taxonomia fixa", () => {
    expect(TIPOS_COM_GARANTIDOR).toEqual([
      "seguro_fianca",
      "garantia_onerosa",
      "titulo_capitalizacao",
    ]);
    for (const t of TIPOS_COM_GARANTIDOR) {
      expect(GARANTIA_TIPOS).toContain(t);
    }
  });

  it("tipoTemGarantidor: fiador/caução/própria/sem garantia não têm prestadora", () => {
    expect(tipoTemGarantidor("seguro_fianca")).toBe(true);
    expect(tipoTemGarantidor("fiador")).toBe(false);
    expect(tipoTemGarantidor("sem_garantia")).toBe(false);
    expect(tipoTemGarantidor(null)).toBe(false);
  });
});

describe("providersForTipo", () => {
  const catalogo: GarantiaOptionLike[] = [
    { tipo: "seguro_fianca", provider: "Porto Seguro", position: 1 },
    { tipo: "seguro_fianca", provider: "Tokio Marine", position: 0 },
    { tipo: "seguro_fianca", provider: "Desativada", position: 2, active: false },
    { tipo: "garantia_onerosa", provider: "Loft", position: 0 },
    { tipo: "garantia_onerosa", provider: "CredPago", position: 0 },
  ];

  it("só as ATIVAS do tipo, ordenadas por position (empate: alfabética)", () => {
    expect(providersForTipo(catalogo, "seguro_fianca")).toEqual([
      "Tokio Marine",
      "Porto Seguro",
    ]);
    expect(providersForTipo(catalogo, "garantia_onerosa")).toEqual([
      "CredPago",
      "Loft",
    ]);
  });

  it("tipo sem prestadora cadastrada → lista vazia (form cai no texto livre)", () => {
    expect(providersForTipo(catalogo, "titulo_capitalizacao")).toEqual([]);
  });

  it("tipo fora da taxonomia ou catálogo nulo → lista vazia", () => {
    expect(providersForTipo(catalogo, "inventado")).toEqual([]);
    expect(providersForTipo(null, "seguro_fianca")).toEqual([]);
    expect(providersForTipo(undefined, "seguro_fianca")).toEqual([]);
  });

  it("dedup e limpeza: provider repetido/vazio/whitespace não entram", () => {
    expect(
      providersForTipo(
        [
          { tipo: "seguro_fianca", provider: "Too", position: 0 },
          { tipo: "seguro_fianca", provider: "Too", position: 1 },
          { tipo: "seguro_fianca", provider: "  ", position: 2 },
        ],
        "seguro_fianca",
      ),
    ).toEqual(["Too"]);
  });

  it("defaults da plataforma: as 4 seguradoras de seguro-fiança, na ordem", () => {
    expect(providersForTipo(DEFAULT_GARANTIA_OPTIONS, "seguro_fianca")).toEqual([
      "Tokio Marine",
      "Porto Seguro",
      "Pottencial",
      "Too",
    ]);
  });
});
