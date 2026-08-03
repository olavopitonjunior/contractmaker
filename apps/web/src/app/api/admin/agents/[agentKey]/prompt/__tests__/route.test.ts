/**
 * O que este arquivo protege: quem lê o prompt-base e o que ele contém.
 *
 * O gate é MAIS restrito que o resto do /admin (super_admin, não support):
 * o prompt-base de plataforma é propriedade intelectual do produto — nem o
 * dono do tenant o enxerga. E a composição exibida tem que ser a do runtime
 * (composeSystemPrompt de verdade), senão a tela vira mais uma estimativa.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "../route";
import { auth } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { __resetAgentProfileCacheForTests } from "@/lib/ai/agents/resolve";

vi.mock("@/lib/auth/impersonation", () => ({
  getImpersonationFor: vi.fn().mockResolvedValue(null),
}));

const mockAuth = vi.mocked(auth);
const mockPrisma = vi.mocked(prisma);

function req(agentKey: string, query = "") {
  return new NextRequest(
    `http://localhost/api/admin/agents/${agentKey}/prompt${query}`
  );
}

function call(agentKey: string, query = "") {
  return GET(req(agentKey, query), { params: { agentKey } });
}

function staff(role: "support" | "super_admin") {
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
  mockPrisma.agentProfile.findFirst.mockResolvedValue(null as never);
  mockPrisma.agentProfile.findUnique.mockResolvedValue(null as never);
});

describe("GET /api/admin/agents/[agentKey]/prompt", () => {
  it("support NÃO lê o prompt-base — 403, gate mais restrito que o resto do /admin", async () => {
    staff("support");
    expect((await call("editor")).status).toBe(403);
  });

  it("agente desconhecido é 404", async () => {
    staff("super_admin");
    expect((await call("nao-existe")).status).toBe(404);
  });

  it("especialista traz as DUAS variantes — 'o prompt do Editor' não é uma string", async () => {
    staff("super_admin");
    const body = await (await call("editor")).json();
    expect(body.composition).toBe("append");
    const labels = body.variants.map((v: { label: string }) => v.label);
    expect(labels).toEqual(["venda", "locacao"]);
    for (const v of body.variants) {
      expect(v.base.length).toBeGreaterThan(100);
      // Sem instruções configuradas, o composto É a base.
      expect(v.composed).toBe(v.base);
    }
  });

  it("instrução de plataforma entra COMPOSTA no texto exibido — igual ao runtime", async () => {
    staff("super_admin");
    mockPrisma.agentProfile.findFirst.mockResolvedValue({
      enabled: true,
      model: null,
      fallbackModel: null,
      temperature: null,
      maxTokens: null,
      instructions: "Nunca cite jurisprudência sem número do processo.",
      ragScope: null,
      monthlyBudgetUsd: null,
      config: null,
    } as never);
    const body = await (await call("editor")).json();
    for (const v of body.variants) {
      expect(v.composed).toContain(
        "Nunca cite jurisprudência sem número do processo."
      );
      expect(v.composed).not.toBe(v.base);
    }
  });

  it("support (agente) declara a exceção: instruções SUBSTITUEM a base", async () => {
    staff("super_admin");
    mockPrisma.agentProfile.findFirst.mockResolvedValue({
      enabled: true,
      model: null,
      fallbackModel: null,
      temperature: null,
      maxTokens: null,
      instructions: "Persona nova do suporte.",
      ragScope: null,
      monthlyBudgetUsd: null,
      config: null,
    } as never);
    const body = await (await call("support")).json();
    expect(body.composition).toBe("replace");
    expect(body.variants[0].composed).toBe("Persona nova do suporte.");
  });

  it("max é externo: sem variantes, com a nota do porquê", async () => {
    staff("super_admin");
    const body = await (await call("max")).json();
    expect(body.composition).toBe("external");
    expect(body.variants).toEqual([]);
    expect(body.note).toContain("externo");
  });
});
