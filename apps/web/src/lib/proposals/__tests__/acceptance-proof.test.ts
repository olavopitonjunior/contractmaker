import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "@/lib/db/prisma";
import {
  buildAcceptanceProofHtml,
  buildAcceptanceProof,
  compareAcceptedText,
} from "../acceptance-proof";

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

describe("compareAcceptedText — lastro probatório", () => {
  it("sem base de comparação → unknown (API não respondeu, não é divergência)", () => {
    expect(compareAcceptedText("qualquer", null)).toBe("unknown");
    expect(compareAcceptedText("qualquer", undefined)).toBe("unknown");
  });

  it("ignora diferença só de espaço em branco", () => {
    expect(compareAcceptedText("Declaro   que li.\n", " Declaro que li. ")).toBe("match");
  });

  it("texto diferente → diverged", () => {
    expect(compareAcceptedText("Declaro que li.", "Declaro que NÃO li.")).toBe("diverged");
  });
});

describe("buildAcceptanceProofHtml — dados oficiais da ClickSign", () => {
  const OFFICIAL = {
    status: "completed",
    statusFlow: "enqueued_sent_completed",
    signerName: "Marcia Souza",
    signerPhone: "5511987654321",
    sentAt: "2026-07-15T09:59:00Z",
    message: FACTS.acceptedText,
  };

  it("sem `official` a capa não muda (proposta antiga / API fora do ar)", () => {
    const html = buildAcceptanceProofHtml({ proposalHtml: "", facts: FACTS });
    expect(html).not.toContain("Registro na ClickSign");
    expect(html).not.toContain("divergência");
  });

  it("com `official` carimba o bloco oficial e confirma o texto", () => {
    const html = buildAcceptanceProofHtml({
      proposalHtml: "",
      facts: { ...FACTS, official: OFFICIAL },
    });
    expect(html).toContain("Registro na ClickSign");
    expect(html).toContain("enqueued_sent_completed");
    expect(html).toContain("2026-07-15T09:59:00Z");
    expect(html).toContain("Texto conferido com o registro da ClickSign");
    expect(html).not.toContain("divergência");
  });

  it("texto divergente vira ALERTA com a transcrição oficial — não pode ficar escondido", () => {
    const html = buildAcceptanceProofHtml({
      proposalHtml: "",
      facts: {
        ...FACTS,
        official: { ...OFFICIAL, message: "Outro texto totalmente diferente." },
      },
    });
    expect(html).toContain("divergência de texto");
    expect(html).toContain("Outro texto totalmente diferente.");
    expect(html).not.toContain("Texto conferido com o registro");
  });

  it("escapa a mensagem oficial (não injeta HTML vindo de terceiro)", () => {
    const html = buildAcceptanceProofHtml({
      proposalHtml: "",
      facts: { ...FACTS, official: { ...OFFICIAL, message: "<img src=x onerror=1>" } },
    });
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img");
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
