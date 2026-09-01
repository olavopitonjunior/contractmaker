/**
 * `POST /api/org/members` — a porta lateral do teto de papel (issue #452).
 *
 * A rota cria a membership DIRETO, sem passar pela fila de convites que o PR
 * #447 blindou. Como `role` vinha do body, `ROLE_VALUES` inclui `admin` e o
 * único gate era `ORG_MEMBERS_INVITE`, quem podia convidar criava um `admin`
 * em uma chamada. `requireElevation` parecia uma segunda barreira mas é no-op
 * deliberado.
 *
 * O teto NÃO é mockado aqui de propósito: mockar `canGrantRole` faria o teste
 * passar mesmo se a rota deixasse de chamá-lo, que é justamente a regressão
 * que importa. O único mock é o Prisma.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "../route";
import { requireAuth } from "@/lib/auth/context";
import { requirePermission } from "@/lib/security/rbac/guard";
import { prisma } from "@/lib/db/prisma";
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
vi.mock("@/lib/auth/password-reset", () => ({
  createPasswordResetToken: vi.fn().mockResolvedValue({ token: "tok" }),
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const p = prisma as any;
const auth = vi.mocked(requireAuth);

const ORG = "org-1";
const ATOR = "u-ator";

/**
 * `getEffectivePermissions` e a checagem de "já é membro" batem no MESMO
 * `orgMembership.findUnique`. Separa por userId: o ator tem o papel sob teste,
 * o convidado ainda não é membro.
 */
function comPapelDoAtor(role: string, permissions?: Record<string, boolean>) {
  p.orgMembership.findUnique.mockImplementation(
    async (args: { where: { userId_orgId: { userId: string } } }) =>
      args.where.userId_orgId.userId === ATOR
        ? { role, customRole: permissions ? { permissions } : null }
        : null
  );
}

function req(body: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/org/members", {
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
  p.user.create.mockResolvedValue({ id: "u-convidado", email: "novo@x.com" });
  p.orgMembership.create.mockResolvedValue({ id: "m-1", role: "admin" });
  p.customRole.findFirst.mockResolvedValue(null);
});

describe("POST /api/org/members — teto de papel (#452)", () => {
  it("403 para quem só tem invite tentando criar admin", async () => {
    comPapelDoAtor("custom", { [PERMISSION.ORG_MEMBERS_INVITE]: true });

    const res = await POST(req({ email: "novo@x.com", role: "admin" }));

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({
      error: expect.stringContaining("não pode conceder"),
    });
  });

  // O 403 tem de acontecer ANTES de qualquer escrita. Antes desta correção as
  // checagens vinham depois do `user.create`, e uma recusa deixava para trás um
  // `User` órfão com senha placeholder — conta criada para um acesso negado.
  it("a recusa não escreve nada: nem User, nem membership", async () => {
    comPapelDoAtor("custom", { [PERMISSION.ORG_MEMBERS_INVITE]: true });

    await POST(req({ email: "novo@x.com", role: "admin" }));

    expect(p.user.create).not.toHaveBeenCalled();
    expect(p.orgMembership.create).not.toHaveBeenCalled();
  });

  // Controle: sem isto, um teto que negasse TUDO passaria nos testes acima.
  it("admin criando admin passa — o teto é subconjunto, não recusa geral", async () => {
    comPapelDoAtor("admin");

    const res = await POST(req({ email: "novo@x.com", role: "admin" }));

    expect(res.status).toBe(200);
    expect(p.orgMembership.create).toHaveBeenCalled();
  });

  it("resolve `custom` pelo customRoleId em vez de negar cego", async () => {
    comPapelDoAtor("admin");
    p.customRole.findFirst.mockResolvedValue({
      id: "cr-1",
      permissions: { [PERMISSION.ORG_MEMBERS_INVITE]: true },
    });

    const res = await POST(
      req({ email: "novo@x.com", role: "custom", customRoleId: "cr-1" })
    );

    expect(res.status).toBe(200);
  });

  // customRoleId inexistente é requisição inválida, não falta de permissão:
  // responder 403 mandaria o operador caçar problema de papel onde há erro de
  // digitação.
  it("400 (não 403) para customRoleId que não existe na org", async () => {
    comPapelDoAtor("admin");
    p.customRole.findFirst.mockResolvedValue(null);

    const res = await POST(
      req({ email: "novo@x.com", role: "custom", customRoleId: "cr-fantasma" })
    );

    expect(res.status).toBe(400);
    expect(p.user.create).not.toHaveBeenCalled();
    // O filtro tem de carregar o orgId: sem ele, um id de outro tenant passaria
    // a validar, e o mock devolvendo `null` esconderia a diferença.
    expect(p.customRole.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "cr-fantasma", orgId: ORG } })
    );
  });

  // A mensagem tem de nomear o papel NEGADO. Com `role` cru ela dizia `o papel
  // "custom"` para qualquer CustomRole, e numa org com várias o operador não
  // descobria qual delas foi recusada.
  it("nomeia a CustomRole negada na mensagem, não o enum `custom`", async () => {
    comPapelDoAtor("admin");
    p.customRole.findFirst.mockResolvedValue({
      id: "cr-acima",
      name: "QA Acima do Admin",
      // `org.delete` é uma das permissões que `owner` tem e `admin` não.
      permissions: { "org.delete": true },
    });

    const res = await POST(
      req({ email: "novo@x.com", role: "custom", customRoleId: "cr-acima" })
    );

    expect(res.status).toBe(403);
    const body = await res.json();
    // Só a asserção positiva: ela já é a prova de regressão — voltar a
    // interpolar `role` cru faz a mensagem perder o nome e este `toContain`
    // falha sozinho (verificado por mutação). Um `not.toContain('"custom"')`
    // seria redundante e ainda ficaria acoplado às aspas: um futuro
    // `o papel custom (${nome})` passaria por ele sem ser notado.
    expect(body.error).toContain("QA Acima do Admin");
  });

  // Quando "já é membro" e "fora do teto" coexistem, o 403 vence — decisão, não
  // acidente de ordem: a alternativa daria a quem não pode conceder uma resposta
  // que confirma quem já pertence à org.
  it("403 vence o 409 quando o convidado já é membro E o papel excede o teto", async () => {
    p.orgMembership.findUnique.mockImplementation(async () => ({
      role: "custom",
      customRole: { permissions: { [PERMISSION.ORG_MEMBERS_INVITE]: true } },
    }));
    p.user.findUnique.mockResolvedValue({ id: "u-ja-membro" });

    const res = await POST(req({ email: "ja@x.com", role: "admin" }));

    expect(res.status).toBe(403);
  });

  // `customRoleId` só faz sentido com `role: "custom"`. O zod exige o id quando
  // o papel é custom, mas não o proíbe quando não é — e a membership saía com
  // os dois preenchidos, contradizendo quem lê o dado depois.
  it("ignora customRoleId quando o papel não é custom, gravando null", async () => {
    comPapelDoAtor("admin");
    p.customRole.findFirst.mockResolvedValue({ id: "cr-1", permissions: {} });

    await POST(
      req({ email: "novo@x.com", role: "viewer", customRoleId: "cr-1" })
    );

    expect(p.orgMembership.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ role: "viewer", customRoleId: null }),
      })
    );
  });

  // Mesma correção que o #447 fez na tabela irmã: sob impersonação `ctx.userId`
  // é o dono do tenant, não quem agiu.
  it("grava o admin REAL em invitedBy sob impersonação", async () => {
    comPapelDoAtor("admin");
    auth.mockResolvedValue({
      ok: true,
      ctx: {
        userId: ATOR,
        orgId: ORG,
        orgName: "Imobiliária",
        userName: "Ator",
        userEmail: "dono@tenant.com",
        impersonatedByUserId: "u-admin-plataforma",
        impersonatedByEmail: "olavo@exemplo.com",
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    await POST(req({ email: "novo@x.com", role: "viewer" }));

    expect(p.orgMembership.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ invitedBy: "u-admin-plataforma" }),
      })
    );
  });
});
