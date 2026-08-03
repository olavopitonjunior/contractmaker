/**
 * Trava de escalada na delegação Bearer.
 *
 * A validação anterior parava em "o alvo é membro da org do dono do token" —
 * que responde ONDE a delegação vale, não QUEM ela pode virar. Com
 * `users:delegate`, um token de serviço apontava pro `owner` do tenant e agia
 * com o poder dele.
 */

import { describe, it, expect } from "vitest";
import { checkDelegationTarget } from "../delegation";
import type { EffectivePermissions } from "../check";
import type { PermissionMap } from "../permissions";
import type { RolePreset } from "../roles";

function efetivo(
  role: RolePreset,
  permissions: PermissionMap
): EffectivePermissions {
  return {
    userId: `u-${role}`,
    orgId: "org-1",
    role,
    customRoleName: null,
    permissions,
  };
}

const LEITURA: PermissionMap = { "deal.view": true } as PermissionMap;
const LEITURA_E_ESCRITA: PermissionMap = {
  "deal.view": true,
  "transfer.create": true,
} as PermissionMap;

describe("checkDelegationTarget", () => {
  it("permite delegar para quem tem as MESMAS permissões", () => {
    const r = checkDelegationTarget(
      efetivo("sales", LEITURA),
      efetivo("sales", LEITURA)
    );

    expect(r.allowed).toBe(true);
  });

  it("permite delegar para quem tem MENOS permissões", () => {
    const r = checkDelegationTarget(
      efetivo("admin", LEITURA_E_ESCRITA),
      efetivo("viewer", LEITURA)
    );

    expect(r.allowed).toBe(true);
  });

  it("recusa quando o alvo pode algo que o dono do token não pode", () => {
    const r = checkDelegationTarget(
      efetivo("viewer", LEITURA),
      efetivo("finance", LEITURA_E_ESCRITA)
    );

    expect(r.allowed).toBe(false);
    if (r.allowed) return;
    expect(r.escalatedPermissions).toContain("transfer.create");
  });

  /**
   * O `owner` é o único papel tratado por NOME. Ele carrega bypasses que não
   * estão no mapa de permissões — transferência de propriedade, por exemplo —,
   * então comparar mapas não o pegaria.
   */
  it("recusa delegar para o owner mesmo com mapas de permissão idênticos", () => {
    const r = checkDelegationTarget(
      efetivo("admin", LEITURA),
      efetivo("owner", LEITURA)
    );

    expect(r.allowed).toBe(false);
    if (r.allowed) return;
    expect(r.reason).toContain("owner");
  });

  it("owner delegando para owner é permitido", () => {
    const r = checkDelegationTarget(
      efetivo("owner", LEITURA),
      efetivo("owner", LEITURA)
    );

    expect(r.allowed).toBe(true);
  });

  /**
   * `false` e ausente são a mesma coisa no PermissionMap. Tratá-los diferente
   * inventaria escalada onde não há — e uma trava que recusa o legítimo seria
   * desligada na primeira reclamação.
   */
  it("permissão explicitamente false não conta como escalada", () => {
    const r = checkDelegationTarget(
      efetivo("sales", { "deal.view": true } as PermissionMap),
      efetivo("sales", {
        "deal.view": true,
        "transfer.create": false,
      } as PermissionMap)
    );

    expect(r.allowed).toBe(true);
  });

  describe("fail-closed", () => {
    it("dono do token sem permissões efetivas na org é recusado", () => {
      const r = checkDelegationTarget(null, efetivo("viewer", LEITURA));

      expect(r.allowed).toBe(false);
    });

    /**
     * Sem membership não há permissão a comparar. Deixar passar seria pior que
     * um 403: delegaria sem checagem nenhuma.
     */
    it("alvo sem permissões efetivas na org é recusado", () => {
      const r = checkDelegationTarget(efetivo("owner", LEITURA_E_ESCRITA), null);

      expect(r.allowed).toBe(false);
    });
  });

  it("trunca a lista de permissões excedentes", () => {
    const muitas: PermissionMap = {};
    for (let i = 0; i < 25; i++) {
      (muitas as Record<string, boolean>)[`perm.${i}`] = true;
    }

    const r = checkDelegationTarget(
      efetivo("viewer", {} as PermissionMap),
      efetivo("admin", muitas)
    );

    expect(r.allowed).toBe(false);
    if (r.allowed) return;
    expect(r.escalatedPermissions).toHaveLength(10);
  });
});
