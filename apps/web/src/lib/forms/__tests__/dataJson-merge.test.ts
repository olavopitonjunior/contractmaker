import { describe, it, expect } from "vitest";
import { deepMergeAtPaths } from "../dataJson-merge";

describe("deepMergeAtPaths", () => {
  describe("merge de chaves disjuntas (race condition vendedor x comprador)", () => {
    it("escrita em chave nova preserva chave existente em raiz oposta", () => {
      const current = { vendedores: [{ nome: "João" }] };
      const incoming = { compradores: [{ nome: "Maria" }] };
      const { merged } = deepMergeAtPaths(current, incoming);
      expect(merged).toEqual({
        vendedores: [{ nome: "João" }],
        compradores: [{ nome: "Maria" }],
      });
    });

    it("dois PATCHes consecutivos em raízes disjuntas não sobrescrevem", () => {
      let state: Record<string, unknown> = {};
      state = deepMergeAtPaths(state, { vendedores: [{ nome: "João" }] }).merged;
      state = deepMergeAtPaths(state, { compradores: [{ nome: "Maria" }] }).merged;
      expect(state).toEqual({
        vendedores: [{ nome: "João" }],
        compradores: [{ nome: "Maria" }],
      });
    });
  });

  describe("undefined/null não apaga chave existente", () => {
    it("undefined skipa", () => {
      const current = { vendedores: [{ nome: "João" }] };
      const incoming = { vendedores: undefined } as unknown as Record<string, unknown>;
      const { merged } = deepMergeAtPaths(current, incoming);
      expect(merged).toEqual({ vendedores: [{ nome: "João" }] });
    });

    it("null skipa (auto-save robustez)", () => {
      const current = { vendedores: [{ nome: "João" }] };
      const incoming = { vendedores: null } as unknown as Record<string, unknown>;
      const { merged } = deepMergeAtPaths(current, incoming);
      expect(merged).toEqual({ vendedores: [{ nome: "João" }] });
    });
  });

  describe("arrays substituem inteiros (usuário remove item)", () => {
    it("array com 1 item substitui array com 2 itens", () => {
      const current = {
        compradores: [{ nome: "Maria" }, { nome: "Pedro" }],
      };
      const incoming = { compradores: [{ nome: "Maria" }] };
      const { merged } = deepMergeAtPaths(current, incoming);
      expect(merged.compradores).toEqual([{ nome: "Maria" }]);
    });

    it("array vazio substitui (limpa testemunhas)", () => {
      const current = { testemunhas: [{ nome: "T1" }, { nome: "T2" }] };
      const incoming = { testemunhas: [] };
      const { merged } = deepMergeAtPaths(current, incoming);
      expect(merged.testemunhas).toEqual([]);
    });
  });

  describe("merge profundo em plain objects", () => {
    it("preserva subchaves não tocadas em objects aninhados", () => {
      const current = {
        pagamento: { valor_total: 100000, sinal_arras: 10000 },
      };
      const incoming = {
        pagamento: { sinal_arras: 20000 },
      };
      const { merged } = deepMergeAtPaths(current, incoming);
      expect(merged.pagamento).toEqual({
        valor_total: 100000,
        sinal_arras: 20000,
      });
    });

    it("merge recursivo em 3 níveis", () => {
      const current = {
        comissao: { comissionados: { x: 1 } },
      };
      const incoming = {
        comissao: { comissionados: { y: 2 } },
      };
      const { merged } = deepMergeAtPaths(current, incoming);
      expect(merged.comissao).toEqual({ comissionados: { x: 1, y: 2 } });
    });
  });

  describe("allowlist (subtoken por role)", () => {
    it("rejeita chave fora da allowlist e adiciona em rejectedPaths", () => {
      const current = {
        vendedores: [{ nome: "João" }],
        compradores: [{ nome: "Maria" }],
      };
      const incoming = {
        vendedores: [{ nome: "João editado" }],
        compradores: [{ nome: "Maria HACK" }],
      };
      const { merged, rejectedPaths } = deepMergeAtPaths(current, incoming, [
        "vendedores",
      ]);
      expect(merged).toEqual({
        vendedores: [{ nome: "João editado" }],
        compradores: [{ nome: "Maria" }],
      });
      expect(rejectedPaths).toEqual(["compradores"]);
    });

    it("allowlist vazia rejeita tudo", () => {
      const current = { vendedores: [{ nome: "João" }] };
      const incoming = { vendedores: [{ nome: "HACK" }] };
      const { merged, rejectedPaths } = deepMergeAtPaths(current, incoming, []);
      expect(merged).toEqual({ vendedores: [{ nome: "João" }] });
      expect(rejectedPaths).toEqual(["vendedores"]);
    });

    it("allowlist só nível top — sub-chaves dentro de allowed não são filtradas", () => {
      const current = {
        vendedores: [{ nome: "João", cpf: "111" }],
      };
      const incoming = {
        vendedores: [{ nome: "João", cpf: "222", apelido: "Jô" }],
      };
      const { merged, rejectedPaths } = deepMergeAtPaths(current, incoming, [
        "vendedores",
      ]);
      expect(merged.vendedores).toEqual([
        { nome: "João", cpf: "222", apelido: "Jô" },
      ]);
      expect(rejectedPaths).toEqual([]);
    });
  });

  describe("edge cases", () => {
    it("current vazio aceita tudo de incoming", () => {
      const { merged } = deepMergeAtPaths({}, { vendedores: [{ nome: "x" }] });
      expect(merged).toEqual({ vendedores: [{ nome: "x" }] });
    });

    it("incoming vazio preserva current", () => {
      const { merged } = deepMergeAtPaths({ a: 1 }, {});
      expect(merged).toEqual({ a: 1 });
    });

    it("primitivos substituem", () => {
      const { merged } = deepMergeAtPaths({ x: "old" }, { x: "new" });
      expect(merged.x).toBe("new");
    });

    it("tipo muda de object pra primitive: incoming vence", () => {
      const { merged } = deepMergeAtPaths(
        { x: { y: 1 } },
        { x: "agora é string" },
      );
      expect(merged.x).toBe("agora é string");
    });

    it("tipo muda de primitive pra object: incoming vence", () => {
      const { merged } = deepMergeAtPaths({ x: "string" }, { x: { y: 1 } });
      expect(merged.x).toEqual({ y: 1 });
    });

    it("tipo muda de object pra array: incoming substitui inteiro", () => {
      const { merged } = deepMergeAtPaths({ x: { a: 1 } }, { x: [1, 2] });
      expect(merged.x).toEqual([1, 2]);
    });

    it("não muta o input current", () => {
      const current = { vendedores: [{ nome: "João" }] };
      const before = JSON.stringify(current);
      deepMergeAtPaths(current, { compradores: [{ nome: "Maria" }] });
      expect(JSON.stringify(current)).toBe(before);
    });
  });
});
