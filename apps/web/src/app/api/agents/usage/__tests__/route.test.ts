/**
 * O agente externo reportando o próprio custo.
 *
 * Esta rota é a única em que um cliente de fora ESCREVE na tabela que alimenta
 * o teto mensal por agente e o teto por contrato. Os testes cobrem o que o
 * cliente não pode decidir: de quem é o custo, de que agente, e sobre qual
 * contrato.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "../route";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";

// `requireApiAuth` consulta impersonation no caminho de SESSÃO. Sem o mock, o
// teste da sessão recusada cairia no leitor de cookie real, fora de request.
vi.mock("@/lib/auth/impersonation", () => ({
  getImpersonationFor: vi.fn().mockResolvedValue(null),
}));

const mockAuth = vi.mocked(auth);
const mockGetUserOrg = vi.mocked(getUserOrg);
const mockPrisma = vi.mocked(prisma);

function req(body: unknown, token?: string) {
  return new NextRequest("http://localhost/api/agents/usage", {
    method: "POST",
    headers: token ? { authorization: `Bearer ${token}` } : undefined,
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

const corpoValido = {
  agentKey: "max",
  model: "claude-sonnet-4-6",
  promptTokens: 1200,
  completionTokens: 300,
  latencyMs: 4200,
};

beforeEach(() => {
  vi.clearAllMocks();
  // Tenant com o Max contratado. Sem isto o gate de entitlement
  // (`maxAgentRouteGate`) recusa com 403 — a feature nasce OFF no catálogo.
  mockPrisma.orgModule.findMany.mockResolvedValue([
    { module: "vendas", enabled: true, featureFlags: { "vendas.max": true } },
  ] as never);
  mockAuth.mockResolvedValue(null as never);
  mockGetUserOrg.mockResolvedValue({ id: "org-1" } as never);
  mockPrisma.userApiToken.update.mockResolvedValue({} as never);
  mockPrisma.aIUsage.create.mockResolvedValue({} as never);
});

describe("POST /api/agents/usage", () => {
  it("401 sem autenticação", async () => {
    const res = await POST(req(corpoValido));
    expect(res.status).toBe(401);
  });

  it("403 com agents:r — leitura da persona não move o gasto da org", async () => {
    tokenComEscopos(["agents:r"]);
    const res = await POST(req(corpoValido, "cmt_x"));
    expect(res.status).toBe(403);
    expect(mockPrisma.aIUsage.create).not.toHaveBeenCalled();
  });

  it("403 com SESSÃO, mesmo logado — reportar consumo é ato de máquina", async () => {
    // `hasScope` dá todo escopo por presente pra session-auth. Aceitar sessão
    // aqui deixaria qualquer conta recém-registrada na org compartilhada inflar
    // AIUsage até estourar o teto e parar o chat de todo mundo.
    mockAuth.mockResolvedValue({ user: { id: "user-1", email: "a@b.c" } } as never);
    const res = await POST(req(corpoValido));
    expect(res.status).toBe(403);
    // Prova que parou no gate de máquina, e não por falta de org ou de escopo —
    // esses caminhos dariam 403 pelo mesmo status e o teste passaria à toa.
    expect((await res.json()).reason).toMatch(/máquina-a-máquina/);
    expect(mockPrisma.aIUsage.create).not.toHaveBeenCalled();
  });

  it("403 quando o dono do token não tem org", async () => {
    tokenComEscopos(["agents:rw"]);
    mockGetUserOrg.mockResolvedValue(null as never);
    const res = await POST(req(corpoValido, "cmt_x"));
    expect(res.status).toBe(403);
    expect(mockPrisma.aIUsage.create).not.toHaveBeenCalled();
  });

  it("400 pra agente interno — não dá pra queimar o teto do Editor de fora", async () => {
    tokenComEscopos(["agents:rw"]);
    const res = await POST(req({ ...corpoValido, agentKey: "editor" }, "cmt_x"));
    expect(res.status).toBe(400);
    expect(mockPrisma.aIUsage.create).not.toHaveBeenCalled();
  });

  it("400 em contagem absurda de tokens", async () => {
    // O teto existe porque UMA linha inflada estoura o budget de um contrato
    // (assertContractBudget soma totalTokens por contractId, limite 200k).
    tokenComEscopos(["agents:rw"]);
    for (const promptTokens of [999_000_000, 500_001]) {
      const res = await POST(req({ ...corpoValido, promptTokens }, "cmt_x"));
      expect(res.status).toBe(400);
    }
    expect(mockPrisma.aIUsage.create).not.toHaveBeenCalled();
  });

  it("403 quando o contractId é de outra org", async () => {
    // Sem isto, um token de qualquer tenant carimbaria consumo no contrato de
    // outro e estouraria o budget alheio — assertContractBudget soma por
    // contractId, sem olhar org.
    tokenComEscopos(["agents:rw"]);
    mockPrisma.contract.findUnique.mockResolvedValue({
      deal: { pipeline: { orgId: "org-DA-OUTRA" } },
    } as never);

    const res = await POST(
      req({ ...corpoValido, contractId: "ct-alheio" }, "cmt_x")
    );
    expect(res.status).toBe(403);
    expect(mockPrisma.aIUsage.create).not.toHaveBeenCalled();
  });

  it("403 quando o dealId é de outra org", async () => {
    // Ramo irmão do contractId, e independente: uma regressão só nele passaria
    // verde se o teste cobrisse apenas o contrato.
    tokenComEscopos(["agents:rw"]);
    mockPrisma.deal.findUnique.mockResolvedValue({
      pipeline: { orgId: "org-DA-OUTRA" },
    } as never);

    const res = await POST(req({ ...corpoValido, dealId: "d-alheio" }, "cmt_x"));
    expect(res.status).toBe(403);
    expect(mockPrisma.aIUsage.create).not.toHaveBeenCalled();
  });

  it("202 grava com a org do TOKEN e a operation do registry", async () => {
    tokenComEscopos(["agents:rw"]);
    const res = await POST(
      // orgId no corpo é ignorado de propósito — a atribuição vem do token.
      req({ ...corpoValido, orgId: "org-INVENTADA" }, "cmt_x")
    );
    expect(res.status).toBe(202);

    const json = await res.json();
    expect(json.accepted).toBe(true);
    expect(json.orgId).toBe("org-1");
    expect(json.operation).toBe("max_chat");

    expect(mockPrisma.aIUsage.create).toHaveBeenCalledTimes(1);
    const data = mockPrisma.aIUsage.create.mock.calls[0][0].data;
    expect(data.orgId).toBe("org-1");
    expect(data.agentKey).toBe("max");
    expect(data.operation).toBe("max_chat");
    expect(data.userId).toBe("user-1");
    expect(data.promptTokens).toBe(1200);
  });

  it("modelo fora da tabela de preços vem marcado como não precificado", async () => {
    // Custo 0 por falta de preço parece turn de graça no painel. Quem integra
    // precisa conseguir distinguir os dois casos.
    tokenComEscopos(["agents:rw"]);
    const json = await (
      await POST(req({ ...corpoValido, model: "modelo-que-nao-existe" }, "cmt_x"))
    ).json();
    expect(json.estimatedCostUsd).toBe(0);
    expect(json.priced).toBe(false);
  });

  it("custo é calculado aqui, não aceito do cliente", async () => {
    tokenComEscopos(["agents:rw"]);
    const json = await (
      await POST(req({ ...corpoValido, estimatedCostUsd: 999 }, "cmt_x"))
    ).json();
    expect(json.estimatedCostUsd).toBeGreaterThan(0);
    expect(json.estimatedCostUsd).toBeLessThan(1);
  });

  /**
   * A EXCEÇÃO do `costUsd`, e ela vale só para o OpenRouter porque ali o
   * número não é auto-declarado pelo agente: é o crédito que a fatura do
   * provedor cobrou (`usage.cost`, inline na resposta). O Max só transporta.
   */
  describe("costUsd — crédito real do provedor", () => {
    const openrouter = {
      ...corpoValido,
      provider: "openrouter",
      model: "openai/gpt-5.4-nano",
    };

    it("do openrouter, o reportado VENCE a tabela de preços", async () => {
      tokenComEscopos(["agents:rw"]);
      // Os números medidos em 21/08 no turn com cache de prefixo.
      const res = await POST(
        req({ ...openrouter, promptTokens: 1956, cacheReadTokens: 1792, costUsd: 0.00010614 }, "cmt_x")
      );
      const json = await res.json();

      expect(json.costSource).toBe("reported");
      expect(json.costUsd).toBeCloseTo(0.00010614, 8);
      // A estimativa continua exposta: é o que permite medir o erro da tabela
      // sem acesso ao banco. Aqui ela é MAIOR que o real — o tal dos 304%.
      expect(json.estimatedCostUsd).toBeGreaterThan(json.costUsd);

      const data = mockPrisma.aIUsage.create.mock.calls[0][0].data;
      expect(Number(data.estimatedCostUsd)).toBeCloseTo(0.00010614, 8);
      expect(data.costSource).toBe("reported");
    });

    it("sem costUsd, cai na tabela e marca como estimado", async () => {
      tokenComEscopos(["agents:rw"]);
      const json = await (await POST(req(openrouter, "cmt_x"))).json();
      expect(json.costSource).toBe("estimated");
      expect(json.costUsd).toBeGreaterThan(0);
      expect(mockPrisma.aIUsage.create.mock.calls[0][0].data.costSource).toBe("estimated");
    });

    /**
     * `null` é o jeito do emissor dizer "o provedor não informou". Tem que ser
     * aceito como ausência, não virar 400 — senão todo turn sem custo do
     * provedor pararia de ser contabilizado.
     */
    it("costUsd null é ausência, não erro", async () => {
      tokenComEscopos(["agents:rw"]);
      const res = await POST(req({ ...openrouter, costUsd: null }, "cmt_x"));
      expect(res.status).toBe(202);
      expect((await res.json()).costSource).toBe("estimated");
    });

    /**
     * A asserção mais sutil do contrato, e a que mais fácil se quebra sem
     * querer: **`0` é um custo MEDIDO, não ausência.** Um modelo `:free` do
     * OpenRouter cobra zero de verdade, e essa linha tem que nascer
     * `reported` — tratá-la como ausência a mandaria para a tabela de preços,
     * que cobraria um modelo gratuito a preço cheio.
     *
     * Quem diz "não sei" é `null`, e só ele.
     */
    it("costUsd ZERO é medido, não ausência (modelo :free cobra zero de verdade)", async () => {
      tokenComEscopos(["agents:rw"]);
      const json = await (
        await POST(req({ ...openrouter, costUsd: 0 }, "cmt_x"))
      ).json();

      expect(json.costSource).toBe("reported");
      expect(json.costUsd).toBe(0);
      expect(Number(mockPrisma.aIUsage.create.mock.calls[0][0].data.estimatedCostUsd)).toBe(0);
      expect(mockPrisma.aIUsage.create.mock.calls[0][0].data.costSource).toBe("reported");
    });

    /**
     * `priced` é sobre a TABELA DE PREÇOS, não sobre o custo gravado. Se ele
     * passasse a olhar `costUsd`, o modelo gratuito acima apareceria como
     * "fora da tabela" — dois fatos diferentes na mesma flag.
     */
    it("custo real zero NÃO faz o modelo parecer fora da tabela de preços", async () => {
      tokenComEscopos(["agents:rw"]);
      const json = await (
        await POST(req({ ...openrouter, costUsd: 0 }, "cmt_x"))
      ).json();
      expect(json.priced).toBe(true);
      expect(json.estimatedCostUsd).toBeGreaterThan(0);
    });

    /** De outro provider é descartado EM SILÊNCIO — o campo é aditivo. */
    it("de outro provider é ignorado, sem quebrar", async () => {
      tokenComEscopos(["agents:rw"]);
      const res = await POST(
        req({ ...corpoValido, provider: "anthropic", costUsd: 0.5 }, "cmt_x")
      );
      expect(res.status).toBe(202);
      const json = await res.json();
      expect(json.costSource).toBe("estimated");
      expect(json.costUsd).toBeLessThan(0.5);
      expect(mockPrisma.aIUsage.create.mock.calls[0][0].data.costSource).toBe("estimated");
    });

    /**
     * O teto de sanidade próprio deste campo: é o único que entra na tabela de
     * custo sem passar pela tabela de preços, então precisa da própria cerca.
     */
    it("400 em custo absurdo", async () => {
      tokenComEscopos(["agents:rw"]);
      const res = await POST(req({ ...openrouter, costUsd: 99 }, "cmt_x"));
      expect(res.status).toBe(400);
      expect(mockPrisma.aIUsage.create).not.toHaveBeenCalled();
    });
  });
});
