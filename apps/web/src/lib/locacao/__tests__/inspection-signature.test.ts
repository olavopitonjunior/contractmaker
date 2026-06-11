import { describe, it, expect, vi, beforeEach } from "vitest";

// O setup global mocka @/lib/db/prisma — extendemos com inspection.
vi.mock("@/lib/db/prisma", async () => {
  const actual = await vi.importActual<{ prisma: Record<string, unknown> }>(
    "@/lib/db/prisma"
  );
  return {
    prisma: {
      ...(actual?.prisma ?? {}),
      inspection: {
        findFirst: vi.fn(),
        update: vi.fn(),
        updateMany: vi.fn(),
      },
    },
  };
});

vi.mock("@/lib/security/audit", () => ({
  audit: vi.fn().mockResolvedValue({}),
}));

import {
  completeInspectionOnEnvelopeClosed,
  revertInspectionOnEnvelopeCanceled,
  updateInspectionSignedLaudo,
} from "../inspection-signature";
import { prisma } from "@/lib/db/prisma";
import { audit } from "@/lib/security/audit";

const mockFindFirst = vi.mocked(prisma.inspection.findFirst);
const mockUpdate = vi.mocked(prisma.inspection.update);
const mockUpdateMany = vi.mocked(prisma.inspection.updateMany);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("completeInspectionOnEnvelopeClosed", () => {
  it("conclui a vistoria vinculada ao envelope e audita", async () => {
    mockFindFirst.mockResolvedValueOnce({
      id: "insp-1",
      status: "assinatura",
      orgId: "org-1",
    } as never);
    mockUpdate.mockResolvedValueOnce({} as never);

    const r = await completeInspectionOnEnvelopeClosed("env-1");
    expect(r.completed).toBe(true);
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: "insp-1" },
      data: { status: "concluida" },
    });
    expect(audit).toHaveBeenCalledWith(
      { orgId: "org-1", userId: null },
      expect.objectContaining({ action: "INSPECTION_SIGNED", resource: "insp-1" })
    );
  });

  it("é no-op quando o envelope não tem vistoria (envelope de contrato comum)", async () => {
    mockFindFirst.mockResolvedValueOnce(null as never);
    const r = await completeInspectionOnEnvelopeClosed("env-contrato");
    expect(r.completed).toBe(false);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("é idempotente quando a vistoria já está concluída (close reentregue)", async () => {
    mockFindFirst.mockResolvedValueOnce({
      id: "insp-1",
      status: "concluida",
      orgId: "org-1",
    } as never);
    const r = await completeInspectionOnEnvelopeClosed("env-1");
    expect(r.completed).toBe(false);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("nunca lança — erro de banco vira no-op logado", async () => {
    mockFindFirst.mockRejectedValueOnce(new Error("db down"));
    const r = await completeInspectionOnEnvelopeClosed("env-1");
    expect(r.completed).toBe(false);
  });
});

describe("updateInspectionSignedLaudo", () => {
  it("grava a URL assinada como laudoPdfUrl da vistoria do envelope", async () => {
    mockUpdateMany.mockResolvedValueOnce({ count: 1 } as never);
    await updateInspectionSignedLaudo("env-1", "https://blob/signed.pdf");
    expect(mockUpdateMany).toHaveBeenCalledWith({
      where: { envelopeId: "env-1" },
      data: { laudoPdfUrl: "https://blob/signed.pdf" },
    });
  });
});

describe("revertInspectionOnEnvelopeCanceled", () => {
  it("reverte só vistorias em 'assinatura' pra 'laudo_gerado'", async () => {
    mockUpdateMany.mockResolvedValueOnce({ count: 1 } as never);
    await revertInspectionOnEnvelopeCanceled("env-1");
    expect(mockUpdateMany).toHaveBeenCalledWith({
      where: { envelopeId: "env-1", status: "assinatura" },
      data: { status: "laudo_gerado" },
    });
  });
});
