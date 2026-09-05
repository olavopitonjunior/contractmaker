import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/proposals/public-upload", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/proposals/public-upload")>();
  return { ...actual, resolvePublicUploadScope: vi.fn() };
});
vi.mock("@/lib/attachments/archive", () => ({
  archiveAttachment: vi.fn().mockResolvedValue("archived-1"),
}));
vi.mock("@/lib/security/audit", () => ({
  audit: vi.fn().mockResolvedValue(undefined),
}));

import { DELETE } from "../route";
import { prisma } from "@/lib/db/prisma";
import { resolvePublicUploadScope } from "@/lib/proposals/public-upload";
import { archiveAttachment } from "@/lib/attachments/archive";

const mockScope = vi.mocked(resolvePublicUploadScope);
const mockArchive = vi.mocked(archiveAttachment);
const findUnique = prisma.proposalAttachment.findUnique as unknown as ReturnType<typeof vi.fn>;
const tx = prisma.$transaction as unknown as ReturnType<typeof vi.fn>;
const eventCreate = prisma.proposalEvent.create as unknown as ReturnType<typeof vi.fn>;

const req = () =>
  new NextRequest("http://localhost/api/public/proposals/tok1/attachments/a1", { method: "DELETE" });
const params = { params: { token: "tok1", attachmentId: "a1" } };
const SCOPE = { proposalId: "p1", orgId: "org1", userId: "u1", status: "enviada", dataJson: {} };

beforeEach(() => {
  vi.clearAllMocks();
  mockScope.mockResolvedValue({ ok: true, scope: SCOPE } as never);
  tx.mockImplementation(async (fn: (t: unknown) => Promise<unknown>) => fn(prisma));
  mockArchive.mockResolvedValue("archived-1");
  eventCreate.mockResolvedValue({});
});

describe("DELETE /api/public/proposals/[token]/attachments/[attachmentId]", () => {
  it("proposta fechada → 403, nada arquivado", async () => {
    mockScope.mockResolvedValue({ ok: false, reason: "closed" } as never);
    const res = await DELETE(req(), params);
    expect(res.status).toBe(403);
    expect(mockArchive).not.toHaveBeenCalled();
  });

  it("documento da IMOBILIÁRIA (source manual) → 404 genérico, intocado", async () => {
    findUnique.mockResolvedValue({ id: "a1", proposalId: "p1", source: "manual", filename: "x.pdf", url: "u" });
    const res = await DELETE(req(), params);
    expect(res.status).toBe(404);
    expect(mockArchive).not.toHaveBeenCalled();
  });

  it("dossiê / PDF assinado → 404", async () => {
    findUnique.mockResolvedValue({ id: "a1", proposalId: "p1", source: "dossier", filename: "d.pdf", url: "u" });
    expect((await DELETE(req(), params)).status).toBe(404);
  });

  it("anexo de OUTRA proposta → 404", async () => {
    findUnique.mockResolvedValue({ id: "a1", proposalId: "p-outra", source: "public", filename: "x.pdf", url: "u" });
    expect((await DELETE(req(), params)).status).toBe(404);
    expect(mockArchive).not.toHaveBeenCalled();
  });

  it("documento do próprio lead → arquiva (via public_proposal, sem usuário) e registra evento público", async () => {
    findUnique.mockResolvedValue({ id: "a1", proposalId: "p1", source: "public", filename: "rg.pdf", url: "u" });
    const res = await DELETE(req(), params);
    expect(res.status).toBe(200);
    expect(mockArchive).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ origin: "proposal", via: "public_proposal", orgId: "org1", userId: null })
    );
    const ev = eventCreate.mock.calls[0][0].data;
    expect(ev.eventName).toBe("document_removed");
    expect(ev.source).toBe("public");
  });
});
