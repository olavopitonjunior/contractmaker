import { describe, it, expect } from "vitest";
import { parseEndereco } from "@/lib/forms/extracted-to-form";

/**
 * `parseEndereco` não tinha teste nenhum, e foi exatamente onde o OCR trocou o
 * CEP pelo número do imóvel na sessão com a corretora em 2026-08-25.
 *
 * O caso que quebrava: o prompt do `comprovante_residencia` pede
 * `endereco_completo` E `cep` separados, mas o modelo repete o CEP dentro do
 * endereço. Sem número de porta na string, o primeiro grupo numérico que o
 * regex encontrava era o próprio CEP.
 */
describe("parseEndereco", () => {
  it("separa rua e número quando há número de porta", () => {
    expect(parseEndereco("Rua das Flores, 123 - Centro - São Paulo/SP")).toEqual({
      rua: "Rua das Flores",
      numero: "123",
    });
  });

  it("aceita número com letra (123A)", () => {
    expect(parseEndereco("Av. Paulista, 1000A")).toEqual({
      rua: "Av. Paulista",
      numero: "1000A",
    });
  });

  it("prefere o número de porta ao CEP que vem depois", () => {
    expect(
      parseEndereco("Rua das Flores, 123 - Centro - CEP 01310-100")
    ).toEqual({ rua: "Rua das Flores", numero: "123" });
  });

  it("NÃO grava o CEP mascarado como número quando não há porta", () => {
    const r = parseEndereco("Rua das Flores - Centro - CEP 01310-100");
    expect(r.numero).toBeUndefined();
    expect(r.rua).toBe("Rua das Flores - Centro - CEP 01310-100");
  });

  it("NÃO grava o CEP sem máscara (8 dígitos) como número", () => {
    const r = parseEndereco("Rua Sem Numero, Jardim ABC - 13010000");
    expect(r.numero).toBeUndefined();
  });

  it("NÃO grava a primeira metade do CEP quando ele vem sem o rótulo", () => {
    const r = parseEndereco("Rua das Flores, Centro, 01310-100");
    expect(r.numero).toBeUndefined();
  });

  it("preserva número de porta legítimo de 5 dígitos", () => {
    expect(parseEndereco("Rodovia Raposo Tavares, 99999")).toEqual({
      rua: "Rodovia Raposo Tavares",
      numero: "99999",
    });
  });

  it("não confunde palavra terminada em 'cep' com o rótulo CEP", () => {
    expect(parseEndereco("Rua da Recepcao, 45")).toEqual({
      rua: "Rua da Recepcao",
      numero: "45",
    });
  });

  it("devolve só a rua quando não há número algum", () => {
    expect(parseEndereco("Rua das Flores")).toEqual({ rua: "Rua das Flores" });
  });

  it("devolve objeto vazio para entrada inválida ou em branco", () => {
    expect(parseEndereco("")).toEqual({});
    expect(parseEndereco("   ")).toEqual({});
    expect(parseEndereco(null)).toEqual({});
    expect(parseEndereco(undefined)).toEqual({});
    expect(parseEndereco(42)).toEqual({});
  });
});
