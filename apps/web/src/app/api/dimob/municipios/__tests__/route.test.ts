import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth/context";

vi.mock("@/lib/auth/context", () => ({ requireAuth: vi.fn() }));

const mockRequireAuth = vi.mocked(requireAuth);
let GET: typeof import("../route").GET;

beforeEach(async () => {
  vi.clearAllMocks();
  ({ GET } = await import("../route"));
  mockRequireAuth.mockResolvedValue({ ok: true, ctx: { userId: "u1", orgId: "org-1" } } as never);
});

function req(qs: string) {
  return new NextRequest(`http://localhost/api/dimob/municipios?${qs}`);
}

describe("GET /api/dimob/municipios", () => {
  it("401 quando não autenticado", async () => {
    mockRequireAuth.mockResolvedValueOnce({
      ok: false,
      response: new Response("no", { status: 401 }),
    } as never);
    const res = await GET(req("q=sao"));
    expect(res.status).toBe(401);
  });

  it("busca São Paulo/SP e devolve o código TOM", async () => {
    const res = await GET(req("q=sao%20paulo&uf=SP"));
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(Array.isArray(j.results)).toBe(true);
    const sp = j.results.find((m: { nome: string }) => m.nome === "São Paulo");
    expect(sp?.tom).toBe("7107");
    expect(sp?.uf).toBe("SP");
  });

  it("sem q e sem uf devolve lista vazia", async () => {
    const res = await GET(req(""));
    const j = await res.json();
    expect(j.results).toHaveLength(0);
  });

  it("limita a 20 resultados", async () => {
    const res = await GET(req("q=santa"));
    const j = await res.json();
    expect(j.results.length).toBeLessThanOrEqual(20);
    expect(j.results.length).toBeGreaterThan(0);
  });
});
