import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "@/lib/db/prisma";

/**
 * Marcos de ACOMPANHAMENTO da proposta: "recebeu" e "assinou".
 *
 * Contexto: a proposta criada por WhatsApp não dá ao corretor nenhuma tela pra
 * acompanhar, então o aviso É o produto. Dois casos aqui não são óbvios e cada
 * um já custou um silêncio em produção — estão marcados abaixo.
 */

vi.mock("@vercel/functions", () => ({
  waitUntil: (p: Promise<unknown>) => p,
}));

vi.mock("../status", () => ({
  advanceProposalStatus: vi.fn().mockResolvedValue({ moved: true }),
}));

vi.mock("../acceptance-proof", () => ({
  buildAcceptanceProof: vi.fn().mockResolvedValue({ url: "https://x/c.pdf" }),
  buildAcceptanceMessage: vi.fn().mockReturnValue("Declaro que li..."),
}));

vi.mock("../send-execute", () => ({
  sendVendedorVia: vi.fn().mockResolvedValue({ ok: true }),
}));

vi.mock("@/lib/clicksign/account", () => ({
  getSignatureSettings: vi.fn().mockResolvedValue({ proposalAutoChainVendedor: true }),
}));

vi.mock("../notify-proposal", () => ({
  notifyProposalMilestone: vi.fn().mockResolvedValue(undefined),
}));

import { processProposalAcceptanceEvent } from "../acceptance-webhook";
import { onProposalEnvelopeClosed } from "../webhook-hooks";
import { advanceProposalStatus } from "../status";
import { notifyProposalMilestone } from "../notify-proposal";

const propFind = prisma.proposal.findFirst as unknown as ReturnType<typeof vi.fn>;
const propFindUnique = prisma.proposal.findUnique as unknown as ReturnType<typeof vi.fn>;
const signerFind = prisma.proposalSigner.findFirst as unknown as ReturnType<typeof vi.fn>;
const signerCount = prisma.proposalSigner.count as unknown as ReturnType<typeof vi.fn>;
const envFind = prisma.envelope.findUnique as unknown as ReturnType<typeof vi.fn>;
const envSignerFind = prisma.envelopeSigner.findFirst as unknown as ReturnType<typeof vi.fn>;
const advance = advanceProposalStatus as unknown as ReturnType<typeof vi.fn>;
const notify = notifyProposalMilestone as unknown as ReturnType<typeof vi.fn>;

const PROPOSAL = {
  id: "p1",
  orgId: "org1",
  userId: "u1",
  title: "Proposta X",
  token: "tok",
  instrument: "aceite",
  validUntil: null,
  status: "enviada",
};

function kinds() {
  return notify.mock.calls.map((c) => c[0].kind);
}

describe('"recebeu" — entrega do termo de aceite', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    advance.mockResolvedValue({ moved: true });
    signerFind.mockResolvedValue(null);
  });

  it("entrega ao proponente avisa, com suffix estável", async () => {
    propFind.mockResolvedValue(PROPOSAL);
    await processProposalAcceptanceEvent({ acceptanceId: "acc_1", phase: "sent", payload: {} });
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({
        proposalId: "p1",
        orgId: "org1",
        userId: "u1",
        kind: "delivered",
        dedupeSuffix: "proponente",
      })
    );
  });

  it("REGRESSÃO: entrega ao proprietário avisa mesmo sem mover o status", async () => {
    // Este case roda pro termo do proponente E do proprietário, mas a proposta
    // já está "entregue" — a CAS rejeita a segunda transição. Gatear o sino em
    // `moved` faria a entrega ao proprietário nunca avisar.
    signerFind.mockResolvedValue({ id: "s2", role: "vendedor", proposalId: "p1" });
    propFindUnique.mockResolvedValue({ ...PROPOSAL, status: "entregue" });
    advance.mockResolvedValue({ moved: false });

    await processProposalAcceptanceEvent({ acceptanceId: "acc_2", phase: "sent", payload: {} });

    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "delivered", dedupeSuffix: "s2" })
    );
  });

  it("as duas entregas usam suffixes distintos (senão a 2ª some no unique)", async () => {
    propFind.mockResolvedValue(PROPOSAL);
    await processProposalAcceptanceEvent({ acceptanceId: "acc_1", phase: "sent", payload: {} });
    signerFind.mockResolvedValue({ id: "s2", role: "vendedor", proposalId: "p1" });
    propFindUnique.mockResolvedValue({ ...PROPOSAL, status: "entregue" });
    await processProposalAcceptanceEvent({ acceptanceId: "acc_2", phase: "sent", payload: {} });

    const suffixes = notify.mock.calls.map((c) => c[0].dedupeSuffix);
    expect(new Set(suffixes).size).toBe(2);
  });

  it.each(["cancelada", "expirada", "recusada_proponente", "recusada_vendedor"])(
    "não avisa entrega em proposta %s",
    async (status) => {
      propFind.mockResolvedValue({ ...PROPOSAL, status });
      await processProposalAcceptanceEvent({ acceptanceId: "acc_1", phase: "sent", payload: {} });
      expect(kinds()).not.toContain("delivered");
    }
  );

  it("proposta já completa AVISA a entrega — termos são paralelos no Aceite", async () => {
    propFind.mockResolvedValue({ ...PROPOSAL, status: "completa" });
    await processProposalAcceptanceEvent({ acceptanceId: "acc_1", phase: "sent", payload: {} });
    expect(kinds()).toContain("delivered");
  });
});

// NB (flip 2026-08): estes casos rodam com `proposalAutoChainVendedor: true`
// (mock acima) — é o escape hatch que preserva o encadeamento automático e,
// com ele, o sino signed_proponente. No default (OFF) o sino da parada é
// awaiting_decision (coberto em webhook-hooks.test.ts).
describe('"assinou" — proponente assina e a proposta segue pro proprietário', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    advance.mockResolvedValue({ moved: true });
    envSignerFind.mockResolvedValue(null);
    propFindUnique.mockResolvedValue({ orgId: "org1", userId: "u1" });
    envFind.mockResolvedValue({ source: "proposal", proposalId: "p1", via: "completa" });
  });

  it("REGRESSÃO: com proprietário pendente, avisa signed_proponente", async () => {
    // Antes, entre a assinatura do comprador e a do proprietário — que podem
    // ser dias — nenhum sino tocava.
    signerCount.mockResolvedValue(1);
    await onProposalEnvelopeClosed("e1");
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({ proposalId: "p1", kind: "signed_proponente" })
    );
  });

  it("sem proprietário, vai direto a completed e NÃO duplica o aviso", async () => {
    signerCount.mockResolvedValue(0);
    await onProposalEnvelopeClosed("e1");
    expect(kinds()).toEqual(["completed"]);
  });

  it("não avisa quando a transição não ocorreu (replay de webhook)", async () => {
    signerCount.mockResolvedValue(1);
    advance.mockResolvedValue({ moved: false });
    await onProposalEnvelopeClosed("e1");
    expect(kinds()).not.toContain("signed_proponente");
  });
});
