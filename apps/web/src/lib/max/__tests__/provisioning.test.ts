import { describe, it, expect, vi, beforeEach } from "vitest";
import { prisma } from "@/lib/db/prisma";
import {
  provisionMaxForOrg,
  deprovisionMaxForOrg,
  syncMaxForOrg,
  serviceUserEmail,
  MAX_SCOPES,
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
  mockPrisma.customRole.upsert.mockResolvedValue({ id: "role-max" } as never);
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
      expect.objectContaining({ userId: "svc-1", scopes: MAX_SCOPES })
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
   * O Max escreve DUAS coisas: formulário de venda (`documents:rw`) e de
   * locação (`locacao:rw`). São os escopos de `POST /api/forms` e
   * `POST /api/locacao/forms`, e são o teto do que ele pode fazer.
   *
   * A lista é fixada inteira de propósito. Escopo é congelado na emissão do
   * token, então acrescentar um aqui sem reemitir não tem efeito — e acrescentar
   * um SEM QUERER é uma ampliação de poder que nenhum outro teste pegaria. Este
   * teste falhar é o lembrete de que a mudança precisa de reprovision.
   */
  it("os escopos do Max cobrem a escrita de formulário e nada além", async () => {
    expect(MAX_SCOPES).toEqual([
      "agents:r",
      "agents:rw",
      "metrics:r",
      "documents:rw",
      "locacao:rw",
    ]);
  });

  /**
   * `locacao:rw` sozinho não abre nada: `ensureLocacaoApiAccess` exige TAMBÉM
   * `PERMISSION.LEASE_CREATE`, que vem do papel — e o papel é um `CustomRole`
   * mínimo, não `gestor_locacao`.
   *
   * Este teste existe porque a alternativa fácil (promover a `gestor_locacao`)
   * daria CRUD de imóvel, geração de aluguel e RESCISÃO de contrato a um agente
   * que só cria formulário em branco.
   */
  it("o papel do Max dá criar locação, e não editar/rescindir", async () => {
    await provisionMaxForOrg({ orgId: ORG });

    const chamada = vi.mocked(mockPrisma.customRole.upsert).mock.calls[0][0];
    const perms = chamada.create.permissions as Record<string, boolean>;

    expect(perms["lease.create"]).toBe(true);
    expect(perms["lease.view"]).toBe(true);
    expect(perms["lease.terminate"]).toBeUndefined();
    expect(perms["lease.edit"]).toBeUndefined();
    expect(perms["property.create"]).toBeUndefined();
    expect(perms["rent.generate"]).toBeUndefined();

    // E a membership aponta pra esse papel, não pra um preset largo.
    const mship = vi.mocked(mockPrisma.orgMembership.upsert).mock.calls[0][0];
    expect(mship.create).toMatchObject({ role: "custom", isSystem: true });
    expect(mship.update).toMatchObject({ role: "custom" });
  });

  /**
   * Não é redundante com o teste acima: aquele fixa a lista, este diz POR QUE
   * estes dois em particular não podem entrar sem decisão explícita.
   *
   * `users:delegate` deixou de ser bloqueado por falta da trava (#249 entregou)
   * e passou a ser desnecessário: `requireApiAuth` — o helper de todas as rotas
   * que o Max chama — ignora `X-Act-As-User`. Ligar não daria poder novo, só
   * superfície. `proposals:rw` é da fase seguinte, e proposta carrega valores e
   * vai para terceiro: outro patamar de consequência.
   */
  it("não ganha delegação nem escrita de proposta de carona", async () => {
    expect(MAX_SCOPES).not.toContain("users:delegate");
    expect(MAX_SCOPES).not.toContain("proposals:rw");
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

/**
 * O estado é o que separa três situações que, sem ele, se parecem no painel:
 * "nunca provisionado", "provisionado e entregue" e "provisionado, mas o
 * serviço não recebeu". A terceira é a perigosa — flag verde, agente mudo.
 */
describe("AgentProvisioning — estado do ciclo", () => {
  beforeEach(() => {
    mockPrisma.userApiToken.updateMany.mockResolvedValue({ count: 0 } as never);
    mockPrisma.user.findUnique.mockResolvedValue({ id: "svc-1" } as never);
    push.mockResolvedValue({ ok: true });
    deactivate.mockResolvedValue({ ok: true });
    mockPrisma.agentProvisioning.upsert.mockResolvedValue({} as never);
  });

  function modulos(flags: Record<string, boolean>) {
    mockPrisma.orgModule.findMany.mockResolvedValue([
      { module: "vendas", enabled: true, featureFlags: flags },
      { module: "locacao", enabled: true, featureFlags: flags },
    ] as never);
  }

  function estadoGravado() {
    const call = mockPrisma.agentProvisioning.upsert.mock.calls[0][0] as {
      create: Record<string, unknown>;
      update: Record<string, unknown>;
    };
    return call;
  }

  it("entrega confirmada grava active com deliveredAt e zera tentativas", async () => {
    modulos({ "vendas.max": true });

    await syncMaxForOrg(ORG);

    const { create, update } = estadoGravado();
    expect(create.status).toBe("active");
    expect(create.deliveredAt).toBeInstanceOf(Date);
    expect(create.lastError).toBeNull();
    // Zera, não incrementa: um ciclo que fechou bem apaga o histórico de falha.
    expect(update.attempts).toBe(0);
  });

  /**
   * Distinção que o cron consome: `pending_delivery` é "emiti e não entreguei"
   * (reenviar resolve); `failed` é "não cheguei a emitir" (precisa
   * reprovisionar).
   */
  it("falha de ENTREGA grava pending_delivery e incrementa tentativas", async () => {
    modulos({ "vendas.max": true });
    push.mockResolvedValue({ ok: false, reason: "unreachable", detail: "timeout" });

    await syncMaxForOrg(ORG);

    const { create, update } = estadoGravado();
    expect(create.status).toBe("pending_delivery");
    expect(create.lastError).toContain("unreachable");
    expect(update.attempts).toEqual({ increment: 1 });
  });

  it("falha de PROVISIONAMENTO grava failed, não pending_delivery", async () => {
    modulos({ "vendas.max": true });
    mockPrisma.orgMembership.count.mockResolvedValue(2 as never);

    await syncMaxForOrg(ORG);

    expect(estadoGravado().create.status).toBe("failed");
  });

  it("desligar os dois módulos grava revoked e limpa o erro", async () => {
    modulos({ "vendas.max": false, "locacao.max": false });
    mockPrisma.userApiToken.updateMany.mockResolvedValue({ count: 1 } as never);

    await syncMaxForOrg(ORG);

    const { create } = estadoGravado();
    expect(create.status).toBe("revoked");
    expect(create.lastError).toBeNull();
  });

  /**
   * O provisionamento já aconteceu quando esta linha é gravada. Derrubar a
   * resposta do painel por causa da observabilidade trocaria um problema de
   * visibilidade por um de funcionamento.
   */
  it("falha ao gravar o estado NÃO derruba o sync", async () => {
    modulos({ "vendas.max": true });
    mockPrisma.agentProvisioning.upsert.mockRejectedValue(
      new Error("coluna nao existe") as never
    );

    const r = await syncMaxForOrg(ORG);

    expect(r).toEqual({ action: "provisioned", delivered: true });
  });
});

/**
 * O Bearer do agente resolve a org pela membership do dono do token. Sem a
 * marca, um admin do tenant limpando a lista de membros derruba o agente — e em
 * silêncio, porque nada falha até a próxima chamada.
 */
describe("membership de serviço", () => {
  it("nasce marcada como isSystem, e a marca é reaplicada no update", async () => {
    await provisionMaxForOrg({ orgId: ORG });

    const args = mockPrisma.orgMembership.upsert.mock.calls[0][0] as {
      create: { isSystem: boolean };
      update: { isSystem: boolean };
    };
    expect(args.create.isSystem).toBe(true);
    // No update também: memberships criadas antes do campo existir só ganham a
    // marca no primeiro sync.
    expect(args.update.isSystem).toBe(true);
  });
});
