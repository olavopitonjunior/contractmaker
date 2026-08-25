import { describe, it, expect } from "vitest";
import {
  PLAYBOOKS,
  PLAYBOOK_FAMILIES,
  playbookFamilyForModalidade,
  playbooksForModalidades,
} from "@/lib/ingestion/playbooks";
import {
  ADMINISTRACAO_LOCACAO_MODALIDADE,
  GARANTIA_TIPOS,
  isKnownModalidade,
} from "@/lib/contracts/template-category";
import { CLAUSE_SLOT_KEYS } from "@/lib/templates/clause-slots";

describe("playbooks — resolução de família", () => {
  it("administração tem playbook PRÓPRIO, não cai em locação", () => {
    // A modalidade é de locação para o resto do sistema, mas o instrumento é
    // outro: não tem garantia locatícia e não tem slot.
    expect(playbookFamilyForModalidade(ADMINISTRACAO_LOCACAO_MODALIDADE)).toBe(
      "administracao"
    );
    expect(PLAYBOOKS.administracao.requiresGarantia).toBe(false);
    expect(PLAYBOOKS.administracao.allowedSlots).toEqual([]);
  });

  it("locação, venda e proposta caem em suas famílias", () => {
    expect(playbookFamilyForModalidade("locacao")).toBe("locacao");
    expect(playbookFamilyForModalidade("locacao_comercial")).toBe("locacao");
    expect(playbookFamilyForModalidade("temporada")).toBe("locacao");
    expect(playbookFamilyForModalidade("a_vista")).toBe("venda");
    expect(playbookFamilyForModalidade("financiamento")).toBe("venda");
    expect(playbookFamilyForModalidade("proposta_locacao_residencial")).toBe("proposta");
    expect(playbookFamilyForModalidade("proposta_venda")).toBe("proposta");
  });

  it("modalidade desconhecida ou ausente não inventa família", () => {
    expect(playbookFamilyForModalidade(null)).toBeNull();
    expect(playbookFamilyForModalidade("")).toBeNull();
    expect(playbookFamilyForModalidade("locacao_rural")).toBeNull();
  });

  it("o lote leva só os playbooks das famílias presentes", () => {
    const so = playbooksForModalidades(["locacao", "locacao", null]);
    expect(so.map((p) => p.family)).toEqual(["locacao"]);

    const misto = playbooksForModalidades(["a_vista", "locacao"]);
    // Ordem canônica: o prefixo do prompt é cacheado e não pode variar.
    expect(misto.map((p) => p.family)).toEqual(["locacao", "venda"]);
    expect(playbooksForModalidades(["a_vista", "locacao"]).map((p) => p.family)).toEqual(
      misto.map((p) => p.family)
    );
  });

  it("lote sem modalidade reconhecida recebe TODOS — regra demais > regra nenhuma", () => {
    expect(playbooksForModalidades([null, "x"]).map((p) => p.family)).toEqual([
      ...PLAYBOOK_FAMILIES,
    ]);
  });
});

describe("playbooks — parâmetros e prompt não podem divergir", () => {
  it("toda modalidade declarada é uma modalidade real do sistema", () => {
    for (const family of PLAYBOOK_FAMILIES) {
      for (const m of PLAYBOOKS[family].modalidades) {
        expect(isKnownModalidade(m), `${family}/${m}`).toBe(true);
      }
    }
  });

  it("todo slot declarado é um slot que existe", () => {
    for (const family of PLAYBOOK_FAMILIES) {
      for (const slot of PLAYBOOKS[family].allowedSlots) {
        expect(CLAUSE_SLOT_KEYS).toContain(slot);
      }
    }
  });

  it("só a locação exige garantia — é a regra 1, e ela é da locação", () => {
    const exigem = PLAYBOOK_FAMILIES.filter((f) => PLAYBOOKS[f].requiresGarantia);
    expect(exigem).toEqual(["locacao"]);
  });

  it("o playbook de locação pede no PROMPT o que o guardrail COBRA", () => {
    const p = PLAYBOOKS.locacao;
    expect(p.prompt).toContain("matchCriteria.garantia");
    expect(p.prompt).toContain("provider_in_template");
    expect(p.prompt).toContain("slotBlocks.garantia");
    expect(p.criteriaAxes).toContain("garantia");
  });

  it("o few-shot é o texto REAL do corpus, não um exemplo inventado", () => {
    expect(PLAYBOOKS.locacao.prompt).toContain("PORTO SEGURO CIA. DE SEGUROS GERAIS");
    expect(PLAYBOOKS.locacao.prompt).toContain("FIADOR E DEVEDOR SOLIDÁRIO");
    expect(PLAYBOOKS.locacao.prompt).toContain("TÍTULO DE CAPITALIZAÇÃO");
    // A armadilha do corpus: seguro contra incêndio cita "apólice" em todos.
    expect(PLAYBOOKS.locacao.prompt).toContain("SEGURO CONTRA INCÊNDIO");
  });

  it("nenhum playbook oferece eixo que não existe no domínio", () => {
    for (const family of PLAYBOOK_FAMILIES) {
      for (const axis of PLAYBOOKS[family].criteriaAxes) {
        expect(
          ["garantia", "fiadorPessoa", "pessoa", "admImobiliaria"],
          `${family}/${axis}`
        ).toContain(axis);
      }
    }
  });

  it("os few-shots de garantia usam valores canônicos", () => {
    for (const tipo of ["seguro_fianca", "fiador", "titulo_capitalizacao"]) {
      expect(GARANTIA_TIPOS).toContain(tipo);
      expect(PLAYBOOKS.locacao.prompt).toContain(tipo);
    }
  });
});
