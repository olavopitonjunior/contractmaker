/**
 * O que este arquivo protege: as três garantias do restaurar.
 *
 * 1. Restaurar NUNCA é rewind — passa pelo upsert normal e gera versão nova.
 * 2. A versão só restaura no (agentKey, escopo) dela — cruzar seria
 *    corrupção silenciosa de config.
 * 3. Snapshot com modelo aposentado/não-permitido é 409, não aplicação cega
 *    — restaurar não pode re-quebrar o chat com um 404 da API do modelo.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "../[versionId]/restore/route";
import { auth } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { __resetAgentProfileCacheForTests } from "@/lib/ai/agents/resolve";

vi.mock("@/lib/auth/impersonation", () => ({
  getImpersonationFor: vi.fn().mockResolvedValue(null),
  getImpersonationAuditMeta: vi.fn().mockResolvedValue(null),
}));

const mockAuth = vi.mocked(auth);
const mockPrisma = vi.mocked(prisma);

function call(agentKey: string, versionId: string) {
  return POST(
    new NextRequest(
      `http://localhost/api/admin/agents/${agentKey}/versions/${versionId}/restore`,
      { method: "POST" }
    ),
    { params: { agentKey, versionId } }
  );
}

function versao(over: Record<string, unknown> = {}) {
  return {
    id: "v1",
    orgId: null,
    agentKey: "editor",
    snapshot: {
      enabled: true,
      model: "claude-haiku-4-5-20251001",
      fallbackModel: null,
      temperature: null,
      maxTokens: null,
      instructions: "instrução antiga",
      ragScope: null,
      monthlyBudgetUsd: null,
      config: null,
    },
    updatedBy: "u1",
    createdAt: new Date(),
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  __resetAgentProfileCacheForTests();
  mockAuth.mockResolvedValue({ user: { id: "staff-1" } } as never);
  mockPrisma.platformRole.findUnique.mockResolvedValue({
    userId: "staff-1",
    role: "super_admin",
    scope: [],
  } as never);
  mockPrisma.agentProfileVersion.findUnique.mockResolvedValue(versao() as never);
  mockPrisma.agentProfile.findFirst.mockResolvedValue(null as never);
  mockPrisma.agentProfile.create.mockResolvedValue({
    enabled: true,
    model: "claude-haiku-4-5-20251001",
    fallbackModel: null,
    temperature: null,
    maxTokens: null,
    instructions: "instrução antiga",
    ragScope: null,
    monthlyBudgetUsd: null,
    config: null,
  } as never);
});

describe("POST restore", () => {
  it("support não restaura (403) — mesmo gate do prompt", async () => {
    mockPrisma.platformRole.findUnique.mockResolvedValue({
      userId: "staff-1",
      role: "support",
      scope: [],
    } as never);
    expect((await call("editor", "v1")).status).toBe(403);
  });

  it("versão de OUTRO agente é 404 — nunca cruza config", async () => {
    mockPrisma.agentProfileVersion.findUnique.mockResolvedValue(
      versao({ agentKey: "legal" }) as never
    );
    expect((await call("editor", "v1")).status).toBe(404);
  });

  it("org da versão foi excluída: 404 explicado, não P2003/500 (review #235)", async () => {
    mockPrisma.agentProfileVersion.findUnique.mockResolvedValue(
      versao({ orgId: "org-apagada" }) as never
    );
    mockPrisma.organization.findUnique.mockResolvedValue(null as never);
    const res = await call("editor", "v1");
    expect(res.status).toBe(404);
    expect((await res.json()).error).toContain("excluída");
    expect(mockPrisma.agentProfile.create).not.toHaveBeenCalled();
  });

  it("snapshot pré-guard com campo que o runtime não honra: 409 via store (review #235)", async () => {
    // aggregator não honra modelo — o guard agora mora no upsertAgentProfile,
    // então TODO escritor herda, inclusive o restore.
    mockPrisma.agentProfileVersion.findUnique.mockResolvedValue(
      versao({
        agentKey: "aggregator",
        snapshot: { ...versao().snapshot, model: "claude-sonnet-4-6" },
      }) as never
    );
    const res = await call("aggregator", "v1");
    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain("modelo");
    expect(mockPrisma.agentProfile.create).not.toHaveBeenCalled();
  });

  it("snapshot com modelo não-permitido é 409, não aplicação cega", async () => {
    mockPrisma.agentProfileVersion.findUnique.mockResolvedValue(
      versao({
        snapshot: { ...versao().snapshot, model: "claude-2.1" },
      }) as never
    );
    const res = await call("editor", "v1");
    expect(res.status).toBe(409);
    expect(mockPrisma.agentProfile.create).not.toHaveBeenCalled();
  });

  it("restaura pelo caminho normal: escreve o perfil E gera versão nova", async () => {
    const res = await call("editor", "v1");
    expect(res.status).toBe(200);
    // Escrita do perfil com o snapshot antigo…
    expect(mockPrisma.agentProfile.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          agentKey: "editor",
          instructions: "instrução antiga",
          updatedBy: "staff-1",
        }),
      })
    );
    // …e o histórico ganha a versão NOVA (restauração é evento, não rewind).
    expect(mockPrisma.agentProfileVersion.create).toHaveBeenCalled();
  });
});
