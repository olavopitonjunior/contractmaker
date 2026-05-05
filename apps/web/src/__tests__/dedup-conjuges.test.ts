import { describe, it, expect } from "vitest";
import { dedupConjuges } from "@/lib/forms/dedup-conjuges";

describe("dedupConjuges", () => {
  it("removes 2nd comprador when their CPF matches comprador[0].conjuge.cpf", () => {
    const input = {
      compradores: [
        {
          tipo_pessoa: "fisica",
          nome: "Luiz Fernando",
          cpf: "11122233344",
          estado_civil: "Casado(a)",
          conjuge: { nome: "Isabel", cpf: "55566677788", profissao: "" },
        },
        {
          tipo_pessoa: "fisica",
          nome: "Isabel Pereira",
          cpf: "55566677788",
          estado_civil: "Casado(a)",
          profissao: "Médica",
          rg: "12.345.678-9",
        },
      ],
    };
    const out = dedupConjuges(input);
    const compradores = out.compradores as Array<Record<string, unknown>>;
    expect(compradores).toHaveLength(1);
    expect(compradores[0].nome).toBe("Luiz Fernando");
    const conjuge = compradores[0].conjuge as Record<string, unknown>;
    // Campos vazios do cônjuge foram preenchidos a partir da entrada removida
    expect(conjuge.profissao).toBe("Médica");
    expect(conjuge.rg).toBe("12.345.678-9");
    // Nome original do cônjuge não foi sobrescrito
    expect(conjuge.nome).toBe("Isabel");
  });

  it("does not modify when no party matches the conjuge", () => {
    const input = {
      compradores: [
        {
          tipo_pessoa: "fisica",
          nome: "Luiz",
          cpf: "11122233344",
          estado_civil: "Casado(a)",
          conjuge: { nome: "Isabel", cpf: "55566677788" },
        },
        {
          tipo_pessoa: "fisica",
          nome: "Outra Pessoa",
          cpf: "99988877766",
          estado_civil: "Solteiro(a)",
        },
      ],
    };
    const out = dedupConjuges(input);
    const compradores = out.compradores as Array<Record<string, unknown>>;
    expect(compradores).toHaveLength(2);
  });

  it("dedups by normalized name when both CPFs are absent", () => {
    const input = {
      vendedores: [
        {
          tipo_pessoa: "fisica",
          nome: "João Silva",
          estado_civil: "Casado(a)",
          conjuge: { nome: "Maria Silva" },
        },
        {
          tipo_pessoa: "fisica",
          nome: "  maria silva  ",
          estado_civil: "Casado(a)",
          rg: "12345",
        },
      ],
    };
    const out = dedupConjuges(input);
    const vendedores = out.vendedores as Array<Record<string, unknown>>;
    expect(vendedores).toHaveLength(1);
    expect(vendedores[0].nome).toBe("João Silva");
    const conjuge = vendedores[0].conjuge as Record<string, unknown>;
    expect(conjuge.rg).toBe("12345");
  });

  it("does not cross vendedores ↔ compradores", () => {
    const input = {
      vendedores: [
        {
          tipo_pessoa: "fisica",
          nome: "Vendedor A",
          cpf: "11111111111",
          estado_civil: "Casado(a)",
          conjuge: { nome: "Cônjuge X", cpf: "22222222222" },
        },
      ],
      compradores: [
        {
          tipo_pessoa: "fisica",
          nome: "Cônjuge X",
          cpf: "22222222222",
          estado_civil: "Solteiro(a)",
        },
      ],
    };
    const out = dedupConjuges(input);
    const vendedores = out.vendedores as Array<Record<string, unknown>>;
    const compradores = out.compradores as Array<Record<string, unknown>>;
    expect(vendedores).toHaveLength(1);
    // Comprador NÃO foi removido — dedup só roda dentro da mesma lista
    expect(compradores).toHaveLength(1);
  });

  it("ignores non-married parties (no conjuge to match against)", () => {
    const input = {
      compradores: [
        {
          tipo_pessoa: "fisica",
          nome: "Solteiro 1",
          cpf: "11122233344",
          estado_civil: "Solteiro(a)",
        },
        {
          tipo_pessoa: "fisica",
          nome: "Solteiro 2",
          cpf: "55566677788",
          estado_civil: "Solteiro(a)",
        },
      ],
    };
    const out = dedupConjuges(input);
    expect((out.compradores as unknown[])).toHaveLength(2);
  });

  it("preserves CPF/nome when conjuge sub-object had them empty", () => {
    const input = {
      compradores: [
        {
          tipo_pessoa: "fisica",
          nome: "A",
          cpf: "11111111111",
          estado_civil: "Casado(a)",
          conjuge: { cpf: "22222222222" }, // nome vazio
        },
        {
          tipo_pessoa: "fisica",
          nome: "Cônjuge B",
          cpf: "22222222222",
          estado_civil: "Casado(a)",
        },
      ],
    };
    const out = dedupConjuges(input);
    const compradores = out.compradores as Array<Record<string, unknown>>;
    expect(compradores).toHaveLength(1);
    const conjuge = compradores[0].conjuge as Record<string, unknown>;
    expect(conjuge.nome).toBe("Cônjuge B");
    expect(conjuge.cpf).toBe("22222222222");
  });
});
