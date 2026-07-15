import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { buildAcceptanceProofHtml, buildAcceptanceProof } from "../acceptance-proof";

const pFindUnique = prisma.proposal.findUnique as unknown as ReturnType<typeof vi.fn>;

const FACTS = {
  numero: "0142",
  signerName: "Marcia Souza",
  signerPhone: "+5511987654321",
  acceptanceId: "acc-abc-123",
  sentAt: "2026-07-15T10:00:00Z",
  completedAt: "2026-07-15T10:03:00Z",
  acceptedText: "Declaro que li a Proposta nº 0142 e aceito suas condições.",
};

describe("buildAcceptanceProofHtml — a prova (parte pura)", () => {
  it("carimba TODOS os fatos do aceite no comprovante", () => {
    const html = buildAcceptanceProofHtml({
      proposalHtml: "<p>DOCUMENTO DA PROPOSTA</p>",
      facts: FACTS,
    });
    expect(html).toContain("COMPROVANTE DE ACEITE");
    expect(html).toContain("Marcia Souza");
    expect(html).toContain("+5511987654321");
    expect(html).toContain("acc-abc-123");
    expect(html).toContain("2026-07-15T10:03:00Z");
    expect(html).toContain("aceito suas condições");
    // O documento da proposta vem junto (depois da quebra de página).
    expect(html).toContain("DOCUMENTO DA PROPOSTA");
    expect(html).toContain("page-break-before");
  });

  it("escapa HTML dos fatos (nome com < não injeta)", () => {
    const html = buildAcceptanceProofHtml({
      proposalHtml: "",
      facts: { ...FACTS, signerName: "<script>x</script>" },
    });
    expect(html).not.toContain("<script>x</script>");
    expect(html).toContain("&lt;script&gt;");
  });
});

describe("buildAcceptanceProof — idempotência", () => {
  beforeEach(() => vi.clearAllMocks());

  it("proposta inexistente → skipped not_found", async () => {
    pFindUnique.mockResolvedValue(null);
    const r = await buildAcceptanceProof("p1", { ...FACTS });
    expect(r).toEqual({ skipped: "not_found" });
  });

  it("dossierUrl já preenchido → skipped already_built (não regera)", async () => {
    pFindUnique.mockResolvedValue({ id: "p1", dossierUrl: "s3://ja.pdf" });
    const r = await buildAcceptanceProof("p1", { ...FACTS });
    expect(r).toEqual({ skipped: "already_built" });
  });
});
