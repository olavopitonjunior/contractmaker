import { describe, it, expect } from "vitest";
import {
  canAccessDeal,
  dealScopeWhere,
  type EffectivePermissions,
} from "../check";
import { resolvePermissions } from "../roles";
import {
  PERMISSION,
  MANAGER_CONFIGURABLE_PERMISSIONS,
  type PermissionMap,
} from "../permissions";

function eff(
  role: Parameters<typeof resolvePermissions>[0],
  userId = "u1",
  orgId = "org1",
  orgOverrides?: PermissionMap
): EffectivePermissions {
  return {
    userId,
    orgId,
    role,
    customRoleName: null,
    permissions: resolvePermissions(role, null, orgOverrides),
  };
}

describe("dealScopeWhere — escopo do kanban por usuário", () => {
  it("owner/admin/sales (VIEW_ALL) → sem filtro extra ({})", () => {
    expect(dealScopeWhere(eff("owner"))).toEqual({});
    expect(dealScopeWhere(eff("admin"))).toEqual({});
    expect(dealScopeWhere(eff("sales"))).toEqual({});
  });

  it("gerente (VIEW_ASSIGNED_ONLY) → só deals onde é gerente OU criador", () => {
    expect(dealScopeWhere(eff("gerente", "gerA"))).toEqual({
      OR: [{ managerUserId: "gerA" }, { userId: "gerA" }],
    });
  });

  it("custom role SEM nenhuma chave de view → fail-open ({} = status quo org-wide)", () => {
    // CustomRoles gravadas antes da feature não têm as chaves novas; não
    // podem regredir pra visão restrita.
    const legacy: EffectivePermissions = {
      userId: "u1",
      orgId: "org1",
      role: "custom",
      customRoleName: "Legada",
      permissions: { [PERMISSION.CHARGE_VIEW_ALL]: true },
    };
    expect(dealScopeWhere(legacy)).toEqual({});
  });

  it("null (sem membership) → null (caller trata como 403)", () => {
    expect(dealScopeWhere(null)).toBeNull();
  });

  it("VIEW_ALL vence quando as duas chaves coexistem", () => {
    const both: EffectivePermissions = {
      userId: "u1",
      orgId: "org1",
      role: "custom",
      customRoleName: null,
      permissions: {
        [PERMISSION.DEAL_VIEW_ALL]: true,
        [PERMISSION.DEAL_VIEW_ASSIGNED_ONLY]: true,
      },
    };
    expect(dealScopeWhere(both)).toEqual({});
  });
});

describe("canAccessDeal — acesso a um deal específico", () => {
  it("VIEW_ALL acessa deal de qualquer dono", () => {
    expect(
      canAccessDeal({ effective: eff("owner"), ownerUserId: "outro" })
    ).toBe(true);
  });

  it("gerente acessa deal onde é o gerente atribuído", () => {
    const ger = eff("gerente", "gerA");
    expect(
      canAccessDeal({
        effective: ger,
        ownerUserId: "corretorB",
        managerUserId: "gerA",
      })
    ).toBe(true);
  });

  it("gerente acessa deal que ELE criou (mesmo sem estar atribuído)", () => {
    const ger = eff("gerente", "gerA");
    expect(
      canAccessDeal({ effective: ger, ownerUserId: "gerA", managerUserId: null })
    ).toBe(true);
  });

  it("gerente NÃO acessa deal alheio sem atribuição", () => {
    const ger = eff("gerente", "gerA");
    expect(
      canAccessDeal({
        effective: ger,
        ownerUserId: "corretorB",
        managerUserId: "gerB",
      })
    ).toBe(false);
    expect(
      canAccessDeal({
        effective: ger,
        ownerUserId: "corretorB",
        managerUserId: null,
      })
    ).toBe(false);
  });

  it("role sem nenhuma chave de view → fail-open (status quo)", () => {
    expect(
      canAccessDeal({ effective: eff("vistoriador"), ownerUserId: "outro" })
    ).toBe(true);
  });
});

describe("preset gerente + override da org", () => {
  it("base conservadora: vê os atribuídos, acompanha, mas não age", () => {
    const p = resolvePermissions("gerente");
    expect(p[PERMISSION.DEAL_VIEW_ASSIGNED_ONLY]).toBe(true);
    expect(p[PERMISSION.DEAL_EDIT]).toBe(true);
    expect(p[PERMISSION.ENVELOPE_VIEW]).toBe(true);
    expect(p[PERMISSION.DEAL_VIEW_ALL]).toBeUndefined();
    expect(p[PERMISSION.CONTRACT_CREATE]).toBeUndefined();
    expect(p[PERMISSION.ENVELOPE_SEND]).toBeUndefined();
    expect(p[PERMISSION.PROPOSAL_CREATE]).toBeUndefined();
  });

  it("override da org liga ações sem tocar no escopo de view", () => {
    const p = resolvePermissions("gerente", null, {
      [PERMISSION.CONTRACT_CREATE]: true,
      [PERMISSION.ENVELOPE_SEND]: true,
    });
    expect(p[PERMISSION.CONTRACT_CREATE]).toBe(true);
    expect(p[PERMISSION.ENVELOPE_SEND]).toBe(true);
    expect(p[PERMISSION.DEAL_VIEW_ASSIGNED_ONLY]).toBe(true);
    expect(p[PERMISSION.DEAL_VIEW_ALL]).toBeUndefined();
  });

  it("override também DESLIGA da base (gerente read-only)", () => {
    const p = resolvePermissions("gerente", null, {
      [PERMISSION.DEAL_EDIT]: false,
    });
    expect(p[PERMISSION.DEAL_EDIT]).toBe(false);
  });

  it("gerente nasce SEM lease.create (criar locação é opt-in do admin)", () => {
    const p = resolvePermissions("gerente");
    expect(p[PERMISSION.LEASE_VIEW]).toBe(true);
    expect(p[PERMISSION.LEASE_CREATE]).toBeUndefined();
  });

  it("override liga lease.create — destrava POST /api/locacao/forms", () => {
    // Regressão 2026-09-02 (RE/MAX Ativa): o gerente levava 403 ao criar o
    // formulário público de locação e o admin não tinha o checkbox, porque
    // LEASE_CREATE estava fora da whitelist. O escopo de view não muda.
    const p = resolvePermissions("gerente", null, {
      [PERMISSION.LEASE_CREATE]: true,
    });
    expect(p[PERMISSION.LEASE_CREATE]).toBe(true);
    expect(p[PERMISSION.DEAL_VIEW_ASSIGNED_ONLY]).toBe(true);
    expect(p[PERMISSION.DEAL_VIEW_ALL]).toBeUndefined();
  });

  it("gerente mantém deal.create (retrocompat: já criava venda antes do gate)", () => {
    const p = resolvePermissions("gerente");
    expect(p[PERMISSION.DEAL_CREATE]).toBe(true);
  });

  it("admin pode desligar deal.create do gerente pela tela", () => {
    const p = resolvePermissions("gerente", null, {
      [PERMISSION.DEAL_CREATE]: false,
    });
    expect(p[PERMISSION.DEAL_CREATE]).toBe(false);
    expect(MANAGER_CONFIGURABLE_PERMISSIONS).toContain(PERMISSION.DEAL_CREATE);
  });

  it("lease.create é configurável; as demais mutações de locação NÃO são", () => {
    // O lado positivo (LEASE_CREATE presente) só prova algo com o negativo ao
    // lado: as outras chaves de locação seguem fora do alcance do admin.
    expect(MANAGER_CONFIGURABLE_PERMISSIONS).toContain(PERMISSION.LEASE_CREATE);
    expect(MANAGER_CONFIGURABLE_PERMISSIONS).not.toContain(
      PERMISSION.LEASE_TERMINATE
    );
    expect(MANAGER_CONFIGURABLE_PERMISSIONS).not.toContain(
      PERMISSION.PROPERTY_DELETE
    );
    expect(MANAGER_CONFIGURABLE_PERMISSIONS).not.toContain(
      PERMISSION.CREDIT_ANALYSIS_DECIDE
    );
  });

  it("whitelist não contém chaves de view/scope nem org/members", () => {
    expect(MANAGER_CONFIGURABLE_PERMISSIONS).not.toContain(
      PERMISSION.DEAL_VIEW_ALL
    );
    expect(MANAGER_CONFIGURABLE_PERMISSIONS).not.toContain(
      PERMISSION.DEAL_VIEW_ASSIGNED_ONLY
    );
    expect(MANAGER_CONFIGURABLE_PERMISSIONS).not.toContain(
      PERMISSION.ORG_MEMBERS_CHANGE_ROLE
    );
    expect(MANAGER_CONFIGURABLE_PERMISSIONS).not.toContain(
      PERMISSION.TRANSFER_INIT
    );
  });
});

describe("retrocompat dos presets existentes (chaves novas)", () => {
  it("sales mantém operação completa do kanban", () => {
    const p = resolvePermissions("sales");
    expect(p[PERMISSION.DEAL_VIEW_ALL]).toBe(true);
    expect(p[PERMISSION.DEAL_EDIT]).toBe(true);
    expect(p[PERMISSION.CONTRACT_CREATE]).toBe(true);
    expect(p[PERMISSION.ENVELOPE_SEND]).toBe(true);
    expect(p[PERMISSION.DEAL_MANAGER_ASSIGN]).toBe(true);
  });

  it("gestor_locacao mantém operação completa da esteira", () => {
    const p = resolvePermissions("gestor_locacao");
    expect(p[PERMISSION.DEAL_VIEW_ALL]).toBe(true);
    expect(p[PERMISSION.ENVELOPE_SEND]).toBe(true);
  });

  it("viewer/finance mantêm leitura global", () => {
    expect(resolvePermissions("viewer")[PERMISSION.DEAL_VIEW_ALL]).toBe(true);
    expect(resolvePermissions("finance")[PERMISSION.DEAL_VIEW_ALL]).toBe(true);
    expect(
      resolvePermissions("gestor_financeiro")[PERMISSION.DEAL_VIEW_ALL]
    ).toBe(true);
  });

  it("owner/admin herdam as 8 chaves via fullAccess", () => {
    const p = resolvePermissions("admin");
    expect(p[PERMISSION.DEAL_VIEW_ALL]).toBe(true);
    expect(p[PERMISSION.DEAL_MANAGER_ASSIGN]).toBe(true);
    expect(p[PERMISSION.CONTRACT_EDIT]).toBe(true);
  });
});

describe("deal.create — gate das rotas de criação de venda (2026-09-02)", () => {
  // Antes deste gate, `POST /api/forms` e as outras 5 rotas de criação de
  // venda não checavam permissão nenhuma. O par abaixo é o contrato do PR:
  // ninguém que criava perde, e quem não deveria criar para de poder.

  it("QUEM JÁ CRIAVA continua criando (medido em produção)", () => {
    // 85 negócios de venda em prod: 76 admin, 4 owner, 3 gerente, 1 Max.
    // Nenhum criado por viewer, finance ou gestor_financeiro.
    for (const role of ["owner", "admin", "sales", "gerente", "gestor_locacao"] as const) {
      expect(resolvePermissions(role)[PERMISSION.DEAL_CREATE]).toBe(true);
    }
  });

  it("QUEM NÃO DEVERIA criar para de poder — este é o buraco fechado", () => {
    // `viewer` é leitura global com PII mascarada e criava negócio de venda.
    // Sem estas linhas o PR não afirma nada: o lado positivo acima passaria
    // igual se a chave estivesse em todos os presets.
    for (const role of ["viewer", "finance", "gestor_financeiro", "vistoriador", "proprietario", "inquilino"] as const) {
      expect(resolvePermissions(role)[PERMISSION.DEAL_CREATE]).toBeUndefined();
    }
  });

  it("viewer mantém a LEITURA do pipeline — o gate é só de criação", () => {
    const p = resolvePermissions("viewer");
    expect(p[PERMISSION.DEAL_CREATE]).toBeUndefined();
    expect(p[PERMISSION.DEAL_VIEW_ALL]).toBe(true);
  });

  it("deal.create é chave própria, não apelido de deal.edit", () => {
    // finance/viewer não têm nenhuma das duas, mas gestor_financeiro tem
    // DEAL_VIEW_ALL sem DEAL_EDIT — reusar DEAL_EDIT como gate teria dado
    // um resultado diferente e silencioso.
    expect(PERMISSION.DEAL_CREATE).toBe("deal.create");
    expect(PERMISSION.DEAL_CREATE).not.toBe(PERMISSION.DEAL_EDIT);
  });
});
