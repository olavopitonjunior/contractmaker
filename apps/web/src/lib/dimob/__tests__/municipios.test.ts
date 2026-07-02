import { describe, it, expect } from "vitest";
import {
  allMunicipios,
  findMunicipioByTom,
  searchMunicipios,
} from "../municipios";

describe("municípios TOM (RFB)", () => {
  it("carrega os 5571 municípios com campos válidos", () => {
    const all = allMunicipios();
    expect(all.length).toBe(5571);
    for (const m of all.slice(0, 50)) {
      expect(m.tom).toMatch(/^\d{4}$/);
      expect(m.uf).toMatch(/^[A-Z]{2}$/);
      expect(m.nome.length).toBeGreaterThan(0);
    }
  });

  it("encontra São Paulo pelo código TOM 7107", () => {
    const sp = findMunicipioByTom("7107");
    expect(sp?.nome).toBe("São Paulo");
    expect(sp?.uf).toBe("SP");
  });

  it("aceita TOM sem zero à esquerda", () => {
    expect(findMunicipioByTom("1")?.tom).toBe("0001");
  });

  it("busca por nome prioriza prefixo e filtra por UF", () => {
    const r = searchMunicipios("são paulo", "SP", 5);
    expect(r[0].nome).toBe("São Paulo");
    expect(r.every((m) => m.uf === "SP")).toBe(true);
  });

  it("busca é acento-insensível", () => {
    const r = searchMunicipios("sao paulo", "SP", 3);
    expect(r.some((m) => m.nome === "São Paulo")).toBe(true);
  });

  it("query vazia sem UF devolve nada", () => {
    expect(searchMunicipios("", undefined, 10)).toHaveLength(0);
  });
});
