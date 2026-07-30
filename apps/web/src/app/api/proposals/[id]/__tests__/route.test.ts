import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

vi.mock("@/lib/proposals/route-helpers", () => ({
  loadScopedProposal: vi.fn(),
}));
vi.mock("@/lib/clicksign/cancel-action", () => ({
  runEnvelopeCancel: vi.fn(),
}));
vi.mock("@/lib/security/audit", () => ({
  audit: vi.fn().mockResolvedValue(undefined),
  extractAuditContextFromRequest: vi.fn(() => ({})),
}));

import { PATCH } from "../route";
import { loadScopedProposal } from "@/lib/proposals/route-helpers";
import { prisma } from "@/lib/db/prisma";

const mockLoad = vi.mocked(loadScopedProposal);
const mockPrisma = vi.mocked(prisma);

function req(body: unknown) {
  return new NextRequest("http://localhost/api/proposals/p1", {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

function scoped(status: string) {
  mockLoad.mockResolvedValue({
    auth: { org: { id: "org-1" }, actor: { effectiveUserId: "u1" } },
    eff: {},
    proposal: {
      id: "p1",
      orgId: "org-1",
      status,
      schemaType: "locacao_residencial_v1",
    },
  } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.proposal.update.mockResolvedValue({ id: "p1" } as never);
});

describe("PATCH /api/proposals/[id] — guard de status", () => {
  it("propaga o 404 do escopo (outra org / sem acesso)", async () => {
    mockLoad.mockResolvedValue({
      fail: NextResponse.json({ error: "Não encontrada" }, { status: 404 }),
    } as never);
    const res = await PATCH(req({ title: "x" }), { params: { id: "p1" } });
    expect(res.status).toBe(404);
    expect(mockPrisma.proposal.update).not.toHaveBeenCalled();
  });

  it("409 depois do envio — documento enviado não se edita", async () => {
    for (const status of [
      "enviada",
      "entregue",
      "visualizada",
      "assinada_proponente",
      "aguardando_vendedor",
      "completa",
      "convertida",
      "cancelada",
      "expirada",
      "recusada_proponente",
    ]) {
      scoped(status);
      const res = await PATCH(req({ title: "novo" }), { params: { id: "p1" } });
      expect(res.status, status).toBe(409);
    }
    expect(mockPrisma.proposal.update).not.toHaveBeenCalled();
  });

  it("200 nos três status editáveis (mesmo conjunto do claim de envio)", async () => {
    for (const status of ["rascunho", "aguardando_aprovacao", "falha_envio"]) {
      scoped(status);
      const res = await PATCH(req({ title: "novo" }), { params: { id: "p1" } });
      expect(res.status, status).toBe(200);
    }
    expect(mockPrisma.proposal.update).toHaveBeenCalledTimes(3);
  });

  it("400 em payload inválido", async () => {
    scoped("rascunho");
    const res = await PATCH(req({ title: "" }), { params: { id: "p1" } });
    expect(res.status).toBe(400);
  });

  it("hiddenPaths fora da allowlist do schemaType é descartado", async () => {
    scoped("rascunho");
    await PATCH(
      req({ hiddenPaths: ["comissao", "compradores.0.cpf", "../../etc/passwd"] }),
      { params: { id: "p1" } }
    );
    expect(mockPrisma.proposal.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ hiddenPaths: ["comissao"] }) })
    );
  });
});

describe("PATCH /api/proposals/[id] — substituição de signatários", () => {
  it("substitui o conjunto inteiro (delete + create) com dedupeKey", async () => {
    scoped("rascunho");
    const res = await PATCH(
      req({
        signers: [
          { role: "proponente", name: "Maria", email: "m@ex.com" },
          { role: "testemunha", name: "Testa", email: "t@ex.com", cpf: "99988877766" },
        ],
      }),
      { params: { id: "p1" } }
    );
    expect(res.status).toBe(200);
    expect(mockPrisma.proposalSigner.deleteMany).toHaveBeenCalledWith({
      where: { proposalId: "p1" },
    });
    const created = mockPrisma.proposalSigner.createMany.mock.calls[0][0] as {
      data: Record<string, unknown>[];
    };
    expect(created.data).toHaveLength(2);
    // Grupo derivado do papel (proponente assina primeiro) e chave de dedupe
    // calculada no servidor.
    expect(created.data[0]).toMatchObject({ role: "proponente", signingGroup: 1 });
    expect(created.data[1]).toMatchObject({ role: "testemunha", signingGroup: 2 });
    expect(created.data[0].dedupeKey).toBeTruthy();
  });

  it("omitir `signers` preserva as linhas existentes", async () => {
    scoped("rascunho");
    await PATCH(req({ title: "só o título" }), { params: { id: "p1" } });
    expect(mockPrisma.proposalSigner.deleteMany).not.toHaveBeenCalled();
    expect(mockPrisma.proposalSigner.createMany).not.toHaveBeenCalled();
  });

  it("lista vazia limpa sem tentar criar nada", async () => {
    scoped("rascunho");
    await PATCH(req({ signers: [] }), { params: { id: "p1" } });
    expect(mockPrisma.proposalSigner.deleteMany).toHaveBeenCalled();
    expect(mockPrisma.proposalSigner.createMany).not.toHaveBeenCalled();
  });
});
