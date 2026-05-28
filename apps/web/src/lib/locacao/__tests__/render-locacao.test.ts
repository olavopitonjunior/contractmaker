import { describe, it, expect, vi } from "vitest";
import fs from "fs";
import path from "path";

// Unmock handlebars pra testar o render real (o setup global o stuba).
vi.unmock("@/lib/render/handlebars");

import { renderContratoHTML } from "@/lib/render/handlebars";
import { enrichLocacaoData } from "../enrich";
import { dadosLocacaoSchema } from "@/lib/forms/validation-locacao";

function loadTemplate(): string {
  const candidates = [
    path.join(process.cwd(), "..", "..", "templates", "locacao_residencial_v2.hbs"),
    path.join(process.cwd(), "templates", "locacao_residencial_v2.hbs"),
  ];
  for (const c of candidates) if (fs.existsSync(c)) return fs.readFileSync(c, "utf-8");
  throw new Error("template locacao_residencial_v2.hbs não encontrado");
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

describe("template locação residencial + enrich", () => {
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
});
