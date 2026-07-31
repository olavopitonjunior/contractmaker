/**
 * O escopo de leitura da base de conhecimento é a peça de segurança deste lote:
 * `KnowledgeItem.orgId` virou nullable, e nullable relaxa o isolamento
 * multitenant mais forte do repo. Estes testes travam as duas direções —
 * a plataforma tem que APARECER pra todo mundo, e um tenant NUNCA pode aparecer
 * pra outro — nas duas formas (Prisma e SQL cru), que precisam concordar.
 */

import { describe, it, expect } from "vitest";
import {
  knowledgeScopeWhere,
  knowledgeScopeSql,
  isPlatformItem,
  TENANT_FIRST_ORDER_BY,
} from "../knowledge-scope";
import { assertScopeAllowed } from "../knowledge";

function conditions(where: Record<string, unknown>) {
  return where.AND as Record<string, unknown>[];
}

/** Escopo de org: primeira condição depois da exclusão de categorias não-jurídicas. */
function orgCondition(where: Record<string, unknown>) {
  return conditions(where)[1];
}

describe("knowledgeScopeWhere — escopo de org", () => {
  it("lê a base do tenant E a da plataforma", () => {
    expect(orgCondition(knowledgeScopeWhere("org-1"))).toEqual({
      OR: [{ orgId: "org-1" }, { orgId: null }],
    });
  });

  it("nunca inclui OUTRO tenant", () => {
    const cond = JSON.stringify(knowledgeScopeWhere("org-1"));
    expect(cond).not.toContain("org-2");
  });

  it("orgId null consulta só a plataforma (é o que o /admin usa)", () => {
    expect(orgCondition(knowledgeScopeWhere(null))).toEqual({ orgId: null });
  });

  it("includePlatform:false corta a base universal", () => {
    const where = knowledgeScopeWhere("org-1", {
      ragScope: { includePlatform: false },
    });
    expect(orgCondition(where)).toEqual({ orgId: "org-1" });
  });

  it("includePlatform ausente NÃO corta — omissão não pode tirar alcance", () => {
    const where = knowledgeScopeWhere("org-1", { ragScope: { tags: ["locacao"] } });
    expect(orgCondition(where)).toEqual({
      OR: [{ orgId: "org-1" }, { orgId: null }],
    });
  });
});

describe("knowledgeScopeWhere — filtro por agente", () => {
  it("sem agentKey, não filtra visibilidade", () => {
    expect(conditions(knowledgeScopeWhere("org-1"))).toHaveLength(2);
  });

  it("com agentKey, aceita item sem restrição OU marcado pro agente", () => {
    const and = conditions(knowledgeScopeWhere("org-1", { agentKey: "editor" }));
    expect(and[2]).toEqual({
      OR: [
        { visibleToAgents: { isEmpty: true } },
        { visibleToAgents: { has: "editor" } },
      ],
    });
  });

  it("ragScope restringe categorias e tags", () => {
    const and = conditions(
      knowledgeScopeWhere("org-1", {
        ragScope: { categories: ["clause"], tags: ["locacao"] },
      })
    );
    expect(and).toContainEqual({ category: { in: ["clause"] } });
    expect(and).toContainEqual({ tags: { hasSome: ["locacao"] } });
  });

  it("categories/tags vazios são ignorados (não zeram o resultado)", () => {
    const and = conditions(
      knowledgeScopeWhere("org-1", { ragScope: { categories: [], tags: [] } })
    );
    expect(and).toHaveLength(2);
  });
});

describe("a base de suporte não vaza pro RAG jurídico", () => {
  it("Prisma exclui category=support em qualquer escopo", () => {
    for (const org of ["org-1", null]) {
      expect(conditions(knowledgeScopeWhere(org))[0]).toEqual({
        category: { notIn: ["support"] },
      });
    }
  });

  it("SQL exclui support antes de qualquer outra condição", () => {
    const s = knowledgeScopeSql("org-1", {}, 2);
    expect(s.sql).toContain("category <> ALL($2::text[])");
    expect(s.params[0]).toEqual(["support"]);
  });

  it("a exclusão fica dentro do AND — um `category` do caller não a apaga", () => {
    // É assim que os call-sites usam: {...knowledgeScopeWhere(org), category: "clause"}.
    const where = { ...knowledgeScopeWhere("org-1"), category: "clause" };
    expect(conditions(where)[0]).toEqual({ category: { notIn: ["support"] } });
    expect(where.category).toBe("clause");
  });
});

describe("knowledgeScopeSql — paridade com a versão Prisma", () => {
  it("org + plataforma, parametrizado", () => {
    const s = knowledgeScopeSql("org-1", {}, 2);
    expect(s.sql).toContain(`AND ("orgId" = $3 OR "orgId" IS NULL)`);
    expect(s.params).toEqual([["support"], "org-1"]);
    expect(s.nextParamIndex).toBe(4);
  });

  it("plataforma pura não gasta parâmetro de org", () => {
    const s = knowledgeScopeSql(null, {}, 2);
    expect(s.sql).toContain(`AND "orgId" IS NULL`);
    expect(s.params).toEqual([["support"]]);
    expect(s.nextParamIndex).toBe(3);
  });

  it("numera os params em sequência a partir do índice dado", () => {
    const s = knowledgeScopeSql(
      "org-1",
      { agentKey: "legal", ragScope: { categories: ["rule"], tags: ["venda"] } },
      2
    );
    for (const n of ["$2", "$3", "$4", "$5", "$6"]) {
      expect(s.sql).toContain(n);
    }
    expect(s.params).toEqual([["support"], "org-1", "legal", ["rule"], ["venda"]]);
    expect(s.nextParamIndex).toBe(7);
  });

  it("o valor da org nunca é interpolado no SQL", () => {
    const s = knowledgeScopeSql("org'; DROP TABLE x; --", {});
    expect(s.sql).not.toContain("DROP TABLE");
    expect(s.params[1]).toBe("org'; DROP TABLE x; --");
  });

  it("item sem restrição de agente passa pelo filtro de visibilidade", () => {
    const s = knowledgeScopeSql("org-1", { agentKey: "editor" }, 2);
    expect(s.sql).toContain(`cardinality("visibleToAgents") = 0`);
  });
});

describe("precedência do tenant", () => {
  it("é desempate, não supressão — a ordem primária segue a similaridade", () => {
    expect(TENANT_FIRST_ORDER_BY).toBe(`"orgId" NULLS LAST`);
  });

  it("isPlatformItem distingue as duas origens", () => {
    expect(isPlatformItem({ orgId: null })).toBe(true);
    expect(isPlatformItem({ orgId: "org-1" })).toBe(false);
  });
});

describe("undefined não é escopo — as duas formas falham alto", () => {
  // No Prisma `{ orgId: undefined }` significa SEM FILTRO: a consulta viraria
  // "todos os tenants" em silêncio. A versão SQL falha fechada no mesmo caso;
  // num chokepoint de isolamento, as duas têm que falhar igual.
  const semEscopo = undefined as unknown as string | null;

  it("knowledgeScopeWhere recusa undefined", () => {
    expect(() => knowledgeScopeWhere(semEscopo)).toThrow(/undefined/);
  });

  it("knowledgeScopeSql recusa undefined", () => {
    expect(() => knowledgeScopeSql(semEscopo)).toThrow(/undefined/);
  });

  it("null continua válido — é a plataforma, dita de propósito", () => {
    expect(() => knowledgeScopeWhere(null)).not.toThrow();
    expect(() => knowledgeScopeSql(null)).not.toThrow();
  });
});

describe("guard de escrita", () => {
  it("recusa orgId nulo sem opt-in explícito", () => {
    expect(() => assertScopeAllowed(null, undefined, "create")).toThrow(
      /allowPlatformScope/
    );
  });

  it("aceita quando o caller assume o escopo de plataforma", () => {
    expect(() => assertScopeAllowed(null, true, "create")).not.toThrow();
  });

  it("não interfere na escrita normal de tenant", () => {
    expect(() => assertScopeAllowed("org-1", undefined, "update")).not.toThrow();
  });
});
