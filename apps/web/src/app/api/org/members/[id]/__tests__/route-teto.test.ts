/**
 * `PATCH /api/org/members/[id]` — o quarto e último caminho da família do teto
 * de papel (issues #452, #473, #474, #488).
 *
 * Os outros três já perguntam se o papel ALVO cabe em quem age. Este trocava
 * papel só com `ORG_MEMBERS_CHANGE_ROLE` + `requireElevation`, que é no-op
 * deliberado. Como owner e admin são hoje os únicos donos dessa chave, não há
 * escalação na base instalada — mas a tela de papéis deixa criar uma CustomRole
 * com ela, e é exatamente essa a forma que o bug da #452 teve.
 *
 * O teto NÃO é mockado de propósito: mockar `canGrantRole` faria o teste passar
 * mesmo se a rota deixasse de chamá-lo, que é a regressão que importa. O único
 * mock é o Prisma.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { PATCH } from "../route";
import { requireAuth } from "@/lib/auth/context";
import { requirePermission } from "@/lib/security/rbac/guard";
import { prisma } from "@/lib/db/prisma";
import { PERMISSION } from "@/lib/security/rbac/permissions";
import { ROLE_PRESETS } from "@/lib/security/rbac/roles";
import { audit } from "@/lib/security/audit";

vi.mock("@/lib/auth/context", () => ({ requireAuth: vi.fn() }));
vi.mock("@/lib/security/rbac/guard", async (orig) => ({
  ...(await orig<typeof import("@/lib/security/rbac/guard")>()),
  requirePermission: vi.fn(),
}));
vi.mock("@/lib/security/audit", () => ({
  audit: vi.fn().mockResolvedValue(undefined),
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const p = prisma as any;
const auth = vi.mocked(requireAuth);

const ORG = "org-1";
const ATOR = "u-ator";
const ALVO = "u-alvo";
const MEMBERSHIP = "m-alvo";

/**
 * `orgMembership.findUnique` serve a DOIS leitores nesta rota: o
 * `actorMembership` do handler e o `getEffectivePermissions` do teto. Os dois
 * buscam pelo par userId_orgId do ATOR, então um mock só atende ambos — desde
 * que devolva `role` e `customRole`, que é o que cada um lê.
 */
function comPapelDoAtor(role: string, permissions?: Record<string, boolean>) {
  p.orgMembership.findUnique.mockImplementation(
    async (args: { where: { userId_orgId: { userId: string } } }) =>
      args.where.userId_orgId.userId === ATOR
        ? { role, customRole: permissions ? { permissions } : null }
        : null
  );
}

function alvoComPapel(role: string, customRoleId: string | null = null) {
  p.orgMembership.findFirst.mockResolvedValue({
    id: MEMBERSHIP,
    userId: ALVO,
    orgId: ORG,
    role,
    customRoleId,
    user: { id: ALVO, email: "alvo@x.com", name: "Alvo" },
  });
}

function req(body: Record<string, unknown>) {
  return new NextRequest(`http://localhost/api/org/members/${MEMBERSHIP}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

const params = Promise.resolve({ id: MEMBERSHIP });

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
  alvoComPapel("viewer");
  comPapelDoAtor("admin");
  p.customRole.findFirst.mockResolvedValue(null);
  p.orgManagerSettings.findUnique.mockResolvedValue(null);
  p.orgMembership.count.mockResolvedValue(1);
  p.orgMembership.update.mockResolvedValue({ id: MEMBERSHIP, role: "admin" });
});

describe("PATCH /api/org/members/[id] — teto de papel (#488)", () => {
  it("403 para CustomRole que só tem change_role tentando promover a admin", async () => {
    comPapelDoAtor("custom", {
      [PERMISSION.ORG_MEMBERS_CHANGE_ROLE]: true,
    });

    const res = await PATCH(req({ role: "admin" }), { params });

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({
      error: expect.stringContaining("não pode conceder"),
    });
  });

  it("a recusa não escreve: nenhum update de membership", async () => {
    comPapelDoAtor("custom", {
      [PERMISSION.ORG_MEMBERS_CHANGE_ROLE]: true,
    });

    await PATCH(req({ role: "admin" }), { params });

    expect(p.orgMembership.update).not.toHaveBeenCalled();
  });

  // Controle: sem isto, um teto que negasse TUDO passaria nos dois testes
  // acima e a rota estaria quebrada sem nenhum teste reclamar.
  it("admin promovendo a admin passa — o teto é subconjunto, não recusa geral", async () => {
    comPapelDoAtor("admin");

    const res = await PATCH(req({ role: "admin" }), { params });

    expect(res.status).toBe(200);
    expect(p.orgMembership.update).toHaveBeenCalled();
  });

  /**
   * O caso que um teto "olha o body" deixaria passar inteiro. PATCH é parcial:
   * trocar só o `customRoleId` de quem JÁ é `custom` troca o conjunto inteiro
   * de permissões sem que a palavra `role` apareça na requisição.
   */
  it("403 ao trocar só o customRoleId de quem já é custom, sem mandar role", async () => {
    comPapelDoAtor("custom", {
      [PERMISSION.ORG_MEMBERS_CHANGE_ROLE]: true,
    });
    alvoComPapel("custom", "cr-fraca");
    p.customRole.findFirst.mockResolvedValue({
      id: "cr-forte",
      name: "QA Poderosa",
      permissions: { [PERMISSION.ORG_DELETE]: true },
    });

    const res = await PATCH(req({ customRoleId: "cr-forte" }), { params });

    expect(res.status).toBe(403);
    expect(p.orgMembership.update).not.toHaveBeenCalled();
  });

  // 400 e não 403: id inexistente é erro de requisição, não falta de permissão.
  it("400 (não 403) para customRoleId que não existe na org", async () => {
    comPapelDoAtor("admin");
    p.customRole.findFirst.mockResolvedValue(null);

    const res = await PATCH(
      req({ role: "custom", customRoleId: "cr-fantasma" }),
      { params }
    );

    expect(res.status).toBe(400);
    expect(p.orgMembership.update).not.toHaveBeenCalled();
    // O filtro tem de carregar o orgId: sem ele um id de OUTRO tenant viraria
    // alvo válido, e o mock devolvendo `null` esconderia a diferença.
    expect(p.customRole.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "cr-fantasma", orgId: ORG } })
    );
  });

  // A mensagem tem de nomear o papel NEGADO. Com `role` cru ela diria `o papel
  // "custom"` para qualquer CustomRole, e numa org com várias o operador não
  // descobre qual foi recusada.
  it("nomeia a CustomRole negada, não o enum `custom`", async () => {
    comPapelDoAtor("admin");
    p.customRole.findFirst.mockResolvedValue({
      id: "cr-acima",
      name: "QA Acima do Admin",
      // `org.delete` é uma das 7 que `owner` tem e `admin` não.
      permissions: { [PERMISSION.ORG_DELETE]: true },
    });

    const res = await PATCH(
      req({ role: "custom", customRoleId: "cr-acima" }),
      { params }
    );

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({
      error: expect.stringContaining("QA Acima do Admin"),
    });
  });

  /**
   * Isolamento do que o teto mede: o papel **alvo**, não o atual. O ator aqui
   * tem tudo o que um `viewer` tem — poderia conceder `viewer` sem problema —
   * e nada do que falta para `admin`. Sem este caso, a mutação "checa
   * `membership.role` em vez de `nextRole`" ainda morre no arquivo como um
   * todo, mas nenhum teste sozinho aponta a causa: os outros negam por um
   * segundo motivo (o ator também não alcança o papel ATUAL do alvo) e passam
   * pela razão errada.
   */
  it("403 mesmo podendo conceder o papel ATUAL do membro, quando o alvo excede", async () => {
    comPapelDoAtor("custom", {
      ...(ROLE_PRESETS.viewer as Record<string, boolean>),
      [PERMISSION.ORG_MEMBERS_CHANGE_ROLE]: true,
    });
    alvoComPapel("viewer");

    const res = await PATCH(req({ role: "admin" }), { params });

    expect(res.status).toBe(403);
    expect(p.orgMembership.update).not.toHaveBeenCalled();
  });

  // Controle do teste acima: o mesmo ator, promovendo para o papel que ele
  // ALCANÇA, tem de passar. Sem isto, o 403 acima poderia vir de o ator não
  // alcançar nada — e o teste não estaria medindo o alvo, estaria medindo o
  // ator.
  it("o mesmo ator concede `viewer`, que está dentro do que ele tem", async () => {
    comPapelDoAtor("custom", {
      ...(ROLE_PRESETS.viewer as Record<string, boolean>),
      [PERMISSION.ORG_MEMBERS_CHANGE_ROLE]: true,
    });
    alvoComPapel("sales");

    const res = await PATCH(req({ role: "viewer" }), { params });

    expect(res.status).toBe(200);
    expect(p.orgMembership.update).toHaveBeenCalled();
  });

  it("audita a recusa com ação própria de recusa, não a de troca efetivada", async () => {
    comPapelDoAtor("custom", {
      [PERMISSION.ORG_MEMBERS_CHANGE_ROLE]: true,
    });

    await PATCH(req({ role: "admin" }), { params });

    expect(vi.mocked(audit)).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: ORG, userId: ATOR }),
      expect.objectContaining({
        // Ação PRÓPRIA: o painel de auditoria agrupa `topActions` só por
        // `action`, então reaproveitar `MEMBER_ROLE_CHANGED` faria a tentativa
        // negada ser contada como troca efetivada.
        action: "MEMBER_ROLE_CHANGE_DENIED",
        result: "DENIED",
        metadata: expect.objectContaining({
          attemptedRole: "admin",
          reason: "role_ceiling",
        }),
      })
    );
  });
});

describe("PATCH /api/org/members/[id] — normalização de customRoleId", () => {
  /**
   * Mesmo defeito que o `POST /api/org/members` já corrigiu: o zod exige o id
   * quando o papel é `custom`, mas não o proíbe quando não é — e a membership
   * ficava com `role` e `customRoleId` simultâneos. `resolvePermissions` ignora
   * o id fora de `custom`, então é dado morto, não escalação; mas contradiz
   * todo código a jusante que assuma "customRoleId implica custom".
   */
  it("zera o customRoleId ao sair de custom para um preset", async () => {
    comPapelDoAtor("admin");
    alvoComPapel("custom", "cr-antiga");

    const res = await PATCH(req({ role: "viewer" }), { params });

    expect(res.status).toBe(200);
    expect(p.orgMembership.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ role: "viewer", customRoleId: null }),
      })
    );
  });

  it("ignora customRoleId quando o papel resultante não é custom", async () => {
    comPapelDoAtor("admin");
    p.customRole.findFirst.mockResolvedValue({
      id: "cr-1",
      name: "Qualquer",
      permissions: {},
    });

    await PATCH(req({ role: "viewer", customRoleId: "cr-1" }), { params });

    expect(p.orgMembership.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ role: "viewer", customRoleId: null }),
      })
    );
  });

  /**
   * O 400 saía só quando o ator era `admin` — estava dentro do `if
   * (actorMembership?.role === "admin")`. Para owner, a rota gravava
   * `role: "custom"` com `customRoleId: null`, membership que
   * `resolvePermissions` resolve como SEM PERMISSÃO NENHUMA: o membro perdia
   * todo o acesso em silêncio, e nada no erro dizia por quê.
   */
  it("400 para role=custom sem customRoleId, inclusive quando o ator é owner", async () => {
    comPapelDoAtor("owner");
    alvoComPapel("viewer");

    const res = await PATCH(req({ role: "custom" }), { params });

    expect(res.status).toBe(400);
    expect(p.orgMembership.update).not.toHaveBeenCalled();
  });
});
