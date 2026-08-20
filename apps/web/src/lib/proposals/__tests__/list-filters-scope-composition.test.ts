import { describe, it, expect } from "vitest";
import { STATUS_FILTERS } from "../list-filters";
import { proposalListWhereForFilter } from "../list-filters.server";
import { proposalScopeWhere } from "@/lib/security/rbac/check";
import { resolvePermissions } from "@/lib/security/rbac/roles";
import type { EffectivePermissions } from "@/lib/security/rbac/check";

/**
 * COMPOSIÇÃO REAL escopo × filtro — o teste positivo que o blacklist de chaves
 * não substitui.
 *
 * page.tsx monta `{ ...scope, kind, ...statusWhere, ... }` por SPREAD. O teste
 * de chaves proibidas (list-filters.test.ts) afirma que nenhum filtro DEVOLVE
 * uma chave perigosa; este aqui exercita o spread de verdade e afirma o que
 * importa no fim: o OR do escopo de VIEW_OWN_ONLY SOBREVIVE à composição, para
 * TODO filtro. Foi exatamente o invariante que o chip "Envio cancelado" quase
 * quebrou em 2026-08-20 (OR do filtro no topo apagava o do escopo e o corretor
 * via a org inteira) — o gate pegou antes do commit; este teste é a rede.
 */
describe("composição { ...scope, ...statusWhere } preserva o escopo do corretor", () => {
  it("STATUS_FILTERS não está vazio — laço vazio não pode passar calado", () => {
    // Os três testes abaixo iteram STATUS_FILTERS; vazio (ou renomeado num
    // refactor), eles passariam sem executar assertion nenhuma.
    expect(STATUS_FILTERS.length).toBeGreaterThan(5);
  });

  function effFor(role: string): EffectivePermissions {
    return {
      orgId: "org-1",
      userId: "corretor-1",
      permissions: resolvePermissions(role) as Record<string, boolean>,
    } as EffectivePermissions;
  }

  it("papel sales (VIEW_OWN_ONLY): o OR do escopo sobrevive a TODOS os filtros", () => {
    const scope = proposalScopeWhere(effFor("sales"));
    expect(scope).not.toBeNull();
    // pré-condição do teste: o escopo do corretor É baseado em OR
    expect((scope as { OR?: unknown[] }).OR).toBeDefined();

    for (const f of STATUS_FILTERS) {
      const composed = {
        ...(scope as object),
        kind: "venda",
        ...proposalListWhereForFilter(f.id),
      } as { orgId?: string; OR?: Array<Record<string, unknown>> };

      expect(composed.orgId, `filtro '${f.id}' perdeu orgId`).toBe("org-1");
      const or = composed.OR ?? [];
      expect(
        or.some((b) => b.userId === "corretor-1"),
        `filtro '${f.id}' perdeu o braço userId do escopo`
      ).toBe(true);
      expect(
        or.some((b) => b.responsibleUserId === "corretor-1"),
        `filtro '${f.id}' perdeu o braço responsibleUserId do escopo`
      ).toBe(true);
    }
  });

  it("papel gerente (deal-restricted): o braço do negócio convertido também sobrevive", () => {
    const scope = proposalScopeWhere(effFor("gerente"));
    for (const f of STATUS_FILTERS) {
      const composed = {
        ...(scope as object),
        ...proposalListWhereForFilter(f.id),
      } as { OR?: Array<Record<string, unknown>> };
      expect(
        (composed.OR ?? []).some((b) => b.convertedDeal !== undefined),
        `filtro '${f.id}' perdeu o braço do gerente`
      ).toBe(true);
    }
  });

  it("admin (VIEW_ALL): escopo é orgId puro e nenhum filtro o remove", () => {
    const scope = proposalScopeWhere(effFor("admin"));
    expect(scope).toEqual({ orgId: "org-1" });
    for (const f of STATUS_FILTERS) {
      const composed = { ...(scope as object), ...proposalListWhereForFilter(f.id) } as {
        orgId?: string;
      };
      expect(composed.orgId, `filtro '${f.id}'`).toBe("org-1");
    }
  });
});
