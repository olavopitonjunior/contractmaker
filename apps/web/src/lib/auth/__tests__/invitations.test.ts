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
