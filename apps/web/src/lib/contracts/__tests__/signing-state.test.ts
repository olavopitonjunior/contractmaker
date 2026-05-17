import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { getDealSigningState } from "../signing-state";

const mockPrisma = vi.mocked(prisma);

describe("getDealSigningState", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("retorna EMPTY_STATE quando deal não tem envelope", async () => {
    mockPrisma.envelope.findFirst.mockResolvedValueOnce(null);

    const state = await getDealSigningState("deal-empty");
    expect(state.hasSignedContract).toBe(false);
    expect(state.signedAt).toBeNull();
    expect(state.signedDocumentUrl).toBeNull();
    expect(state.originalContractId).toBeNull();
    expect(state.envelopeId).toBeNull();
  });

  it("ignora envelope source=attachment (avulso) — só source=contract conta", async () => {
    // findFirst usa filtro `source: "contract"`, então mock só retorna se atender.
    mockPrisma.envelope.findFirst.mockResolvedValueOnce(null);

    const state = await getDealSigningState("deal-attachment-only");
    expect(state.hasSignedContract).toBe(false);
  });

  it("popula state quando envelope source=contract status=closed", async () => {
    mockPrisma.envelope.findFirst.mockResolvedValueOnce({
      id: "env-1",
      contractId: "contract-original-1",
      signedDocumentUrl: "https://blob.public.vercel.com/signed.pdf",
      closedAt: new Date("2026-05-10T10:30:00Z"),
    } as never);

    const state = await getDealSigningState("deal-signed");
    expect(state.hasSignedContract).toBe(true);
    expect(state.signedAt).toEqual(new Date("2026-05-10T10:30:00Z"));
    expect(state.signedDocumentUrl).toBe("https://blob.public.vercel.com/signed.pdf");
    expect(state.originalContractId).toBe("contract-original-1");
    expect(state.envelopeId).toBe("env-1");
  });

  it("usa o envelope mais recente (orderBy closedAt desc)", async () => {
    // Mock retorna o mais recente (prisma orderBy)
    mockPrisma.envelope.findFirst.mockResolvedValueOnce({
      id: "env-newer",
      contractId: "contract-newer",
      signedDocumentUrl: "https://blob.public.vercel.com/v2.pdf",
      closedAt: new Date("2026-05-15T00:00:00Z"),
    } as never);

    const state = await getDealSigningState("deal-multi-signed");
    expect(state.envelopeId).toBe("env-newer");
    expect(state.originalContractId).toBe("contract-newer");
  });

  it("preserva signedDocumentUrl null em envelopes ainda processando download do PDF", async () => {
    // Edge: envelope closed mas signedDocumentUrl ainda não baixado.
    mockPrisma.envelope.findFirst.mockResolvedValueOnce({
      id: "env-pending-pdf",
      contractId: "contract-x",
      signedDocumentUrl: null,
      closedAt: new Date("2026-05-16T12:00:00Z"),
    } as never);

    const state = await getDealSigningState("deal-pending-download");
    expect(state.hasSignedContract).toBe(true);
    expect(state.signedDocumentUrl).toBeNull();
  });
});
