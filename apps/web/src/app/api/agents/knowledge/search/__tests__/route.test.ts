/**
 * Onde o agente externo lê a base de conhecimento do tenant.
 *
 * O que este arquivo protege não é o ranking dos resultados (isso é do RAG) —
 * é o ESCOPO: um token de integração não pode consultar a base com a lente de
 * um agente interno, nem continuar consultando depois de desligado no console,
 * nem furar o teto mensal pelo caminho barato-mas-frequente.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "../route";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { __resetAgentProfileCacheForTests } from "@/lib/ai/agents/resolve";
import { searchKnowledgeBase } from "@/lib/ai/knowledge-search";

vi.mock("@/lib/auth/impersonation", () => ({
  getImpersonationFor: vi.fn().mockResolvedValue(null),
}));
vi.mock("@/lib/ai/knowledge-search", () => ({
  searchKnowledgeBase: vi
    .fn()
    .mockResolvedValue({ results: [], mode: "semantic" }),
}));

const mockAuth = vi.mocked(auth);
const mockGetUserOrg = vi.mocked(getUserOrg);
const mockPrisma = vi.mocked(prisma);
const search = vi.mocked(searchKnowledgeBase);

function req(body: unknown, token?: string) {
  return new NextRequest("http://localhost/api/agents/knowledge/search", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

function tokenComEscopos(scopes: string[]) {
  mockPrisma.userApiToken.findUnique.mockResolvedValue({
    id: "tok-1",
    userId: "user-1",
    scopes,
    revokedAt: null,
    expiresAt: null,
  } as never);
}

const OK = { agentKey: "max", query: "como funciona a esteira de locação?" };

beforeEach(() => {
  vi.clearAllMocks();
  // Tenant com o Max contratado. Sem isto o gate de entitlement
  // (`maxAgentRouteGate`) recusa com 403 — a feature nasce OFF no catálogo.
  mockPrisma.orgModule.findMany.mockResolvedValue([
    { module: "vendas", enabled: true, featureFlags: { "vendas.max": true } },
  ] as never);
  __resetAgentProfileCacheForTests();
  mockAuth.mockResolvedValue(null as never);
  mockGetUserOrg.mockResolvedValue({ id: "org-1" } as never);
  mockPrisma.userApiToken.update.mockResolvedValue({} as never);
  mockPrisma.agentProfile.findFirst.mockResolvedValue(null as never);
  mockPrisma.agentProfile.findUnique.mockResolvedValue(null as never);
  mockPrisma.aIUsage.aggregate.mockResolvedValue({
    _sum: { estimatedCostUsd: 0 },
  } as never);
  search.mockResolvedValue({ results: [], mode: "semantic" });
});

describe("POST /api/agents/knowledge/search", () => {
  it("401 sem autenticação nenhuma", async () => {
    expect((await POST(req(OK))).status).toBe(401);
  });

  it("403 com token sem o escopo agents:r", async () => {
    tokenComEscopos(["locacao:rw"]);
    expect((await POST(req(OK, "cmt_x"))).status).toBe(403);
  });

  it("consulta com agents:r e repassa o agentKey (é ele que dá escopo)", async () => {
    tokenComEscopos(["agents:r"]);

    const res = await POST(req(OK, "cmt_x"));

    expect(res.status).toBe(200);
    expect(search).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: "org-1",
        agentKey: "max",
        query: OK.query,
      })
    );
  });

  /**
   * Sem esta trava, um token de integração consultaria a base com a lente de um
   * especialista interno — escopo que o tenant configurou para outro fim.
   */
  it("400 pra agente INTERNO, mesmo com escopo válido", async () => {
    tokenComEscopos(["agents:r"]);

    const res = await POST(req({ ...OK, agentKey: "legal" }, "cmt_x"));

    expect(res.status).toBe(400);
    expect(search).not.toHaveBeenCalled();
  });

  it("400 sem query", async () => {
    tokenComEscopos(["agents:r"]);
    const res = await POST(req({ agentKey: "max" }, "cmt_x"));
    expect(res.status).toBe(400);
    expect(search).not.toHaveBeenCalled();
  });

  /**
   * 403 aqui é inequívoco, diferente de `GET /api/agents/profile` (onde
   * `enabled: false` responde 200 porque aquela rota É como o agente descobre
   * que está desligado). Quem chega aqui já leu o perfil.
   */
  it("403 quando o agente está desligado no console do tenant", async () => {
    tokenComEscopos(["agents:r"]);
    mockPrisma.agentProfile.findUnique.mockResolvedValue({
      orgId: "org-1",
      agentKey: "max",
      enabled: false,
    } as never);

    const res = await POST(req(OK, "cmt_x"));

    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: "AGENT_DISABLED" });
    expect(search).not.toHaveBeenCalled();
  });

  /**
   * Uma pergunta no WhatsApp = uma embedding. Sem gate, o teto mensal do agente
   * seria contornável exatamente pelo caminho de maior volume.
   */
  it("402 quando o agente estourou o teto mensal", async () => {
    tokenComEscopos(["agents:r"]);
    mockPrisma.agentProfile.findUnique.mockResolvedValue({
      orgId: "org-1",
      agentKey: "max",
      enabled: true,
      monthlyBudgetUsd: 10,
    } as never);
    mockPrisma.aIUsage.aggregate.mockResolvedValue({
      _sum: { estimatedCostUsd: 12 },
    } as never);

    const res = await POST(req(OK, "cmt_x"));

    expect(res.status).toBe(402);
    expect(await res.json()).toMatchObject({ error: "AGENT_BUDGET_EXCEEDED" });
    expect(search).not.toHaveBeenCalled();
  });
});

/**
 * O entitlement (`vendas.max`/`locacao.max`) e o kill switch
 * (`AgentProfile.enabled`) respondem perguntas DIFERENTES: "esta imobiliária
 * contratou o Max?" e "o Max está ligado nela?". Até este lote, só a segunda era
 * verificada aqui — o flag do catálogo controlava o ImobPro FALAR com o Max, mas
 * não o Max LER o tenant. Um token válido continuava lendo a base de uma org que
 * nunca ligou o agente, ou que desligou.
 */
describe("entitlement do tenant", () => {
  it("403 MODULE_DISABLED quando a org não contratou o Max", async () => {
    tokenComEscopos(["agents:r"]);
    // Nenhuma feature do Max ligada (o default do catálogo é false).
    mockPrisma.orgModule.findMany.mockResolvedValue([
      { module: "vendas", enabled: true, featureFlags: {} },
    ] as never);

    const res = await POST(req(OK, "cmt_x"));

    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: "MODULE_DISABLED" });
    expect(search).not.toHaveBeenCalled();
  });

  it("locacao.max sozinha já habilita — o token cobre os dois módulos", async () => {
    tokenComEscopos(["agents:r"]);
    mockPrisma.orgModule.findMany.mockResolvedValue([
      { module: "locacao", enabled: true, featureFlags: { "locacao.max": true } },
    ] as never);

    expect((await POST(req(OK, "cmt_x"))).status).toBe(200);
  });

  /**
   * A UI (`/admin/agents`, `/settings/ai-agents`) usa as mesmas rotas, e o
   * operador precisa ver a configuração do Max justamente pra decidir se liga a
   * feature. Gatear a sessão criaria um ovo-e-galinha na tela que resolve o
   * problema.
   */
  it("sessão NÃO é gateada pelo entitlement", async () => {
    mockAuth.mockResolvedValue({ user: { id: "user-1" } } as never);
    mockPrisma.orgModule.findMany.mockResolvedValue([
      { module: "vendas", enabled: true, featureFlags: {} },
    ] as never);

    expect((await POST(req(OK))).status).toBe(200);
  });
});
