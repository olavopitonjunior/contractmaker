import { describe, it, expect, vi, beforeEach } from "vitest";
import { prisma } from "@/lib/db/prisma";
import {
  provisionMaxForOrg,
  deprovisionMaxForOrg,
  syncMaxForOrg,
  serviceUserEmail,
  MAX_SCOPES_FASE2,
} from "../provisioning";
import { pushOrgToMax, deactivateOrgInMax } from "@/lib/max/push-org";
import { createApiToken, revokeApiToken } from "@/lib/auth/api-token";

vi.mock("@/lib/max/push-org", () => ({
  pushOrgToMax: vi.fn(),
  deactivateOrgInMax: vi.fn(),
}));
vi.mock("@/lib/auth/api-token", async (orig) => ({
  ...(await orig<typeof import("@/lib/auth/api-token")>()),
  createApiToken: vi.fn(),
  revokeApiToken: vi.fn().mockResolvedValue(true),
}));

const mockPrisma = vi.mocked(prisma);
const create = vi.mocked(createApiToken);
const revoke = vi.mocked(revokeApiToken);
const push = vi.mocked(pushOrgToMax);
const deactivate = vi.mocked(deactivateOrgInMax);

const ORG = "org-1";

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.organization.findUnique.mockResolvedValue({
    id: ORG,
    name: "RE/MAX Trio",
  } as never);
  mockPrisma.user.upsert.mockResolvedValue({ id: "svc-1" } as never);
  mockPrisma.orgMembership.upsert.mockResolvedValue({ id: "m1" } as never);
  mockPrisma.orgMembership.count.mockResolvedValue(1 as never);
  mockPrisma.userApiToken.findMany.mockResolvedValue([] as never);
  create.mockResolvedValue({
    rawToken: "cmt_novo",
    token: { id: "tok-1", name: "x", scopes: [], expiresAt: null, createdAt: new Date() },
  } as never);
});

describe("provisionMaxForOrg", () => {
  it("cria usuário de serviço, membership e token", async () => {
    const r = await provisionMaxForOrg({ orgId: ORG });

    expect(r.status).toBe("created");
    expect(r.rawToken).toBe("cmt_novo");
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "svc-1", scopes: MAX_SCOPES_FASE2 })
    );
  });

  /**
   * Sem hash o provider Credentials não autentica — o usuário existe só para
   * possuir o token, e não deve conseguir logar.
   */
  it("o usuário de serviço nasce sem senha", async () => {
    await provisionMaxForOrg({ orgId: ORG });

    const args = mockPrisma.user.upsert.mock.calls[0][0] as {
      create: { passwordHash: null; phone: null; email: string };
    };
    expect(args.create.passwordHash).toBeNull();
    expect(args.create.email).toBe(serviceUserEmail(ORG));
  });

  /**
   * `User.phone` é @unique GLOBAL: um usuário de serviço com telefone apareceria
   * no `by-phone` como se fosse gente — e o Max identifica pelo telefone.
   */
  it("o usuário de serviço nasce SEM telefone", async () => {
    await provisionMaxForOrg({ orgId: ORG });

    const args = mockPrisma.user.upsert.mock.calls[0][0] as {
      create: { phone: null };
    };
    expect(args.create.phone).toBeNull();
  });

  /**
   * O invariante que este módulo existe para garantir. O Bearer resolve a org
   * pela PRIMEIRA membership do dono do token (`user-org.ts:114-124`) — com
   * duas, o Max escreveria no tenant errado, com 200 OK e audit da org errada.
   */
  it("recusa emitir token se o usuário de serviço tiver mais de uma membership", async () => {
    mockPrisma.orgMembership.count.mockResolvedValue(2 as never);

    const r = await provisionMaxForOrg({ orgId: ORG });

    expect(r.status).toBe("failed");
    expect(r.reason).toMatch(/2 memberships/);
    expect(create).not.toHaveBeenCalled();
  });

  /**
   * `createApiToken` não é idempotente — só o sha256 é persistido, então não há
   * "checar se já existe e reusar". Chamar de novo ROTACIONA.
   */
  it("com token anterior, emite o novo ANTES de revogar o antigo", async () => {
    mockPrisma.userApiToken.findMany.mockResolvedValue([
      { id: "tok-antigo" },
    ] as never);
    const ordem: string[] = [];
    create.mockImplementation(async () => {
      ordem.push("create");
      return {
        rawToken: "cmt_novo",
        token: { id: "tok-2", name: "x", scopes: [], expiresAt: null, createdAt: new Date() },
      } as never;
    });
    revoke.mockImplementation(async () => {
      ordem.push("revoke");
      return true;
    });

    const r = await provisionMaxForOrg({ orgId: ORG });

    expect(r.status).toBe("rotated");
    // Invertida, haveria uma janela sem credencial válida.
    expect(ordem).toEqual(["create", "revoke"]);
    expect(revoke).toHaveBeenCalledWith("tok-antigo", "svc-1");
  });

  /**
   * Enquanto `X-Act-As-User` aceitar delegar para o `owner` sem comparar roles,
   * este escopo faz o token do bot valer o poder do dono do tenant.
   */
  it("os escopos da Fase 2 NÃO incluem users:delegate nem escrita", async () => {
    expect(MAX_SCOPES_FASE2).not.toContain("users:delegate");
    expect(MAX_SCOPES_FASE2).not.toContain("documents:rw");
    expect(MAX_SCOPES_FASE2).not.toContain("proposals:rw");
    expect(MAX_SCOPES_FASE2).toEqual(["agents:r", "agents:rw", "metrics:r"]);
  });

  it("org inexistente falha sem criar nada", async () => {
    mockPrisma.organization.findUnique.mockResolvedValue(null as never);

    const r = await provisionMaxForOrg({ orgId: "nao-existe" });

    expect(r.status).toBe("failed");
    expect(mockPrisma.user.upsert).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });
});

describe("deprovisionMaxForOrg", () => {
  it("revoga os tokens vivos do usuário de serviço", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ id: "svc-1" } as never);
    mockPrisma.userApiToken.updateMany.mockResolvedValue({ count: 2 } as never);

    expect(await deprovisionMaxForOrg(ORG)).toEqual({ revoked: 2 });
  });

  it("org nunca provisionada é no-op", async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null as never);

    expect(await deprovisionMaxForOrg(ORG)).toEqual({ revoked: 0 });
    expect(mockPrisma.userApiToken.updateMany).not.toHaveBeenCalled();
  });
});

/**
 * A transição do flag é o que torna "ativar o Max num tenant" um clique. O que
 * este bloco protege é o par de decisões que não são óbvias: quando revogar, e
 * o que fazer quando a entrega ao serviço falha.
 */
describe("syncMaxForOrg", () => {
  beforeEach(() => {
    mockPrisma.userApiToken.updateMany.mockResolvedValue({ count: 0 } as never);
    mockPrisma.user.findUnique.mockResolvedValue({ id: "svc-1" } as never);
    push.mockResolvedValue({ ok: true });
    deactivate.mockResolvedValue({ ok: true });
  });

  function modulos(flags: Record<string, boolean>) {
    mockPrisma.orgModule.findMany.mockResolvedValue([
      { module: "vendas", enabled: true, featureFlags: flags },
      { module: "locacao", enabled: true, featureFlags: flags },
    ] as never);
  }

  it("flag ligada provisiona e entrega o token ao serviço", async () => {
    modulos({ "vendas.max": true });

    const r = await syncMaxForOrg(ORG);

    expect(r).toEqual({ action: "provisioned", delivered: true });
    expect(push).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: ORG, apiToken: "cmt_novo" })
    );
  });

  /**
   * O token cobre os DOIS módulos. Desligar vendas mantendo locação não pode
   * derrubar o agente do tenant.
   */
  it("desligar UM módulo mantendo o outro NÃO revoga", async () => {
    modulos({ "vendas.max": false, "locacao.max": true });

    const r = await syncMaxForOrg(ORG);

    expect(r).toEqual({ action: "provisioned", delivered: true });
    expect(mockPrisma.userApiToken.updateMany).not.toHaveBeenCalled();
  });

  it("desligar os DOIS revoga e desativa no serviço", async () => {
    modulos({ "vendas.max": false, "locacao.max": false });
    mockPrisma.userApiToken.updateMany.mockResolvedValue({ count: 1 } as never);

    const r = await syncMaxForOrg(ORG);

    expect(r).toEqual({ action: "deprovisioned", revoked: 1 });
    expect(deactivate).toHaveBeenCalledWith(ORG);
    expect(create).not.toHaveBeenCalled();
  });

  /**
   * O token existe e é válido; o que faltou foi a entrega. Revogar aqui deixaria
   * o tenant sem credencial NENHUMA — pior que ficar com uma que só precisa ser
   * reenviada.
   */
  it("falha na entrega NÃO revoga o token recém-emitido", async () => {
    modulos({ "vendas.max": true });
    push.mockResolvedValue({ ok: false, reason: "unreachable", detail: "timeout" });

    const r = await syncMaxForOrg(ORG);

    expect(r).toMatchObject({ action: "provisioned", delivered: false });
    expect(mockPrisma.userApiToken.updateMany).not.toHaveBeenCalled();
  });

  it("invariante violado não chega a tentar a entrega", async () => {
    modulos({ "vendas.max": true });
    mockPrisma.orgMembership.count.mockResolvedValue(2 as never);

    const r = await syncMaxForOrg(ORG);

    expect(r).toMatchObject({ action: "provisioned", delivered: false });
    expect(push).not.toHaveBeenCalled();
  });
});
