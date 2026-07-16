import { describe, it, expect } from "vitest";
import {
  canAccessProposal,
  proposalScopeWhere,
  type EffectivePermissions,
} from "../check";
import { resolvePermissions } from "../roles";
import { PERMISSION } from "../permissions";

function eff(
  role: Parameters<typeof resolvePermissions>[0],
  userId = "u1",
  orgId = "org1"
): EffectivePermissions {
  return {
    userId,
    orgId,
    role,
    customRoleName: null,
    permissions: resolvePermissions(role),
  };
}

describe("proposalScopeWhere — o filtro que evita IDOR", () => {
  it("owner/admin (VIEW_ALL) → escopo só por org", () => {
    expect(proposalScopeWhere(eff("owner"))).toEqual({ orgId: "org1" });
    expect(proposalScopeWhere(eff("admin"))).toEqual({ orgId: "org1" });
  });

  it("gestor_locacao (VIEW_ALL) → escopo só por org", () => {
    expect(proposalScopeWhere(eff("gestor_locacao"))).toEqual({ orgId: "org1" });
  });

  it("viewer (VIEW_ALL, leitura) → escopo só por org", () => {
    expect(proposalScopeWhere(eff("viewer"))).toEqual({ orgId: "org1" });
  });

  it("sales/corretor (VIEW_OWN_ONLY) → escopo por org E userId", () => {
    // É a linha que impede o corretor A de listar/exportar as propostas do B.
    expect(proposalScopeWhere(eff("sales", "corretorA"))).toEqual({
      orgId: "org1",
      userId: "corretorA",
    });
  });

  it("role sem permissão de proposta → null (caller trata como 403)", () => {
    // vistoriador não tem nenhuma permissão de proposta.
    expect(proposalScopeWhere(eff("vistoriador"))).toBeNull();
    expect(proposalScopeWhere(null)).toBeNull();
  });
});

describe("canAccessProposal — acesso a uma proposta específica", () => {
  it("VIEW_ALL acessa proposta de qualquer dono", () => {
    expect(
      canAccessProposal({ effective: eff("owner"), ownerUserId: "outro" })
    ).toBe(true);
  });

  it("corretor acessa a própria, não a do colega", () => {
    const corretor = eff("sales", "corretorA");
    expect(
      canAccessProposal({ effective: corretor, ownerUserId: "corretorA" })
    ).toBe(true);
    expect(
      canAccessProposal({ effective: corretor, ownerUserId: "corretorB" })
    ).toBe(false);
  });

  it("role sem permissão nenhuma → false", () => {
    expect(
      canAccessProposal({ effective: eff("vistoriador"), ownerUserId: "u1" })
    ).toBe(false);
  });
});

describe("presets — quem opera propostas", () => {
  it("corretor cria/envia/converte, mas NÃO tem VIEW_ALL", () => {
    const p = resolvePermissions("sales");
    expect(p[PERMISSION.PROPOSAL_CREATE]).toBe(true);
    expect(p[PERMISSION.PROPOSAL_SEND]).toBe(true);
    expect(p[PERMISSION.PROPOSAL_CONVERT]).toBe(true);
    expect(p[PERMISSION.PROPOSAL_VIEW_OWN_ONLY]).toBe(true);
    expect(p[PERMISSION.PROPOSAL_VIEW_ALL]).toBeUndefined();
  });

  it("viewer só lê (VIEW_ALL), não cria nem envia", () => {
    const p = resolvePermissions("viewer");
    expect(p[PERMISSION.PROPOSAL_VIEW_ALL]).toBe(true);
    expect(p[PERMISSION.PROPOSAL_CREATE]).toBeUndefined();
    expect(p[PERMISSION.PROPOSAL_SEND]).toBeUndefined();
  });

  it("owner herda tudo (fullAccess)", () => {
    const p = resolvePermissions("owner");
    expect(p[PERMISSION.PROPOSAL_VIEW_ALL]).toBe(true);
    expect(p[PERMISSION.PROPOSAL_CONVERT]).toBe(true);
  });
});
