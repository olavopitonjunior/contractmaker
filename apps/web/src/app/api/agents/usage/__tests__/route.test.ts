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

  it("400 pra agente interno — não dá pra queimar o teto do Editor de fora", async () => {
    tokenComEscopos(["agents:rw"]);
    const res = await POST(req({ ...corpoValido, agentKey: "editor" }, "cmt_x"));
    expect(res.status).toBe(400);
    expect(mockPrisma.aIUsage.create).not.toHaveBeenCalled();
  });

  it("400 em contagem absurda de tokens", async () => {
    tokenComEscopos(["agents:rw"]);
    const res = await POST(
      req({ ...corpoValido, promptTokens: 999_000_000 }, "cmt_x")
    );
    expect(res.status).toBe(400);
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
});
