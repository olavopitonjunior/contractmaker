import { describe, it, expect, vi } from "vitest";
import fs from "fs";
import path from "path";

// Unmock handlebars pra testar o render real (o setup global o stuba).
vi.unmock("@/lib/render/handlebars");

import { renderContratoHTML } from "@/lib/render/handlebars";
import { enrichLocacaoData } from "../enrich";
import {
  dadosLocacaoSchema,
  dadosLocacaoComercialSchema,
} from "@/lib/forms/validation-locacao";

function loadTemplate(filename = "locacao_residencial_v3.hbs"): string {
  const candidates = [
    path.join(process.cwd(), "..", "..", "templates", filename),
    path.join(process.cwd(), "templates", filename),
  ];
  for (const c of candidates) if (fs.existsSync(c)) return fs.readFileSync(c, "utf-8");
  throw new Error(`template ${filename} não encontrado`);
}

const sample = dadosLocacaoSchema.parse({
  locadores: [
    {
      tipo_pessoa: "fisica",
      nome: "João da Silva Locador",
      cpf: "12345678901",
      cidade: "São Paulo",
      uf: "SP",
    },
  ],
  locatarios: [
    {
      tipo_pessoa: "fisica",
      nome: "Maria Souza Locatária",
      cpf: "98765432100",
    },
  ],
  imovel: {
    rua: "Rua das Flores",
    numero: "100",
    cidade: "São Paulo",
    uf: "SP",
    cep: "01234567",
    descricao: "Apartamento de 2 quartos, 1 vaga, no 3º andar.",
  },
  aluguel: {
    valor: 2500,
    encargos: 400,
    dia_vencimento: 10,
    indice_reajuste: "IPCA",
    vigencia_inicio: "2026-06-01",
    vigencia_meses: 30,
    meio_pagamento: "pix",
  },
  garantia: { tipo: "caucao", caucao_meses: 3 },
  assinatura: { cidade: "São Paulo", uf: "SP", data: "2026-05-27" },
});

describe("template locação residencial v3 + enrich", () => {
  const html = renderContratoHTML(loadTemplate(), enrichLocacaoData(sample as Record<string, unknown>));

  it("renderiza sem placeholders Handlebars não resolvidos", () => {
    expect(html).not.toMatch(/\{\{/);
  });

  it("inclui partes, imóvel e valor formatado em BRL", () => {
    expect(html).toContain("João da Silva Locador");
    expect(html).toContain("Maria Souza Locatária");
    expect(html).toContain("Apartamento de 2 quartos");
    expect(html).toContain("R$");
    expect(html).toContain("2.500");
  });

  it("usa o índice de reajuste escolhido (IPCA)", () => {
    expect(html).toContain("IPCA");
  });

  it("renderiza a cláusula de caução (3 aluguéis) e não a de fiador", () => {
    expect(html).toContain("título de caução");
    expect(html).not.toContain("FIADOR(A)");
  });

  it("preenche município e data do fecho via enrich", () => {
    expect(html).toContain("São Paulo/SP");
    expect(html).toMatch(/de maio de 2026/);
  });

  it("foro sem preenchimento usa o fallback 'comarca de localização do imóvel'", () => {
    expect(html).toContain("comarca de localização do imóvel");
  });

  it("multa de atraso default da casa é 10% (modelo NNI)", () => {
    expect(html).toContain("10% (dez por cento)");
  });

  it("sem administradora usa o fallback genérico e omite a cláusula de boleto consolidado", () => {
    expect(html).toContain("diretamente ao(s) LOCADOR(ES) ou a quem este(s) indicar(em)");
    expect(html).not.toContain("ADMINISTRADORA juntamente com o valor do aluguel");
  });

  it("inclui as cláusulas fixas do modelo NNI (seguro incêndio 100x, honorários 20%)", () => {
    expect(html).toContain("100 (cem) vezes o valor do aluguel");
    expect(html).toContain("20% (vinte por cento)");
  });
});

describe("template locação residencial v3 — administradora + título de capitalização", () => {
  const data = dadosLocacaoSchema.parse({
    ...sample,
    garantia: {
      tipo: "titulo_capitalizacao",
      provider: "Porto Seguro Capitalização S.A.",
      titulo_valor: 15000,
      titulo_proposta: "1234567-001",
    },
  });
  const enriched = enrichLocacaoData(data as Record<string, unknown>, {
    administradora: {
      nome: "Imobiliária Exemplo Ltda",
      creci: "24.342-J/SP",
      endereco: "Rua Roque Petrella, 188, São Paulo/SP",
    },
  });
  const html = renderContratoHTML(loadTemplate(), enriched);

  it("renderiza sem placeholders não resolvidos", () => {
    expect(html).not.toMatch(/\{\{/);
  });

  it("nomeia a administradora com CRECI e sede na cláusula de pagamento", () => {
    expect(html).toContain("Imobiliária Exemplo Ltda");
    expect(html).toContain("CRECI sob nº 24.342-J/SP");
    expect(html).toContain("Rua Roque Petrella, 188");
    expect(html).toContain("administração da presente locação");
  });

  it("com administradora inclui IPTU/condomínio no mesmo boleto (9.1.2/9.1.3)", () => {
    expect(html).toContain("ADMINISTRADORA juntamente com o valor do aluguel");
    expect(html).toContain("pagos a vencer");
  });

  it("renderiza a garantia por título de capitalização (8.1–8.6)", () => {
    expect(html).toContain("Título de Capitalização");
    expect(html).toContain("15.000");
    expect(html).toContain("Porto Seguro Capitalização S.A.");
    expect(html).toContain("proposta/formulário nº 1234567-001");
    expect(html).toContain("REAPLICAR");
    expect(html).toContain("15 (quinze) dias de antecedência");
    expect(html).toContain("documento rescisório");
    expect(html).toContain("resgatar o(s) Título(s) caucionado(s)");
    expect(html).toContain("prestação de contas");
    expect(html).toContain("art. 37, II, da Lei nº 8.245/91");
  });

  it("garantia capitalização não renderiza os ramos de fiador/caução", () => {
    expect(html).not.toContain("benefício de ordem");
    expect(html).not.toContain("título de caução");
  });
});

describe("template locação comercial v3", () => {
  const data = dadosLocacaoComercialSchema.parse({
    ...sample,
    imovel: {
      kind: "comercial_sala",
      rua: "Rua Augusta",
      numero: "1200",
      cidade: "São Paulo",
      uf: "SP",
      cep: "01304001",
      descricao: "Loja com vitrine e mezanino.",
      destinacao: "comércio varejista de vestuário",
    },
    garantia: { tipo: "fiador", fiador: { tipo_pessoa: "fisica", nome: "Fulano Fiador" } },
  });
  const html = renderContratoHTML(
    loadTemplate("locacao_comercial_v3.hbs"),
    enrichLocacaoData(data as Record<string, unknown>)
  );

  it("renderiza sem placeholders não resolvidos", () => {
    expect(html).not.toMatch(/\{\{/);
  });

  it("usa a destinação comercial e a cláusula de ação renovatória", () => {
    expect(html).toContain("comércio varejista de vestuário");
    expect(html).toContain("AÇÃO RENOVATÓRIA");
    expect(html).toContain("art. 56");
  });

  it("regressão: ramo de fiador continua funcionando", () => {
    expect(html).toContain("FIADOR(A)");
    expect(html).toContain("Fulano Fiador");
    expect(html).toContain("benefício de ordem");
  });
});

describe("enrich locação: tipo do imóvel e foro (correções QA 2026-06-06)", () => {
  const base = dadosLocacaoSchema.parse({
    locadores: [{ tipo_pessoa: "fisica", nome: "Loc", cpf: "12345678901" }],
    locatarios: [{ tipo_pessoa: "fisica", nome: "Lct", cpf: "98765432100" }],
    imovel: {
      kind: "comercial_sala",
      rua: "Rua Augusta",
      numero: "1200",
      cidade: "São Paulo",
      uf: "SP",
      cep: "01304001",
      descricao: "Loja com vitrine.",
    },
    aluguel: {
      valor: 8000,
      dia_vencimento: 5,
      indice_reajuste: "IPCA",
      vigencia_inicio: "2026-08-01",
      vigencia_meses: 60,
      meio_pagamento: "boleto",
    },
    garantia: { tipo: "seguro_fianca" },
    assinatura: { cidade: "São Paulo", uf: "SP", data: "2026-06-06" },
    foro: "São Paulo",
  });

  it("mapeia kind do enum para rótulo legível (comercial_sala → sala comercial)", () => {
    const enriched = enrichLocacaoData(base as Record<string, unknown>);
    const imovel = enriched.imovel as Record<string, unknown>;
    expect(imovel.tipo_texto).toBe("sala comercial");
  });

  it("propaga o foro eleito para config.foro_texto", () => {
    const enriched = enrichLocacaoData(base as Record<string, unknown>);
    const config = enriched.config as Record<string, unknown>;
    expect(config.foro_texto).toBe("São Paulo");
  });

  it("renderiza o tipo legível e o foro eleito no contrato (não o slug nem o fallback)", () => {
    const html = renderContratoHTML(loadTemplate(), enrichLocacaoData(base as Record<string, unknown>));
    expect(html).toContain("imóvel de tipo sala comercial");
    expect(html).not.toContain("comercial_sala");
    expect(html).toContain("comarca de São Paulo");
    expect(html).not.toContain("comarca de localização do imóvel");
  });
});
