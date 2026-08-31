/**
 * Quem aprova/reprova acesso de usuário.
 *
 * Antes, só os e-mails de `INVITE_APPROVER_EMAILS` decidiam — o perfil de
 * administrador ganhava o botão em lugar nenhum, e um convite ficava pendente
 * até o aprovador designado aparecer. Agora a permissão `org.members.approve`
 * (presets `owner` e `admin`) decide, e a allowlist de env continua valendo
 * como porta de emergência.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma } from "@/lib/db/prisma";
import {
  canApproveInvitations,
  canGrantRole,
  getOrgApproverEmails,
  isApprover,
} from "@/lib/auth/invitations";
import { PERMISSION } from "@/lib/security/rbac/permissions";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const p = prisma as any;

const ORG = "org-1";
const ENV_APPROVER = "aprovador@exemplo.com";

/** Faz `getEffectivePermissions` resolver esta membership. */
function membership(role: string, customPermissions?: Record<string, boolean>) {
  p.orgMembership.findUnique.mockResolvedValue({
    role,
    customRole: customPermissions ? { permissions: customPermissions } : null,
  });
}

const originalEnv = process.env.INVITE_APPROVER_EMAILS;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.INVITE_APPROVER_EMAILS = ENV_APPROVER;
});

afterEach(() => {
  if (originalEnv === undefined) delete process.env.INVITE_APPROVER_EMAILS;
  else process.env.INVITE_APPROVER_EMAILS = originalEnv;
});

describe("canApproveInvitations", () => {
  it("libera o perfil de administrador, que não está na allowlist de env", async () => {
    membership("admin");

    await expect(
      canApproveInvitations({
        userId: "u-admin",
        orgId: ORG,
        email: "admin@imobiliaria.com",
      })
    ).resolves.toBe(true);
  });

  it("libera o owner", async () => {
    membership("owner");

    await expect(
      canApproveInvitations({
        userId: "u-owner",
        orgId: ORG,
        email: "owner@imobiliaria.com",
      })
    ).resolves.toBe(true);
  });

  it.each(["sales", "finance", "viewer"])(
    "recusa o preset %s",
    async (role) => {
      membership(role);

      await expect(
        canApproveInvitations({
          userId: "u-1",
          orgId: ORG,
          email: "pessoa@imobiliaria.com",
        })
      ).resolves.toBe(false);
    }
  );

  it("recusa `member`, o role legado do signup público — resolve como sem permissões", async () => {
    membership("member");

    await expect(
      canApproveInvitations({
        userId: "u-legado",
        orgId: ORG,
        email: "legado@imobiliaria.com",
      })
    ).resolves.toBe(false);
  });

  it("libera CustomRole que carregue org.members.approve", async () => {
    membership("custom", { [PERMISSION.ORG_MEMBERS_APPROVE]: true });

    await expect(
      canApproveInvitations({
        userId: "u-custom",
        orgId: ORG,
        email: "custom@imobiliaria.com",
      })
    ).resolves.toBe(true);
  });

  it("recusa CustomRole sem a chave", async () => {
    membership("custom", { [PERMISSION.ORG_MEMBERS_INVITE]: true });

    await expect(
      canApproveInvitations({
        userId: "u-custom",
        orgId: ORG,
        email: "custom@imobiliaria.com",
      })
    ).resolves.toBe(false);
  });

  it("mantém a allowlist de env mesmo sem membership na org — a porta de emergência", async () => {
    p.orgMembership.findUnique.mockResolvedValue(null);

    await expect(
      canApproveInvitations({
        userId: "u-ops",
        orgId: ORG,
        email: ENV_APPROVER,
      })
    ).resolves.toBe(true);
    // Curto-circuito: nem consulta a membership.
    expect(p.orgMembership.findUnique).not.toHaveBeenCalled();
  });

  it("recusa quem não é membro nem está na allowlist", async () => {
    p.orgMembership.findUnique.mockResolvedValue(null);

    await expect(
      canApproveInvitations({
        userId: "u-estranho",
        orgId: ORG,
        email: "estranho@exemplo.com",
      })
    ).resolves.toBe(false);
  });

  it("recusa sessão sem e-mail e sem membership", async () => {
    p.orgMembership.findUnique.mockResolvedValue(null);

    await expect(
      canApproveInvitations({ userId: "u-1", orgId: ORG, email: null })
    ).resolves.toBe(false);
  });

  // Sob "trocar de tenant", userId/email são os do DONO do tenant. A allowlist
  // é gate de PLATAFORMA, então comparar contra o e-mail do cliente nunca casa
  // — a porta de emergência ficava soldada exatamente sob impersonação.
  describe("sob impersonation", () => {
    it("casa a allowlist pelo admin REAL, não pelo dono do tenant", async () => {
      // Dono sem a permissão: é o caso que só a allowlist recupera.
      membership("viewer");

      await expect(
        canApproveInvitations({
          userId: "owner-do-tenant",
          orgId: ORG,
          email: "dono@remaxtrio.com",
          impersonatedByEmail: ENV_APPROVER,
        })
      ).resolves.toBe(true);
    });

    it("recusa quando nem o admin real está na allowlist nem o ator tem permissão", async () => {
      membership("viewer");

      await expect(
        canApproveInvitations({
          userId: "owner-do-tenant",
          orgId: ORG,
          email: "dono@remaxtrio.com",
          impersonatedByEmail: "outro-admin@exemplo.com",
        })
      ).resolves.toBe(false);
    });

    it("o e-mail do dono NÃO é consultado quando há impersonação", async () => {
      membership("viewer");

      // O dono está na allowlist, o impersonador não. Quem decide é o humano
      // que agiu — o impersonador —, então isto recusa.
      await expect(
        canApproveInvitations({
          userId: "owner-do-tenant",
          orgId: ORG,
          email: ENV_APPROVER,
          impersonatedByEmail: "nao-aprovador@exemplo.com",
        })
      ).resolves.toBe(false);
    });

    it("cai no ramo RBAC quando o dono do tenant tem a permissão", async () => {
      membership("owner");

      await expect(
        canApproveInvitations({
          userId: "owner-do-tenant",
          orgId: ORG,
          email: "dono@remaxtrio.com",
          impersonatedByEmail: "nao-aprovador@exemplo.com",
        })
      ).resolves.toBe(true);
    });
  });
});

// Sem teto, `org.members.invite` + `org.members.approve` viram primitiva de
// escalação: a CustomRole convida `admin`, aprova pelo e-mail que controla e
// sai com acesso quase total sem nunca ter tido `org.members.change_role`.
describe("canGrantRole — teto de papel", () => {
  it("BLOQUEIA CustomRole com só invite+approve concedendo admin", async () => {
    membership("custom", {
      [PERMISSION.ORG_MEMBERS_INVITE]: true,
      [PERMISSION.ORG_MEMBERS_APPROVE]: true,
    });

    await expect(
      canGrantRole({
        userId: "u-escalador",
        orgId: ORG,
        email: "escalador@imobiliaria.com",
        targetRole: "admin",
      })
    ).resolves.toBe(false);
  });

  it("admin concede admin — igualdade é subconjunto", async () => {
    membership("admin");

    await expect(
      canGrantRole({
        userId: "u-admin",
        orgId: ORG,
        email: "admin@imobiliaria.com",
        targetRole: "admin",
      })
    ).resolves.toBe(true);
  });

  it.each(["finance", "sales", "viewer", "member"])(
    "admin concede %s, que é estritamente menor",
    async (role) => {
      membership("admin");

      await expect(
        canGrantRole({
          userId: "u-admin",
          orgId: ORG,
          email: "admin@imobiliaria.com",
          targetRole: role,
        })
      ).resolves.toBe(true);
    }
  );

  it("a mesma CustomRole ainda concede papel menor que ela", async () => {
    membership("custom", {
      [PERMISSION.ORG_MEMBERS_INVITE]: true,
      [PERMISSION.ORG_MEMBERS_APPROVE]: true,
    });

    // `member` resolve para {} — subconjunto de qualquer coisa.
    await expect(
      canGrantRole({
        userId: "u-custom",
        orgId: ORG,
        email: "custom@imobiliaria.com",
        targetRole: "member",
      })
    ).resolves.toBe(true);
  });

  it("operador da allowlist de env não tem teto", async () => {
    p.orgMembership.findUnique.mockResolvedValue(null);

    await expect(
      canGrantRole({
        userId: "u-ops",
        orgId: ORG,
        email: ENV_APPROVER,
        targetRole: "admin",
      })
    ).resolves.toBe(true);
  });

  it("sem membership e fora da allowlist não concede nada", async () => {
    p.orgMembership.findUnique.mockResolvedValue(null);

    await expect(
      canGrantRole({
        userId: "u-estranho",
        orgId: ORG,
        email: "estranho@exemplo.com",
        targetRole: "member",
      })
    ).resolves.toBe(false);
  });
});

describe("getOrgApproverEmails", () => {
  it("devolve só quem tem a permissão, em minúsculas", async () => {
    p.orgMembership.findMany.mockResolvedValue([
      { role: "owner", customRole: null, user: { email: "Owner@Org.com", deletedAt: null } },
      { role: "admin", customRole: null, user: { email: "Admin@Org.com", deletedAt: null } },
      { role: "sales", customRole: null, user: { email: "corretor@org.com", deletedAt: null } },
      { role: "viewer", customRole: null, user: { email: "leitor@org.com", deletedAt: null } },
    ]);

    await expect(getOrgApproverEmails(ORG)).resolves.toEqual([
      "owner@org.com",
      "admin@org.com",
    ]);
  });

  it("inclui CustomRole com a permissão e exclui CustomRole sem ela", async () => {
    p.orgMembership.findMany.mockResolvedValue([
      {
        role: "custom",
        customRole: { permissions: { [PERMISSION.ORG_MEMBERS_APPROVE]: true } },
        user: { email: "aprova@org.com", deletedAt: null },
      },
      {
        role: "custom",
        customRole: { permissions: { [PERMISSION.ORG_MEMBERS_INVITE]: true } },
        user: { email: "so-convida@org.com", deletedAt: null },
      },
    ]);

    await expect(getOrgApproverEmails(ORG)).resolves.toEqual(["aprova@org.com"]);
  });

  it("ignora usuário em soft delete (LGPD)", async () => {
    p.orgMembership.findMany.mockResolvedValue([
      { role: "admin", customRole: null, user: { email: "ativo@org.com", deletedAt: null } },
      {
        role: "admin",
        customRole: null,
        user: { email: "removido@org.com", deletedAt: new Date() },
      },
    ]);

    await expect(getOrgApproverEmails(ORG)).resolves.toEqual(["ativo@org.com"]);
  });

  it("filtra membership de serviço na própria query", async () => {
    p.orgMembership.findMany.mockResolvedValue([]);

    await getOrgApproverEmails(ORG);

    expect(p.orgMembership.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { orgId: ORG, isSystem: false },
      })
    );
  });
});

describe("isApprover", () => {
  it("é case-insensitive e ignora e-mail ausente", () => {
    expect(isApprover(ENV_APPROVER.toUpperCase())).toBe(true);
    expect(isApprover("outro@exemplo.com")).toBe(false);
    expect(isApprover(null)).toBe(false);
    expect(isApprover(undefined)).toBe(false);
  });
});
