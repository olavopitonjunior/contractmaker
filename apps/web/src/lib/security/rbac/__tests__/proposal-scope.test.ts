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

  it("sales/corretor (VIEW_OWN_ONLY) → escopo por org E (criador OU responsável)", () => {
    // Impede o corretor A de ver as do B, mas inclui as que lhe foram atribuídas.
    expect(proposalScopeWhere(eff("sales", "corretorA"))).toEqual({
      orgId: "org1",
      OR: [{ userId: "corretorA" }, { responsibleUserId: "corretorA" }],
    });
  });

  it("gerente (VIEW_OWN_ONLY + deals restritos) → ganha o braço do deal convertido", () => {
    // Sem isso, a proposta que o gerente converteu em negócio dele sumiria da
    // lista assim que outro corretor fosse o criador/responsável.
    expect(proposalScopeWhere(eff("gerente", "g1"))).toEqual({
      orgId: "org1",
      OR: [
        { userId: "g1" },
        { responsibleUserId: "g1" },
        { convertedDeal: { managerUserId: "g1" } },
      ],
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

  it("corretor acessa proposta em que é o RESPONSÁVEL (mesmo não sendo o criador)", () => {
    const corretor = eff("sales", "corretorA");
    expect(
      canAccessProposal({
        effective: corretor,
        ownerUserId: "corretorB",
        responsibleUserId: "corretorA",
      })
    ).toBe(true);
    expect(
      canAccessProposal({
        effective: corretor,
        ownerUserId: "corretorB",
        responsibleUserId: "corretorC",
      })
    ).toBe(false);
  });

  it("gerente acessa proposta convertida no negócio em que é o gerente", () => {
    const gerente = eff("gerente", "g1");
    expect(
      canAccessProposal({
        effective: gerente,
        ownerUserId: "corretorB",
        convertedDealManagerUserId: "g1",
      })
    ).toBe(true);
    expect(
      canAccessProposal({
        effective: gerente,
        ownerUserId: "corretorB",
        convertedDealManagerUserId: "g2",
      })
    ).toBe(false);
  });

  it("corretor NÃO ganha o braço do deal convertido (não tem visão restrita)", () => {
    // O braço é exclusivo de quem é restricted em DEALS; pro corretor o campo
    // é ignorado — senão qualquer um viraria dono da proposta pelo deal.
    expect(
      canAccessProposal({
        effective: eff("sales", "corretorA"),
        ownerUserId: "corretorB",
        convertedDealManagerUserId: "corretorA",
      })
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
    expect(p[PERMISSION.PROPOSAL_DELETE]).toBe(true);
  });

  it("corretor cancela/reenvia/atribui, mas NÃO exclui (destrutivo)", () => {
    const p = resolvePermissions("sales");
    expect(p[PERMISSION.PROPOSAL_CANCEL]).toBe(true);
    expect(p[PERMISSION.PROPOSAL_RESEND]).toBe(true);
    expect(p[PERMISSION.PROPOSAL_ASSIGN]).toBe(true);
    expect(p[PERMISSION.PROPOSAL_DELETE]).toBeUndefined();
  });

  it("gestor_locacao pode excluir e atribuir", () => {
    const p = resolvePermissions("gestor_locacao");
    expect(p[PERMISSION.PROPOSAL_DELETE]).toBe(true);
    expect(p[PERMISSION.PROPOSAL_ASSIGN]).toBe(true);
  });
});
