import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { requireAuth } from "@/lib/auth/context";

// requireAuth (context) não é mockado no setup global — mockamos aqui.
vi.mock("@/lib/auth/context", () => ({ requireAuth: vi.fn() }));

// Guard: preserva as classes de erro reais, só neutraliza requirePermission.
vi.mock("@/lib/security/rbac/guard", async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return { ...actual, requirePermission: vi.fn().mockResolvedValue(undefined) };
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const p = prisma as any;
const mockRequireAuth = vi.mocked(requireAuth);

let POST: typeof import("../route").POST;
let DELETE: typeof import("../route").DELETE;

beforeEach(async () => {
  vi.clearAllMocks();
  ({ POST, DELETE } = await import("../route"));
  mockRequireAuth.mockResolvedValue({ ok: true, ctx: { userId: "u1", orgId: "org-1" } } as never);
  p.dimobExclusion = {
    upsert: vi.fn().mockResolvedValue({}),
    deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
    findMany: vi.fn().mockResolvedValue([]),
  };
  p.deal = { ...p.deal, findFirst: vi.fn().mockResolvedValue({ id: "deal-1" }) };
  p.leaseContract = { findFirst: vi.fn().mockResolvedValue({ id: "lease-1" }) };
});

function post(body: unknown, year = "2025") {
  return new NextRequest(`http://localhost/api/dimob/exclusions?year=${year}`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}
function del(qs: string) {
  return new NextRequest(`http://localhost/api/dimob/exclusions?${qs}`, { method: "DELETE" });
}

describe("POST /api/dimob/exclusions", () => {
  it("401 quando não autenticado", async () => {
    mockRequireAuth.mockResolvedValueOnce({
      ok: false,
      response: new Response("no", { status: 401 }),
    } as never);
    const res = await POST(post({ dealId: "deal-1" }));
    expect(res.status).toBe(401);
  });

  it("400 quando ano inválido", async () => {
    const res = await POST(post({ dealId: "deal-1" }, "abc"));
    expect(res.status).toBe(400);
  });

  it("400 quando dealId e leaseId juntos (XOR)", async () => {
    const res = await POST(post({ dealId: "deal-1", leaseId: "lease-1" }));
    expect(res.status).toBe(400);
  });

  it("400 quando nenhum dos dois", async () => {
    const res = await POST(post({}));
    expect(res.status).toBe(400);
  });

  it("exclui venda (dealId) com cross-org guard", async () => {
    const res = await POST(post({ dealId: "deal-1" }));
    expect(res.status).toBe(200);
    expect(p.deal.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "deal-1", pipeline: { orgId: "org-1" } } })
    );
    expect(p.dimobExclusion.upsert).toHaveBeenCalled();
  });

  it("404 quando o deal é de outra org", async () => {
    p.deal.findFirst.mockResolvedValueOnce(null);
    const res = await POST(post({ dealId: "deal-x" }));
    expect(res.status).toBe(404);
    expect(p.dimobExclusion.upsert).not.toHaveBeenCalled();
  });

  it("exclui locação (leaseId) com cross-org guard", async () => {
    const res = await POST(post({ leaseId: "lease-1" }));
    expect(res.status).toBe(200);
    expect(p.leaseContract.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "lease-1", orgId: "org-1" } })
    );
    expect(p.dimobExclusion.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { orgId_year_leaseId: { orgId: "org-1", year: 2025, leaseId: "lease-1" } },
      })
    );
  });

  it("404 quando a locação é de outra org", async () => {
    p.leaseContract.findFirst.mockResolvedValueOnce(null);
    const res = await POST(post({ leaseId: "lease-x" }));
    expect(res.status).toBe(404);
    expect(p.dimobExclusion.upsert).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/dimob/exclusions", () => {
  it("reconcilia por leaseId", async () => {
    const res = await DELETE(del("year=2025&leaseId=lease-1"));
    expect(res.status).toBe(200);
    expect(p.dimobExclusion.deleteMany).toHaveBeenCalledWith({
      where: { orgId: "org-1", year: 2025, leaseId: "lease-1" },
    });
  });

  it("reconcilia por dealId", async () => {
    const res = await DELETE(del("year=2025&dealId=deal-1"));
    expect(res.status).toBe(200);
    expect(p.dimobExclusion.deleteMany).toHaveBeenCalledWith({
      where: { orgId: "org-1", year: 2025, dealId: "deal-1" },
    });
  });

  it("reconcilia todas com all=true", async () => {
    const res = await DELETE(del("year=2025&all=true"));
    expect(res.status).toBe(200);
    expect(p.dimobExclusion.deleteMany).toHaveBeenCalledWith({
      where: { orgId: "org-1", year: 2025 },
    });
  });

  it("400 sem alvo", async () => {
    const res = await DELETE(del("year=2025"));
    expect(res.status).toBe(400);
  });
});
