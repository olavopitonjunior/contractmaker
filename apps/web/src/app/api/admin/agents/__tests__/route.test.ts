/**
 * O que este arquivo protege: a linha "última alteração por X" do console.
 *
 * `updatedBy` foi gravado em toda escrita desde o primeiro dia do console e
 * nunca lido — este PR o expõe. O risco não é o formato: é regredir de volta
 * pro estado em que o dado existe no banco e a tela não o mostra, sem nenhum
 * teste acusar.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { GET, PATCH } from "../route";
import { auth } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { __resetAgentProfileCacheForTests } from "@/lib/ai/agents/resolve";

vi.mock("@/lib/auth/impersonation", () => ({
  getImpersonationFor: vi.fn().mockResolvedValue(null),
}));

const mockAuth = vi.mocked(auth);
const mockPrisma = vi.mocked(prisma);

function req(query = "") {
  return new NextRequest(`http://localhost/api/admin/agents${query}`);
}

function staffLogado(role: "support" | "super_admin" = "support") {
  mockAuth.mockResolvedValue({ user: { id: "staff-1" } } as never);
  mockPrisma.platformRole.findUnique.mockResolvedValue({
    userId: "staff-1",
    role,
    scope: [],
  } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  __resetAgentProfileCacheForTests();
  mockAuth.mockResolvedValue(null as never);
  // Cadeia de resolução (resolveAgentProfile) sem linhas → hardcoded.
  mockPrisma.agentProfile.findFirst.mockResolvedValue(null as never);
  mockPrisma.agentProfile.findUnique.mockResolvedValue(null as never);
  mockPrisma.agentProfile.findMany.mockResolvedValue([] as never);
  mockPrisma.user.findMany.mockResolvedValue([] as never);
});

describe("GET /api/admin/agents", () => {
  it("401 sem sessão", async () => {
    const res = await GET(req());
    expect(res.status).toBe(401);
  });

  it("403 pra quem não é staff de plataforma", async () => {
    mockAuth.mockResolvedValue({ user: { id: "user-comum" } } as never);
    mockPrisma.platformRole.findUnique.mockResolvedValue(null as never);
    const res = await GET(req());
    expect(res.status).toBe(403);
  });

  it("resolve updatedBy pra nome e expõe updatedAt no own", async () => {
    staffLogado();
    const quando = new Date("2026-08-01T12:00:00Z");
    mockPrisma.agentProfile.findMany.mockResolvedValue([
      {
        agentKey: "editor",
        orgId: null,
        enabled: true,
        model: null,
        fallbackModel: null,
        temperature: null,
        maxTokens: null,
        instructions: null,
        ragScope: null,
        monthlyBudgetUsd: null,
        updatedBy: "user-olavo",
        updatedAt: quando,
      },
    ] as never);
    mockPrisma.user.findMany.mockResolvedValue([
      { id: "user-olavo", name: "Olavo", email: "olavo@x.com" },
    ] as never);

    const res = await GET(req());
    expect(res.status).toBe(200);
    const body = await res.json();
    const editor = body.agents.find(
      (a: { agentKey: string }) => a.agentKey === "editor"
    );
    expect(editor.own.updatedByName).toBe("Olavo");
    expect(editor.own.updatedAt).toBe(quando.toISOString());
    // Nome resolvido num lote só, com o id certo — e SEM email no select:
    // o GET é legível por `support`, e email de staff não é "nome".
    expect(mockPrisma.user.findMany).toHaveBeenCalledWith({
      where: { id: { in: ["user-olavo"] } },
      select: { id: true, name: true },
    });
  });

  it("sem linha no banco: updatedAt/updatedByName nulos e nenhum lookup de user", async () => {
    staffLogado();
    const res = await GET(req());
    expect(res.status).toBe(200);
    const body = await res.json();
    for (const a of body.agents) {
      expect(a.own.updatedAt).toBeNull();
      expect(a.own.updatedByName).toBeNull();
    }
    expect(mockPrisma.user.findMany).not.toHaveBeenCalled();
  });

  it("aba de custo/procedência: provenance e modelsSeen presentes por agente", async () => {
    staffLogado();
    const res = await GET(req());
    const body = await res.json();
    for (const a of body.agents) {
      expect(Array.isArray(a.provenance)).toBe(true);
      expect(a.provenance.length).toBeGreaterThan(0);
      expect(Array.isArray(a.modelsSeen)).toBe(true);
    }
  });

  it("updatedBy de usuário apagado degrada pro id cru, não pra erro", async () => {
    staffLogado();
    mockPrisma.agentProfile.findMany.mockResolvedValue([
      {
        agentKey: "editor",
        orgId: null,
        enabled: true,
        model: null,
        fallbackModel: null,
        temperature: null,
        maxTokens: null,
        instructions: null,
        ragScope: null,
        monthlyBudgetUsd: null,
        updatedBy: "user-fantasma",
        updatedAt: new Date(),
      },
    ] as never);
    mockPrisma.user.findMany.mockResolvedValue([] as never);

    const res = await GET(req());
    expect(res.status).toBe(200);
    const body = await res.json();
    const editor = body.agents.find(
      (a: { agentKey: string }) => a.agentKey === "editor"
    );
    expect(editor.own.updatedByName).toBe("user-fantasma");
  });
});

function patchReq(body: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/admin/agents", {
    method: "PATCH",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

describe("PATCH /api/admin/agents — guard de supports (review #229)", () => {
  it("rejeita configuração que o runtime não honra, nomeando o campo", async () => {
    staffLogado("super_admin");
    // aggregator: supports todo false — modelo via curl gravaria config
    // fantasma que a próxima pessoa a ler o banco acharia em vigor.
    const res = await PATCH(
      patchReq({ orgId: null, agentKey: "aggregator", model: "claude-sonnet-4-6" })
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("modelo");

    // passive: honra modelo mas não instruções.
    const res2 = await PATCH(
      patchReq({ orgId: null, agentKey: "passive", instructions: "x" })
    );
    expect(res2.status).toBe(400);
    expect((await res2.json()).error).toContain("instruções");
  });

  it("aceita campo que o runtime honra (passive.model) e grava com updatedBy", async () => {
    staffLogado("super_admin");
    const res = await PATCH(
      patchReq({ orgId: null, agentKey: "passive", model: "claude-sonnet-4-6" })
    );
    expect(res.status).toBe(200);
    expect(mockPrisma.agentProfile.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          agentKey: "passive",
          model: "claude-sonnet-4-6",
          updatedBy: "staff-1",
        }),
      })
    );
  });

  it("support (leitura) não escreve: 403", async () => {
    staffLogado("support");
    const res = await PATCH(
      patchReq({ orgId: null, agentKey: "editor", model: "claude-sonnet-4-6" })
    );
    expect(res.status).toBe(403);
  });
});
