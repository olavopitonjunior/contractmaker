import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "@/lib/db/prisma";

vi.mock("@/lib/storage/s3", () => ({
  downloadBufferFromUrl: vi.fn().mockResolvedValue(Buffer.from("laudo-pdf")),
}));
vi.mock("@/lib/security/audit", () => ({ audit: vi.fn().mockResolvedValue({}) }));

import {
  collectInspectionExtraDocuments,
  linkInspectionsToEnvelope,
} from "../inspection-signature";
import { downloadBufferFromUrl } from "@/lib/storage/s3";

type MockFn = ReturnType<typeof vi.fn>;
const inspectionDb = prisma.inspection as unknown as Record<string, MockFn>;
const attachmentDb = prisma.dealAttachment as unknown as Record<string, MockFn>;
const downloadMock = downloadBufferFromUrl as unknown as MockFn;

const READY = {
  id: "insp-1",
  tipo: "entrada",
  status: "laudo_gerado",
  laudoPdfUrl: "https://blob/laudo.pdf",
  leaseContract: { dealId: "deal-1" },
};

beforeEach(() => {
  vi.clearAllMocks();
  inspectionDb.findMany = vi.fn().mockResolvedValue([READY]);
  inspectionDb.updateMany = vi.fn().mockResolvedValue({ count: 1 });
  attachmentDb.findFirst = vi.fn().mockResolvedValue(null);
  attachmentDb.create = vi.fn().mockResolvedValue({ id: "att-laudo" });
  downloadMock.mockResolvedValue(Buffer.from("laudo-pdf"));
});

describe("collectInspectionExtraDocuments", () => {
  it("materializa o laudo como DealAttachment e devolve o buffer pro envelope", async () => {
    const r = await collectInspectionExtraDocuments({
      orgId: "org-1",
      dealId: "deal-1",
      inspectionIds: ["insp-1"],
    });

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(attachmentDb.create.mock.calls[0][0].data).toMatchObject({
      dealId: "deal-1",
      category: "laudo_vistoria",
      source: "inspection",
      filename: "Laudo de vistoria (entrada).pdf",
    });
    expect(r.documents).toEqual([
      {
        buffer: Buffer.from("laudo-pdf"),
        filename: "Laudo de vistoria (entrada).pdf",
        sourceAttachmentId: "att-laudo",
      },
    ]);
    expect(r.inspectionIds).toEqual(["insp-1"]);
  });

  it("reusa o DealAttachment existente (mesma url) — não duplica na pasta", async () => {
    attachmentDb.findFirst = vi.fn().mockResolvedValue({ id: "att-ja-existe" });

    const r = await collectInspectionExtraDocuments({
      orgId: "org-1",
      dealId: "deal-1",
      inspectionIds: ["insp-1"],
    });

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(attachmentDb.create).not.toHaveBeenCalled();
    expect(r.documents[0].sourceAttachmentId).toBe("att-ja-existe");
  });

  it("recusa vistoria de OUTRO negócio (cross-deal guard)", async () => {
    inspectionDb.findMany = vi
      .fn()
      .mockResolvedValue([{ ...READY, leaseContract: { dealId: "deal-outro" } }]);

    const r = await collectInspectionExtraDocuments({
      orgId: "org-1",
      dealId: "deal-1",
      inspectionIds: ["insp-1"],
    });

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/não pertence a este negócio/i);
    expect(downloadMock).not.toHaveBeenCalled();
  });

  it("recusa id fora da org (findMany escopado devolve menos linhas)", async () => {
    inspectionDb.findMany = vi.fn().mockResolvedValue([]);

    const r = await collectInspectionExtraDocuments({
      orgId: "org-1",
      dealId: "deal-1",
      inspectionIds: ["insp-de-outra-org"],
    });

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/não encontrada/i);
  });

  it("recusa vistoria sem laudo gerado", async () => {
    inspectionDb.findMany = vi
      .fn()
      .mockResolvedValue([{ ...READY, status: "em_campo", laudoPdfUrl: null }]);

    const r = await collectInspectionExtraDocuments({
      orgId: "org-1",
      dealId: "deal-1",
      inspectionIds: ["insp-1"],
    });

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/laudo PDF/i);
  });

  it("lista vazia é no-op (envio de contrato comum não paga nada por isso)", async () => {
    const r = await collectInspectionExtraDocuments({
      orgId: "org-1",
      dealId: "deal-1",
      inspectionIds: [],
    });

    expect(r).toEqual({ ok: true, documents: [], inspectionIds: [] });
    expect(inspectionDb.findMany).not.toHaveBeenCalled();
  });
});

describe("linkInspectionsToEnvelope", () => {
  it("aponta as vistorias pro envelope unificado e move pra 'assinatura'", async () => {
    await linkInspectionsToEnvelope(["insp-1"], "env-1");
    expect(inspectionDb.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["insp-1"] } },
      data: { envelopeId: "env-1", status: "assinatura" },
    });
  });

  it("sem vistoria selecionada não toca no banco", async () => {
    await linkInspectionsToEnvelope([], "env-1");
    expect(inspectionDb.updateMany).not.toHaveBeenCalled();
  });
});
