import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { GET, PATCH, DELETE } from "../route";
import { requireAuth } from "@/lib/auth/context";
import { requirePermission, PermissionDeniedError } from "@/lib/security/rbac/guard";
import { prisma } from "@/lib/db/prisma";
import {
  resolveSlaPolicies,
  recomputeSlaDeadlines,
} from "@/lib/pipeline/sla-policies";

vi.mock("@/lib/auth/context", () => ({ requireAuth: vi.fn() }));
vi.mock("@/lib/security/rbac/guard", async (orig) => ({
  ...(await orig<typeof import("@/lib/security/rbac/guard")>()),
  requirePermission: vi.fn(),
}));
vi.mock("@/lib/security/audit", () => ({
  audit: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@vercel/functions", () => ({ waitUntil: vi.fn() }));
vi.mock("@/lib/pipeline/sla-policies", () => ({
  resolveSlaPolicies: vi.fn(),
  recomputeSlaDeadlines: vi.fn().mockResolvedValue({ stages: 0 }),
}));

const auth = vi.mocked(requireAuth);
const perm = vi.mocked(requirePermission);
const resolve = vi.mocked(resolveSlaPolicies);
const recompute = vi.mocked(recomputeSlaDeadlines);
const upsert = vi.mocked(prisma.slaPolicy.upsert);
const deleteMany = vi.mocked(prisma.slaPolicy.deleteMany);

const POLICIES = [
  {
    stageId: "s0",
    stageName: "Formulário",
    position: 0,
    terminal: false,
    warnDays: 5,
    dangerDays: 10,
    enabled: true,
    source: "default" as const,
  },
  {
    stageId: "s5",
    stageName: "Comissão paga",
    position: 5,
    terminal: true,
    warnDays: null,
    dangerDays: null,
    enabled: false,
    source: "default" as const,
  },
];

function req(method: string, body?: unknown, kind = "venda") {
  return new NextRequest(`http://localhost/api/org/sla-policies?kind=${kind}`, {
    method,
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  auth.mockResolvedValue({
    ok: true,
    ctx: { orgId: "org-1", userId: "u-1" },
  } as never);
  perm.mockResolvedValue(undefined as never);
  resolve.mockResolvedValue(POLICIES);
  deleteMany.mockResolvedValue({ count: 1 } as never);
});

describe("GET /api/org/sla-policies", () => {
  it("membro lê o resolvido; kind inválido → 400", async () => {
    const res = await GET(req("GET"));
    expect(res.status).toBe(200);
    expect((await res.json()).policies).toHaveLength(2);

    const bad = await GET(req("GET", undefined, "xpto"));
    expect(bad.status).toBe(400);
  });
});

describe("PATCH /api/org/sla-policies", () => {
  it("upserta política por stage e agenda recompute", async () => {
    const res = await PATCH(
      req("PATCH", {
        kind: "venda",
        policies: [{ stageId: "s0", warnDays: 3, dangerDays: 7, enabled: true }],
      })
    );
    expect(res.status).toBe(200);
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          orgId_scope_key: { orgId: "org-1", scope: "deal_stage", key: "s0" },
        },
        create: expect.objectContaining({ warnDays: 3, dangerDays: 7 }),
      })
    );
    expect(recompute).toHaveBeenCalledWith("org-1", "venda");
  });

  it("stage terminal/desconhecido → 400, nada gravado", async () => {
    const res = await PATCH(
      req("PATCH", {
        kind: "venda",
        policies: [{ stageId: "s5", warnDays: 3, dangerDays: 7, enabled: true }],
      })
    );
    expect(res.status).toBe(400);
    expect(upsert).not.toHaveBeenCalled();
  });

  it("dangerDays < warnDays → 400 (Zod refine)", async () => {
    const res = await PATCH(
      req("PATCH", {
        kind: "venda",
        policies: [{ stageId: "s0", warnDays: 10, dangerDays: 3, enabled: true }],
      })
    );
    expect(res.status).toBe(400);
  });

  it("sem ORG_SETTINGS_EDIT → 403", async () => {
    perm.mockRejectedValue(new PermissionDeniedError("org.settings.edit"));
    const res = await PATCH(
      req("PATCH", {
        kind: "venda",
        policies: [{ stageId: "s0", warnDays: 3, dangerDays: 7, enabled: true }],
      })
    );
    expect(res.status).toBe(403);
    expect(upsert).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/org/sla-policies", () => {
  it("restaura um stage (deleteMany por key) e agenda recompute", async () => {
    const res = await DELETE(req("DELETE", { kind: "venda", stageId: "s0" }));
    expect(res.status).toBe(200);
    expect(deleteMany).toHaveBeenCalledWith({
      where: { orgId: "org-1", scope: "deal_stage", kind: "venda", key: "s0" },
    });
    expect(recompute).toHaveBeenCalledWith("org-1", "venda");
  });

  it("sem stageId restaura o kind inteiro", async () => {
    await DELETE(req("DELETE", { kind: "locacao" }));
    expect(deleteMany).toHaveBeenCalledWith({
      where: { orgId: "org-1", scope: "deal_stage", kind: "locacao" },
    });
  });
});
