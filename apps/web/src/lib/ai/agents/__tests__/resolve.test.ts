/**
 * Precedência da resolução de AgentProfile: org → plataforma → hardcoded.
 *
 * A regra que mais importa aqui é "null = HERDA, não vazio": é o que permite a
 * org sobrescrever só a instrução sem perder o modelo da plataforma. Um `??`
 * trocado por `||` em qualquer campo quebra isso silenciosamente.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "@/lib/db/prisma";
import {
  resolveAgentProfile,
  invalidateAgentProfileCache,
  __resetAgentProfileCacheForTests,
} from "../resolve";
import { AGENT_REGISTRY } from "../registry";
import { HAIKU_MODEL, SONNET_MODEL } from "../../shared/models";

const platformFind = prisma.agentProfile.findFirst as unknown as ReturnType<typeof vi.fn>;
const orgFind = prisma.agentProfile.findUnique as unknown as ReturnType<typeof vi.fn>;

const row = (over: Record<string, unknown> = {}) => ({
  enabled: true,
  model: null,
  fallbackModel: null,
  temperature: null,
  maxTokens: null,
  instructions: null,
  ragScope: null,
  monthlyBudgetUsd: null,
  config: null,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  __resetAgentProfileCacheForTests();
  platformFind.mockResolvedValue(null);
  orgFind.mockResolvedValue(null);
});

describe("precedência", () => {
  it("sem nenhuma linha → hardcoded do registry", async () => {
    const p = await resolveAgentProfile("editor", "org-1");
    expect(p.model).toBe(AGENT_REGISTRY.editor.defaultModel);
    expect(p.enabled).toBe(true);
    expect(p.platformInstructions).toBeNull();
    expect(p.tenantInstructions).toBeNull();
  });

  it("linha de plataforma vence o hardcoded", async () => {
    platformFind.mockResolvedValue(row({ model: HAIKU_MODEL, instructions: "seja breve" }));
    const p = await resolveAgentProfile("editor", "org-1");
    expect(p.model).toBe(HAIKU_MODEL);
    expect(p.platformInstructions).toBe("seja breve");
  });

  it("linha da org vence a da plataforma", async () => {
    platformFind.mockResolvedValue(row({ model: HAIKU_MODEL }));
    orgFind.mockResolvedValue(row({ model: SONNET_MODEL }));
    const p = await resolveAgentProfile("editor", "org-1");
    expect(p.model).toBe(SONNET_MODEL);
  });

  it("campo null na org HERDA da plataforma em vez de zerar", async () => {
    platformFind.mockResolvedValue(
      row({ model: SONNET_MODEL, temperature: 0.7, instructions: "regra da casa" })
    );
    orgFind.mockResolvedValue(row({ instructions: "cite a matrícula" }));

    const p = await resolveAgentProfile("editor", "org-1");
    expect(p.model).toBe(SONNET_MODEL); // herdado
    expect(p.temperature).toBe(0.7); // herdado
    expect(p.platformInstructions).toBe("regra da casa");
    expect(p.tenantInstructions).toBe("cite a matrícula");
  });

  it("instrução em branco/whitespace é tratada como ausente", async () => {
    orgFind.mockResolvedValue(row({ instructions: "   " }));
    const p = await resolveAgentProfile("editor", "org-1");
    expect(p.tenantInstructions).toBeNull();
  });

  it("modelo aposentado no banco é migrado pelo resolveModel", async () => {
    platformFind.mockResolvedValue(row({ model: "claude-3-5-sonnet-20241022" }));
    const p = await resolveAgentProfile("editor", "org-1");
    expect(p.model).not.toBe("claude-3-5-sonnet-20241022");
    expect(p.model).toContain("sonnet");
  });

  it("orgId null resolve só o nível de plataforma (visão do /admin)", async () => {
    platformFind.mockResolvedValue(row({ model: HAIKU_MODEL }));
    const p = await resolveAgentProfile("editor", null);
    expect(p.model).toBe(HAIKU_MODEL);
    expect(orgFind).not.toHaveBeenCalled();
  });
});

describe("enabled", () => {
  it("plataforma desligada vence a org ligada", async () => {
    platformFind.mockResolvedValue(row({ enabled: false }));
    orgFind.mockResolvedValue(row({ enabled: true }));
    const p = await resolveAgentProfile("editor", "org-1");
    expect(p.enabled).toBe(false);
  });

  it("org desliga o próprio agente", async () => {
    orgFind.mockResolvedValue(row({ enabled: false }));
    const p = await resolveAgentProfile("editor", "org-1");
    expect(p.enabled).toBe(false);
  });
});

describe("budget", () => {
  it("não herda da plataforma — teto global não vira teto por tenant", async () => {
    platformFind.mockResolvedValue(row({ monthlyBudgetUsd: 500 }));
    const p = await resolveAgentProfile("editor", "org-1");
    expect(p.monthlyBudgetUsd).toBeNull();
  });

  it("Decimal do Prisma vira number", async () => {
    orgFind.mockResolvedValue(row({ monthlyBudgetUsd: "12.34" }));
    const p = await resolveAgentProfile("editor", "org-1");
    expect(p.monthlyBudgetUsd).toBe(12.34);
  });
});

describe("cache e resiliência", () => {
  it("cacheia por escopo+agente (1 par de queries)", async () => {
    await resolveAgentProfile("editor", "org-1");
    await resolveAgentProfile("editor", "org-1");
    expect(platformFind).toHaveBeenCalledTimes(1);
    expect(orgFind).toHaveBeenCalledTimes(1);
  });

  it("escopos diferentes não compartilham cache", async () => {
    await resolveAgentProfile("editor", "org-1");
    await resolveAgentProfile("editor", "org-2");
    expect(platformFind).toHaveBeenCalledTimes(2);
  });

  it("invalidar a plataforma limpa também o cache das orgs que herdavam", async () => {
    await resolveAgentProfile("editor", "org-1");
    invalidateAgentProfileCache(null, "editor");
    await resolveAgentProfile("editor", "org-1");
    expect(platformFind).toHaveBeenCalledTimes(2);
  });

  it("falha de DB não derruba o chat — cai no hardcoded", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    platformFind.mockRejectedValue(new Error("connection reset"));
    const p = await resolveAgentProfile("legal", "org-1");
    expect(p.model).toBe(AGENT_REGISTRY.legal.defaultModel);
    expect(p.enabled).toBe(true);
    spy.mockRestore();
  });
});
