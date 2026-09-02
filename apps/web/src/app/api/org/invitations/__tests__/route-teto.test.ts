/**
 * `POST /api/org/invitations` — teto de papel NA CRIAÇÃO (issue #474).
 *
 * A segurança nunca dependeu disto: o teto do `approve` decide, e é lá que a
 * membership nasce. O que estava quebrado era o MOMENTO do feedback — o
 * convite acima do teto era aceito com 201, morria calado na aprovação, e as
 * três pessoas envolvidas viam o convite simplesmente evaporar.
 *
 * `canGrantRole` NÃO é mockada de propósito: mockar o teto faria estes testes
 * passarem mesmo se a rota deixasse de chamá-lo — que é exatamente a regressão
 * que importa. O único mock de verdade é o Prisma.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "../route";
import { requireAuth } from "@/lib/auth/context";
import { requirePermission } from "@/lib/security/rbac/guard";
import { prisma } from "@/lib/db/prisma";
import { sendEmail } from "@/lib/email/client";
import { audit } from "@/lib/security/audit";
import { PERMISSION } from "@/lib/security/rbac/permissions";

vi.mock("@/lib/auth/context", () => ({ requireAuth: vi.fn() }));
vi.mock("@/lib/security/rbac/guard", async (orig) => ({
  ...(await orig<typeof import("@/lib/security/rbac/guard")>()),
  requirePermission: vi.fn(),
}));
vi.mock("@/lib/security/audit", () => ({
  audit: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/email/client", () => ({
  sendEmail: vi.fn().mockResolvedValue(undefined),
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const p = prisma as any;
const auth = vi.mocked(requireAuth);

const ORG = "org-1";
const ATOR = "u-ator";

/** O ator tem o papel sob teste; o convidado ainda não é membro. */
function comPapelDoAtor(role: string, permissions?: Record<string, boolean>) {
  p.orgMembership.findUnique.mockImplementation(
    async (args: { where: { userId_orgId: { userId: string } } }) =>
      args.where.userId_orgId.userId === ATOR
        ? { role, customRole: permissions ? { permissions } : null }
        : null
  );
}

function req(body: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/org/invitations", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  auth.mockResolvedValue({
    ok: true,
    ctx: {
      userId: ATOR,
      orgId: ORG,
      orgName: "Imobiliária",
      userName: "Ator",
      userEmail: "ator@imobiliaria.com",
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);
  vi.mocked(requirePermission).mockResolvedValue(undefined as never);
  p.user.findUnique.mockResolvedValue(null);
  p.orgInvitation.findFirst.mockResolvedValue(null);
  p.orgInvitation.create.mockResolvedValue({ id: "inv-1", role: "admin" });
  // `getOrgApproverEmails` — best-effort, irrelevante para o teto.
  p.orgMembership.findMany.mockResolvedValue([]);
});

describe("POST /api/org/invitations — teto na criação (#474)", () => {
  it("403 para quem só tem invite tentando convidar admin", async () => {
    comPapelDoAtor("custom", { [PERMISSION.ORG_MEMBERS_INVITE]: true });

    const res = await POST(req({ email: "novo@x.com", role: "admin" }));

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({
      error: expect.stringContaining("não pode conceder"),
    });
  });

  it("a recusa não cria convite nem dispara e-mail", async () => {
    comPapelDoAtor("custom", { [PERMISSION.ORG_MEMBERS_INVITE]: true });

    await POST(req({ email: "novo@x.com", role: "admin" }));

    expect(p.orgInvitation.create).not.toHaveBeenCalled();
    expect(vi.mocked(sendEmail)).not.toHaveBeenCalled();
  });

  // CONTROLE. Sem ele, um teto que negasse TUDO passaria nos dois testes acima.
  it("owner convidando admin passa — o teto é subconjunto, não recusa geral", async () => {
    comPapelDoAtor("owner");

    const res = await POST(req({ email: "novo@x.com", role: "admin" }));

    expect(res.status).toBe(201);
    expect(p.orgInvitation.create).toHaveBeenCalled();
  });

  /**
   * A armadilha que este gate quase introduziu: `member` é o DEFAULT do
   * `createInvitationSchema` e NÃO está no catálogo de presets. Se o teto
   * tratasse "papel que não sei resolver" como recusa, TODO convite padrão
   * passaria a dar 403 — inclusive os do owner. Papel desconhecido não concede
   * permissão nenhuma, então tem de passar.
   */
  it("convite SEM role (default `member`) passa mesmo fora do catálogo de presets", async () => {
    comPapelDoAtor("custom", { [PERMISSION.ORG_MEMBERS_INVITE]: true });

    const res = await POST(req({ email: "novo@x.com" }));

    expect(res.status).toBe(201);
    expect(p.orgInvitation.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ role: "member" }),
      })
    );
  });

  /**
   * A recusa tem de deixar rastro. Sem esta asserção, apagar o `audit` inteiro
   * do caminho de negação não quebraria teste nenhum — o mock engole tudo.
   */
  it("audita a recusa como DENIED, com o papel e o motivo", async () => {
    comPapelDoAtor("custom", { [PERMISSION.ORG_MEMBERS_INVITE]: true });

    await POST(req({ email: "novo@x.com", role: "admin" }));

    expect(vi.mocked(audit)).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: ORG, userId: ATOR }),
      expect.objectContaining({
        action: "INVITATION_CREATED",
        result: "DENIED",
        metadata: expect.objectContaining({
          role: "admin",
          reason: "role_ceiling",
        }),
      })
    );
  });

  /**
   * Sob impersonation as duas identidades divergem de propósito e cada uma tem
   * o seu papel: `ctx.userId` já É o dono do tenant (quem age dentro da org, e
   * portanto de quem se mede o teto), e `invitedById` grava o operador humano
   * real, que é o que a coluna "Convidado por" mostra. Sem este teste, colapsar
   * as duas em `ctx.userId` passaria despercebido.
   */
  it("sob impersonation: teto pelo dono do tenant, autoria pelo operador", async () => {
    const OPERADOR = "u-operador";
    comPapelDoAtor("owner");
    auth.mockResolvedValue({
      ok: true,
      ctx: {
        userId: ATOR,
        orgId: ORG,
        orgName: "Imobiliária",
        userName: "Dono",
        userEmail: "dono@imobiliaria.com",
        impersonatedByUserId: OPERADOR,
        impersonatedByEmail: "operador@imobpro.ia.br",
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    const res = await POST(req({ email: "novo@x.com", role: "admin" }));

    expect(res.status).toBe(201);
    expect(p.orgInvitation.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ invitedById: OPERADOR }),
      })
    );
  });

  /**
   * ORDEM, e ela é deliberada: o teto vem ANTES das checagens de existência.
   * Quem não pode conceder o papel também não deve descobrir por resposta de
   * API se o e-mail já é membro da org.
   */
  it("403 (não 409) quando o alvo já é membro e o papel está acima do teto", async () => {
    p.orgMembership.findUnique.mockImplementation(
      async (args: { where: { userId_orgId: { userId: string } } }) =>
        args.where.userId_orgId.userId === ATOR
          ? {
              role: "custom",
              customRole: {
                permissions: { [PERMISSION.ORG_MEMBERS_INVITE]: true },
              },
            }
          : { id: "m-existente", role: "viewer" }
    );
    p.user.findUnique.mockResolvedValue({ id: "u-existente" });

    const res = await POST(req({ email: "existente@x.com", role: "admin" }));

    expect(res.status).toBe(403);
  });

  /** O outro branch de existência, pela mesma razão. */
  it("403 (não 409) quando já há convite pendente e o papel está acima do teto", async () => {
    comPapelDoAtor("custom", { [PERMISSION.ORG_MEMBERS_INVITE]: true });
    p.orgInvitation.findFirst.mockResolvedValue({ id: "inv-pendente" });

    const res = await POST(req({ email: "novo@x.com", role: "admin" }));

    expect(res.status).toBe(403);
  });
});
