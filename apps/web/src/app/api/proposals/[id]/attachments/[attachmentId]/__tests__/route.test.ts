import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/proposals/route-helpers", () => ({
  loadScopedProposal: vi.fn(),
  proposalFeatureGuard: vi.fn().mockResolvedValue(null),
}));
vi.mock("@/lib/security/rbac/check", () => ({
  can: vi.fn().mockReturnValue(true),
}));

import { PATCH } from "../route";
import { loadScopedProposal } from "@/lib/proposals/route-helpers";
import { can } from "@/lib/security/rbac/check";
import { prisma } from "@/lib/db/prisma";

const mockLoad = vi.mocked(loadScopedProposal);
const mockCan = vi.mocked(can);
const findUnique = prisma.proposalAttachment.findUnique as unknown as ReturnType<typeof vi.fn>;
const update = prisma.proposalAttachment.update as unknown as ReturnType<typeof vi.fn>;

const req = (body: unknown) =>
  new NextRequest("http://localhost/api/proposals/p1/attachments/a1", {
    method: "PATCH",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
const params = { params: { id: "p1", attachmentId: "a1" } };

function load(kind: string, garantiaTipo = "caucao") {
  mockLoad.mockResolvedValue({
    auth: { org: { id: "org-1" }, actor: { effectiveUserId: "u1" } },
    eff: {},
    proposal: { id: "p1", kind, dataJson: { garantia: { tipo: garantiaTipo } } },
  } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockCan.mockReturnValue(true);
  findUnique.mockResolvedValue({
    id: "a1",
    proposalId: "p1",
    extractedData: { fields: { a: 1 }, assignment: { kind: "locatario", index: 0 }, assignmentPersisted: false },
  });
  update.mockResolvedValue({});
});

describe("PATCH /api/proposals/[id]/attachments/[attachmentId] — Mover para…", () => {
  it("kind de OUTRA esteira (comprador em locação) → 400, nada gravado", async () => {
    load("locacao");
    const res = await PATCH(req({ assignment: { kind: "comprador", index: 0 } }), params);
    expect(res.status).toBe(400);
    expect(update).not.toHaveBeenCalled();
  });

  it("locatário em venda → 400", async () => {
    load("venda");
    const res = await PATCH(req({ assignment: { kind: "locatario", index: 0 } }), params);
    expect(res.status).toBe(400);
  });

  it("body inválido → 400", async () => {
    load("locacao");
    const res = await PATCH(req({ assignment: { kind: "", index: -1 } }), params);
    expect(res.status).toBe(400);
  });

  it("sem PROPOSAL_SEND → 403", async () => {
    load("locacao");
    mockCan.mockReturnValue(false);
    const res = await PATCH(req({ assignment: { kind: "fiador", index: 0 } }), params);
    expect(res.status).toBe(403);
  });

  it("anexo de outra proposta → 404", async () => {
    load("locacao");
    findUnique.mockResolvedValue({ id: "a1", proposalId: "p-outra", extractedData: null });
    const res = await PATCH(req({ assignment: { kind: "fiador", index: 0 } }), params);
    expect(res.status).toBe(404);
    expect(update).not.toHaveBeenCalled();
  });

  it("fiador em locação com caução → grava escolha humana e avisa garantiaFlipped (sem tocar no dataJson)", async () => {
    load("locacao", "caucao");
    const res = await PATCH(req({ assignment: { kind: "fiador", index: 0 } }), params);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.garantiaFlipped).toBe(true);
    expect(body.assignment).toEqual({ kind: "fiador", index: 0 });
    const data = update.mock.calls[0][0].data.extractedData;
    expect(data.assignment).toEqual({ kind: "fiador", index: 0 });
    expect(data.assignmentPersisted).toBe(true);
    // campos do OCR preservados
    expect(data.fields).toEqual({ a: 1 });
    // a proposta em si não é alterada aqui
    expect(prisma.proposal.update).not.toHaveBeenCalled();
  });

  it("locatário em locação → garantiaFlipped false", async () => {
    load("locacao", "caucao");
    const res = await PATCH(req({ assignment: { kind: "locatario", index: 1 } }), params);
    expect(res.status).toBe(200);
    expect((await res.json()).garantiaFlipped).toBe(false);
  });
});
