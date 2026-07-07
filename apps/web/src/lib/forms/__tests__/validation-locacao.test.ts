import { describe, it, expect } from "vitest";
import {
  dadosLocacaoSchema,
  collectLocacaoFinalizeIssues,
} from "../validation-locacao";

const baseValid = {
  locadores: [{ tipo_pessoa: "fisica", nome: "João Locador" }],
  locatarios: [{ tipo_pessoa: "fisica", nome: "Maria Locatária" }],
  imovel: { descricao: "Apartamento de 2 quartos no Centro" },
  aluguel: { valor: 2500 },
};

describe("dadosLocacaoSchema", () => {
  it("aceita locação residencial mínima válida e aplica defaults", () => {
    const parsed = dadosLocacaoSchema.parse(baseValid);
    expect(parsed.aluguel.dia_vencimento).toBe(10);
    expect(parsed.aluguel.indice_reajuste).toBe("IGPM");
    expect(parsed.aluguel.taxa_admin_percent).toBe(10);
    expect(parsed.config?.multa_atraso_percent).toBe(10);
    expect(parsed.config?.juros_mensais_atraso).toBe(1);
  });

  it("aceita garantia por título de capitalização com valor e proposta", () => {
    const res = dadosLocacaoSchema.safeParse({
      ...baseValid,
      garantia: {
        tipo: "titulo_capitalizacao",
        provider: "Porto Seguro Capitalização S.A.",
        titulo_valor: 15000,
        titulo_proposta: "1234567-001",
      },
    });
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data.garantia?.tipo).toBe("titulo_capitalizacao");
      expect(res.data.garantia?.titulo_valor).toBe(15000);
      expect(res.data.garantia?.titulo_proposta).toBe("1234567-001");
    }
  });

  it("exige ao menos 1 locador e 1 locatário", () => {
    expect(
      dadosLocacaoSchema.safeParse({ ...baseValid, locadores: [] }).success
    ).toBe(false);
    expect(
      dadosLocacaoSchema.safeParse({ ...baseValid, locatarios: [] }).success
    ).toBe(false);
  });

  it("rejeita caução acima de 3 aluguéis (art. 38 §2º)", () => {
    const res = dadosLocacaoSchema.safeParse({
      ...baseValid,
      garantia: { tipo: "caucao", caucao_meses: 4 },
    });
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error.issues.some((i) => i.path.includes("caucao_meses"))).toBe(true);
    }
  });

  it("aceita caução de até 3 aluguéis", () => {
    expect(
      dadosLocacaoSchema.safeParse({
        ...baseValid,
        garantia: { tipo: "caucao", caucao_meses: 3 },
      }).success
    ).toBe(true);
  });

  it("exige nome do fiador quando garantia é fiador", () => {
    const semFiador = dadosLocacaoSchema.safeParse({
      ...baseValid,
      garantia: { tipo: "fiador" },
    });
    expect(semFiador.success).toBe(false);

    const comFiador = dadosLocacaoSchema.safeParse({
      ...baseValid,
      garantia: {
        tipo: "fiador",
        fiador: { tipo_pessoa: "fisica", nome: "Carlos Fiador" },
      },
    });
    expect(comFiador.success).toBe(true);
  });

  it("exige descrição do imóvel com >= 10 caracteres", () => {
    expect(
      dadosLocacaoSchema.safeParse({
        ...baseValid,
        imovel: { descricao: "curto" },
      }).success
    ).toBe(false);
  });
});

describe("collectLocacaoFinalizeIssues", () => {
  const finalizeValid = {
    locadores: [{ tipo_pessoa: "fisica", nome: "João Locador", cpf: "39053344705" }],
    locatarios: [{ tipo_pessoa: "fisica", nome: "Maria Locatária" }],
    imovel: {
      descricao: "Apartamento de 2 quartos no Centro",
      rua: "Rua das Flores",
      numero: "100",
      cidade: "São Paulo",
      uf: "SP",
    },
    aluguel: { valor: 2500, vigencia_inicio: "2026-06-01" },
  };

  const paths = (data: Record<string, unknown>) =>
    collectLocacaoFinalizeIssues(data).map((i) => i.path);

  it("não acusa problemas quando tudo preenchido", () => {
    expect(collectLocacaoFinalizeIssues(finalizeValid)).toEqual([]);
  });

  it("exige endereço do imóvel (rua/numero/cidade/uf)", () => {
    const p = paths({ ...finalizeValid, imovel: { descricao: "Apto no Centro térreo" } });
    expect(p).toEqual(
      expect.arrayContaining(["imovel.rua", "imovel.numero", "imovel.cidade", "imovel.uf"])
    );
  });

  it("exige valor de aluguel > 0", () => {
    expect(paths({ ...finalizeValid, aluguel: { valor: 0, vigencia_inicio: "2026-06-01" } })).toContain(
      "aluguel.valor"
    );
  });

  it("exige início de vigência", () => {
    expect(paths({ ...finalizeValid, aluguel: { valor: 2500 } })).toContain(
      "aluguel.vigencia_inicio"
    );
  });

  it("valida formato de CPF quando preenchido", () => {
    const p = paths({
      ...finalizeValid,
      locadores: [{ tipo_pessoa: "fisica", nome: "João Locador", cpf: "11111111111" }],
    });
    expect(p).toContain("locadores.0.cpf");
  });

  it("exige CPF e endereço do fiador quando garantia é fiador", () => {
    const p = paths({
      ...finalizeValid,
      garantia: {
        tipo: "fiador",
        fiador: { tipo_pessoa: "fisica", nome: "Carlos Fiador" },
      },
    });
    expect(p).toEqual(
      expect.arrayContaining(["garantia.fiador.cpf", "garantia.fiador.endereco"])
    );
  });
});
