import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth/context";

vi.mock("@/lib/auth/context", () => ({ requireAuth: vi.fn() }));
vi.mock("@/lib/security/rbac/guard", async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return { ...actual, requirePermission: vi.fn().mockResolvedValue(undefined) };
});

const mockRequireAuth = vi.mocked(requireAuth);
let POST: typeof import("../route").POST;

beforeEach(async () => {
  vi.clearAllMocks();
  ({ POST } = await import("../route"));
  mockRequireAuth.mockResolvedValue({ ok: true, ctx: { userId: "u1", orgId: "org-1" } } as never);
});

function post(body: unknown, year = "2025") {
  return new NextRequest(`http://localhost/api/dimob/generate?year=${year}`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

describe("POST /api/dimob/generate — guards iniciais", () => {
  it("401 sem sessão", async () => {
    mockRequireAuth.mockResolvedValueOnce({
      ok: false,
      response: new Response("no", { status: 401 }),
    } as never);
    const res = await POST(post({}));
    expect(res.status).toBe(401);
  });

  it("400 com ano inválido", async () => {
    const res = await POST(post({}, "abc"));
    expect(res.status).toBe(400);
  });

  it("422 quando retificadora sem número do recibo (antes de agregar)", async () => {
    const res = await POST(post({ retificadora: true }));
    expect(res.status).toBe(422);
    const j = await res.json();
    expect(j.error).toMatch(/recibo/i);
  });
});
