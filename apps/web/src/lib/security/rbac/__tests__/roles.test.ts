import { describe, it, expect } from "vitest";
import { resolvePermissions, ROLE_PRESETS, type RolePreset } from "../roles";
import { can, dealScopeWhere, type EffectivePermissions } from "../check";
import { PERMISSION } from "../permissions";

function effWithRole(role: string): EffectivePermissions {
  return {
    userId: "u1",
    orgId: "org1",
    role: role as RolePreset,
    customRoleName: null,
    permissions: resolvePermissions(role as RolePreset, null, null),
  };
}

describe("resolvePermissions — role fora do catálogo", () => {
  it('role legado "member" (signup público antigo) resolve como {} sem lançar', () => {
    // Regressão: retornava undefined e can() explodia com TypeError em
    // qualquer página com RBAC (ex.: /pipeline via dealScopeWhere).
    const perms = resolvePermissions("member" as RolePreset, null, null);
    expect(perms).toEqual({});
  });

  it("can() nega tudo pra role desconhecido em vez de lançar", () => {
    const eff = effWithRole("member");
    expect(() => can(eff, PERMISSION.DEAL_VIEW_ALL)).not.toThrow();
    expect(can(eff, PERMISSION.DEAL_VIEW_ALL)).toBe(false);
    expect(can(eff, PERMISSION.DEAL_VIEW_ASSIGNED_ONLY)).toBe(false);
  });

  it("dealScopeWhere pra role desconhecido cai no fail-open documentado ({})", () => {
    // Sem nenhuma chave de view, o escopo de deal mantém a visão org-wide —
    // decisão deliberada do dealScopeWhere (roles antigas não regridem).
    expect(dealScopeWhere(effWithRole("member"))).toEqual({});
  });

  it("orgOverrides não é aplicado sobre role desconhecido", () => {
    const perms = resolvePermissions("member" as RolePreset, null, {
      [PERMISSION.DEAL_VIEW_ALL]: true,
    });
    expect(perms).toEqual({});
  });
});

describe("resolvePermissions — presets conhecidos seguem intactos", () => {
  it("todo preset do catálogo resolve pro seu PermissionMap", () => {
    for (const role of Object.keys(ROLE_PRESETS) as RolePreset[]) {
      expect(resolvePermissions(role, null, null)).toBe(
        ROLE_PRESETS[role as Exclude<RolePreset, "custom">]
      );
    }
  });

  it("custom sem permissions resolve {} (comportamento existente)", () => {
    expect(resolvePermissions("custom", null, null)).toEqual({});
  });
});
