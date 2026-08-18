import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

vi.mock("@/lib/proposals/route-helpers", () => ({
  loadScopedProposal: vi.fn(),
  proposalFeatureGuard: vi.fn().mockResolvedValue(null),
}));
vi.mock("@/lib/security/rbac/check", () => ({
  can: vi.fn().mockReturnValue(true),
}));
vi.mock("@/lib/clicksign/signer-actions", () => ({
  addSignerToEnvelope: vi.fn(),
}));

import { POST } from "../route";
import { loadScopedProposal } from "@/lib/proposals/route-helpers";
import { addSignerToEnvelope } from "@/lib/clicksign/signer-actions";
import { prisma } from "@/lib/db/prisma";

const mockLoad = vi.mocked(loadScopedProposal);
const mockAddToEnvelope = vi.mocked(addSignerToEnvelope);
const planFindFirst = prisma.proposalSigner.findFirst as unknown as ReturnType<typeof vi.fn>;
const planCreate = prisma.proposalSigner.create as unknown as ReturnType<typeof vi.fn>;
const envFindFirst = prisma.envelope.findFirst as unknown as ReturnType<typeof vi.fn>;
const eventCreate = prisma.proposalEvent.create as unknown as ReturnType<typeof vi.fn>;

const req = (body: Record<string, unknown>) =>
  new NextRequest("http://localhost/api/proposals/p1/signers", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });

function ok(status: string) {
  mockLoad.mockResolvedValue({
    auth: { org: { id: "org-1" }, actor: { effectiveUserId: "u1" } },
    eff: {},
    proposal: { id: "p1", orgId: "org-1", status, kind: "venda", title: "T" },
  } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  planFindFirst.mockResolvedValue(null);
  planCreate.mockResolvedValue({ id: "ps1", role: "vendedor", name: "Dono Silva" });
  eventCreate.mockResolvedValue({});
});

describe("POST /api/proposals/[id]/signers — regime de linha de plano", () => {
  it("rascunho: cria ProposalSigner (qualquer role) e devolve 201 com warnings", async () => {
    ok("rascunho");
    const res = await POST(req({ role: "proponente", name: "Maria Souza", email: "maria@gmail.com" }), {
      params: { id: "p1" },
    });
    expect(res.status).toBe(201);
    expect(planCreate).toHaveBeenCalled();
    expect(mockAddToEnvelope).not.toHaveBeenCalled();
  });

  it("parada de decisão: vendedor entra no grupo 2 como linha de plano", async () => {
    ok("assinada_proponente");
    const res = await POST(
      req({ role: "vendedor", name: "Dono Silva", email: "dono@gmail.com" }),
      { params: { id: "p1" } }
    );
    expect(res.status).toBe(201);
    expect(planCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ role: "vendedor", signingGroup: 2 }),
      })
    );
  });

  it("parada de decisão: proponente é recusado (o grupo 1 já assinou)", async () => {
    ok("assinada_proponente");
    const res = await POST(req({ role: "proponente", name: "Novo Prop", email: "novo@gmail.com" }), {
      params: { id: "p1" },
    });
    expect(res.status).toBe(409);
    expect(planCreate).not.toHaveBeenCalled();
  });

  it("parada de decisão: vendedor sem preflight ok → 422 no shape blockToResponse", async () => {
    ok("assinada_proponente");
    // Nome de UMA palavra reprova o readiness (nome completo obrigatório).
    const res = await POST(req({ role: "vendedor", name: "Dono", email: "dono@gmail.com" }), {
      params: { id: "p1" },
    });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: string; issues: unknown[] };
    expect(body.error).toBe("preflight");
    expect(Array.isArray(body.issues)).toBe(true);
    expect(planCreate).not.toHaveBeenCalled();
  });

  it("colisão de identidade (dedupeKey) → 409 sem criar", async () => {
    ok("rascunho");
    planFindFirst.mockResolvedValue({ id: "ps0", name: "Maria Souza", signingGroup: 1 });
    const res = await POST(req({ role: "testemunha", name: "Maria S", email: "maria@gmail.com" }), {
      params: { id: "p1" },
    });
    expect(res.status).toBe(409);
    expect(planCreate).not.toHaveBeenCalled();
  });

  it("sem contato nenhum → 400 (barrado na entrada)", async () => {
    ok("rascunho");
    const res = await POST(req({ role: "vendedor", name: "Dono Silva" }), {
      params: { id: "p1" },
    });
    expect(res.status).toBe(400);
  });

  it("terminal → 409", async () => {
    ok("cancelada");
    const res = await POST(req({ role: "vendedor", name: "Dono Silva", email: "dono@gmail.com" }), {
      params: { id: "p1" },
    });
    expect(res.status).toBe(409);
  });
});

describe("POST /api/proposals/[id]/signers — regime de envelope em curso (preservado)", () => {
  it("enviada: adiciona ao envelope running (feature de conserto de contato)", async () => {
    ok("enviada");
    envFindFirst.mockResolvedValue({ id: "env1", status: "running" });
    mockAddToEnvelope.mockResolvedValue({ ok: true, data: { id: "s1" } } as never);
    const res = await POST(
      req({ role: "vendedor", name: "Dono Silva", email: "dono@gmail.com" }),
      { params: { id: "p1" } }
    );
    expect(res.status).toBe(201);
    expect(mockAddToEnvelope).toHaveBeenCalled();
    expect(planCreate).not.toHaveBeenCalled();
  });

  it("enviada sem envelope vivo → 409", async () => {
    ok("enviada");
    envFindFirst.mockResolvedValue(null);
    const res = await POST(
      req({ role: "vendedor", name: "Dono Silva", email: "dono@gmail.com" }),
      { params: { id: "p1" } }
    );
    expect(res.status).toBe(409);
  });
});
