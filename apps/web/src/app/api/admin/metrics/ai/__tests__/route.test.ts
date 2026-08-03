/**
 * O que este arquivo protege: a contabilidade do painel cross-tenant.
 *
 * A lógica da rota é o FOLDING — linha sem agentKey vai pra "Infraestrutura"
 * quando a operação é de encanamento e pra "Não atribuído" quando não é;
 * orgId nulo vira a linha "Plataforma". Errar qualquer um desses re-esconde
 * exatamente o custo que a tela existe pra mostrar.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "../route";
import { auth } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";

vi.mock("@/lib/auth/impersonation", () => ({
  getImpersonationFor: vi.fn().mockResolvedValue(null),
}));

const mockAuth = vi.mocked(auth);
const mockPrisma = vi.mocked(prisma);

function req(query = "") {
  return new NextRequest(`http://localhost/api/admin/metrics/ai${query}`);
}

function grupo(over: Record<string, unknown>) {
  return {
    orgId: "org-1",
    agentKey: null,
    provider: "anthropic",
    model: "claude-haiku-4-5-20251001",
    operation: "chat",
    _sum: { estimatedCostUsd: 1, totalTokens: 1000 },
    _count: { _all: 1 },
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue({ user: { id: "staff-1" } } as never);
  mockPrisma.platformRole.findUnique.mockResolvedValue({
    userId: "staff-1",
    role: "support",
    scope: [],
  } as never);
  mockPrisma.organization.findMany.mockResolvedValue([
    { id: "org-1", name: "Newcore" },
  ] as never);
  mockPrisma.aIUsage.groupBy.mockResolvedValue([] as never);
});

describe("GET /api/admin/metrics/ai", () => {
  it("401/403 sem sessão ou sem PlatformRole", async () => {
    mockAuth.mockResolvedValue(null as never);
    expect((await GET(req())).status).toBe(401);
    mockAuth.mockResolvedValue({ user: { id: "u" } } as never);
    mockPrisma.platformRole.findUnique.mockResolvedValue(null as never);
    expect((await GET(req())).status).toBe(403);
  });

  it("dobra linha sem agente em Infraestrutura × Não atribuído pela operação", async () => {
    mockPrisma.aIUsage.groupBy.mockResolvedValue([
      grupo({ operation: "embed_kb", _sum: { estimatedCostUsd: 2, totalTokens: 10 } }),
      grupo({ operation: "doc_analysis", _sum: { estimatedCostUsd: 3, totalTokens: 20 } }),
      grupo({ agentKey: "editor", operation: "specialist_editor", _sum: { estimatedCostUsd: 5, totalTokens: 30 } }),
    ] as never);

    const body = await (await GET(req())).json();
    const rotulos = Object.fromEntries(
      body.byAgent.map((r: { label: string; costUsd: number }) => [r.label, r.costUsd])
    );
    expect(rotulos["Infraestrutura"]).toBe(2);
    expect(rotulos["Não atribuído"]).toBe(3);
    expect(rotulos["Editor"]).toBe(5);
    expect(body.totals.costUsd).toBe(10);
  });

  it("orgId nulo vira a linha Plataforma no byOrg", async () => {
    mockPrisma.aIUsage.groupBy.mockResolvedValue([
      grupo({ orgId: null, operation: "embed_kb", _sum: { estimatedCostUsd: 0.5, totalTokens: 5 } }),
      grupo({ _sum: { estimatedCostUsd: 1.5, totalTokens: 15 } }),
    ] as never);

    const body = await (await GET(req())).json();
    const porOrg = Object.fromEntries(
      body.byOrg.map((r: { label: string; costUsd: number }) => [r.label, r.costUsd])
    );
    expect(porOrg["Plataforma"]).toBe(0.5);
    expect(porOrg["Newcore"]).toBe(1.5);
  });

  it("range inválido responde 400, não 500", async () => {
    expect((await GET(req("?from=not-a-date"))).status).toBe(400);
  });
});
