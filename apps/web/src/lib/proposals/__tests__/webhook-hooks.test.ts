import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "@/lib/db/prisma";

vi.mock("@vercel/functions", () => ({
  waitUntil: (p: Promise<unknown>) => p,
}));

vi.mock("../status", () => ({
  advanceProposalStatus: vi.fn().mockResolvedValue({ moved: true }),
}));

vi.mock("../send-execute", () => ({
  sendVendedorVia: vi.fn().mockResolvedValue({ ok: true }),
}));

vi.mock("../notify-proposal", () => ({
  notifyProposalMilestone: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/clicksign/account", () => ({
  getSignatureSettings: vi.fn().mockResolvedValue({ proposalAutoChainVendedor: false }),
}));

import {
  onProposalEnvelopeClosed,
  onProposalEnvelopeRefused,
  onProposalEnvelopeCanceled,
} from "../webhook-hooks";
import { advanceProposalStatus } from "../status";
import { sendVendedorVia } from "../send-execute";
import { notifyProposalMilestone } from "../notify-proposal";
import { getSignatureSettings } from "@/lib/clicksign/account";

const envFind = prisma.envelope.findUnique as unknown as ReturnType<typeof vi.fn>;
const propFind = prisma.proposal.findUnique as unknown as ReturnType<typeof vi.fn>;
const propUpdateMany = prisma.proposal.updateMany as unknown as ReturnType<typeof vi.fn>;
const signerCount = prisma.proposalSigner.count as unknown as ReturnType<typeof vi.fn>;
const envSignerFind = prisma.envelopeSigner.findFirst as unknown as ReturnType<typeof vi.fn>;
const eventCreate = prisma.proposalEvent.create as unknown as ReturnType<typeof vi.fn>;
const advance = advanceProposalStatus as unknown as ReturnType<typeof vi.fn>;
const sendVend = sendVendedorVia as unknown as ReturnType<typeof vi.fn>;
const notify = notifyProposalMilestone as unknown as ReturnType<typeof vi.fn>;
const settings = getSignatureSettings as unknown as ReturnType<typeof vi.fn>;

describe("onProposalEnvelopeClosed", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    advance.mockResolvedValue({ moved: true });
    sendVend.mockResolvedValue({ ok: true });
    signerCount.mockResolvedValue(0);
    envSignerFind.mockResolvedValue(null);
    eventCreate.mockResolvedValue({});
    propFind.mockResolvedValue({ orgId: "org1", userId: "u1" });
    settings.mockResolvedValue({ proposalAutoChainVendedor: false });
  });

  it("envelope de contrato → no-op", async () => {
    envFind.mockResolvedValue({ source: "contract", proposalId: null, via: null });
    await onProposalEnvelopeClosed("e1");
    expect(advance).not.toHaveBeenCalled();
    expect(sendVend).not.toHaveBeenCalled();
  });

  it("completa fecha SEM vendedor → assinada_proponente e depois completa", async () => {
    envFind.mockResolvedValue({ source: "proposal", proposalId: "p1", via: "completa" });
    signerCount.mockResolvedValue(0);
    await onProposalEnvelopeClosed("e1");
    expect(advance).toHaveBeenNthCalledWith(1, "p1", "assinada_proponente");
    expect(advance).toHaveBeenNthCalledWith(2, "p1", "completa", expect.objectContaining({ completedAt: expect.any(Date) }));
    expect(sendVend).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({ proposalId: "p1", orgId: "org1", userId: "u1", kind: "completed" })
    );
  });

  it("FLIP: completa fecha COM vendedor (auto-chain OFF, default) → PARA na decisão", async () => {
    envFind.mockResolvedValue({ source: "proposal", proposalId: "p1", via: "completa" });
    signerCount.mockResolvedValue(1);
    await onProposalEnvelopeClosed("e1");
    const dests = advance.mock.calls.map((c) => c[1]);
    // Só assinada_proponente — NÃO fecha completa, NÃO avança aguardando_vendedor.
    expect(dests).toEqual(["assinada_proponente"]);
    expect(sendVend).not.toHaveBeenCalled();
    // Evento de parada + sino "sua vez" (nunca o completed).
    expect(eventCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ eventName: "awaiting_owner_decision" }),
      })
    );
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "awaiting_decision" })
    );
    expect(notify).not.toHaveBeenCalledWith(
      expect.objectContaining({ kind: "completed" })
    );
  });

  it("replay (advance não moveu) na parada → SEM evento e SEM sino", async () => {
    envFind.mockResolvedValue({ source: "proposal", proposalId: "p1", via: "completa" });
    signerCount.mockResolvedValue(1);
    advance.mockResolvedValue({ moved: false, reason: "replay" });
    await onProposalEnvelopeClosed("e1");
    expect(eventCreate).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
    expect(sendVend).not.toHaveBeenCalled();
  });

  it("escape hatch: auto-chain ON → dispara sendVendedorVia('webhook') sem avançar aqui", async () => {
    envFind.mockResolvedValue({ source: "proposal", proposalId: "p1", via: "completa" });
    signerCount.mockResolvedValue(1);
    settings.mockResolvedValue({ proposalAutoChainVendedor: true });
    await onProposalEnvelopeClosed("e1");
    const dests = advance.mock.calls.map((c) => c[1]);
    // O avanço pra aguardando_vendedor mudou pra DENTRO do send (pós-sucesso).
    expect(dests).toEqual(["assinada_proponente"]);
    expect(sendVend).toHaveBeenCalledWith("p1", "webhook");
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "signed_proponente" })
    );
  });

  it("completa combinada LEGADO (vendedor já no envelope) → completa, SEM 2º envelope", async () => {
    // Migração: envelope único comprador+vendedor em voo no deploy. Ao fechar, o
    // vendedor já assinou aqui → não pode encadear/re-cobrar um 2º envelope.
    envFind.mockResolvedValue({ source: "proposal", proposalId: "p1", via: "completa" });
    envSignerFind.mockResolvedValue({ id: "es1" }); // vendedor presente no envelope
    signerCount.mockResolvedValue(1); // o plano também tem vendedor — mas não deve importar
    await onProposalEnvelopeClosed("e1");
    const dests = advance.mock.calls.map((c) => c[1]);
    expect(dests).toEqual(["assinada_proponente", "completa"]);
    expect(dests).not.toContain("aguardando_vendedor");
    expect(sendVend).not.toHaveBeenCalled();
  });

  it("via reduzida (proprietário) fecha → completa", async () => {
    envFind.mockResolvedValue({ source: "proposal", proposalId: "p1", via: "reduzida" });
    await onProposalEnvelopeClosed("e1");
    expect(advance).toHaveBeenCalledWith("p1", "completa", expect.objectContaining({ completedAt: expect.any(Date) }));
    expect(sendVend).not.toHaveBeenCalled();
  });
});

describe("onProposalEnvelopeRefused", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    advance.mockResolvedValue({ moved: true });
    propFind.mockResolvedValue({ userId: "u1" });
  });

  it("recusa na via reduzida → recusada_vendedor (o desfecho quente) + sino + refusedBy PERSISTIDO", async () => {
    envFind.mockResolvedValue({ source: "proposal", proposalId: "p1", via: "reduzida", orgId: "org1" });
    await onProposalEnvelopeRefused("e1");
    expect(advance).toHaveBeenCalledWith(
      "p1",
      "recusada_vendedor",
      expect.objectContaining({ refusedBy: "vendedor", refusedAt: expect.any(Date) })
    );
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "refused", refusedBy: "vendedor", userId: "u1" })
    );
  });

  it("via ÚNICA com hint do proprietário → recusada_vendedor", async () => {
    envFind.mockResolvedValue({ source: "proposal", proposalId: "p1", via: "completa", orgId: "org1" });
    await onProposalEnvelopeRefused("e1", { refusedSourceKind: "vendedor" });
    expect(advance).toHaveBeenCalledWith("p1", "recusada_vendedor", expect.any(Object));
  });

  it("transição rejeitada (replay/ilegal) → SEM sino", async () => {
    envFind.mockResolvedValue({ source: "proposal", proposalId: "p1", via: "reduzida", orgId: "org1" });
    advance.mockResolvedValue({ moved: false, reason: "illegal", from: "cancelada" });
    await onProposalEnvelopeRefused("e1");
    expect(notify).not.toHaveBeenCalled();
  });

  it("recusa na via completa → recusada_proponente + refusedBy persistido", async () => {
    envFind.mockResolvedValue({ source: "proposal", proposalId: "p1", via: "completa", orgId: "org1" });
    await onProposalEnvelopeRefused("e1");
    expect(advance).toHaveBeenCalledWith(
      "p1",
      "recusada_proponente",
      expect.objectContaining({ refusedBy: "proponente" })
    );
  });

  it("envelope de contrato → no-op", async () => {
    envFind.mockResolvedValue({ source: "contract", proposalId: null, via: null });
    await onProposalEnvelopeRefused("e1");
    expect(advance).not.toHaveBeenCalled();
  });
});

describe("onProposalEnvelopeCanceled (bug D — 2ª via expirada/cancelada)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    eventCreate.mockResolvedValue({});
    propFind.mockResolvedValue({ userId: "u1" });
    propUpdateMany.mockResolvedValue({ count: 1 });
  });

  it("via reduzida cancelada → devolve à parada (CAS local, não ALLOWED_FROM) + sino", async () => {
    envFind.mockResolvedValue({
      source: "proposal",
      proposalId: "p1",
      via: "reduzida",
      orgId: "org1",
      clicksignId: "ck-1",
    });
    await onProposalEnvelopeCanceled("e1");
    expect(propUpdateMany).toHaveBeenCalledWith({
      where: { id: "p1", status: "aguardando_vendedor" },
      data: { status: "assinada_proponente" },
    });
    // A aresta é exclusiva do hook — o advance genérico NÃO é usado.
    expect(advance).not.toHaveBeenCalled();
    expect(eventCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ eventName: "vendedor_via_canceled" }),
      })
    );
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "vendedor_send_failed" })
    );
  });

  it("replay (CAS não moveu) → sem evento e sem sino", async () => {
    envFind.mockResolvedValue({
      source: "proposal",
      proposalId: "p1",
      via: "reduzida",
      orgId: "org1",
      clicksignId: "ck-1",
    });
    propUpdateMany.mockResolvedValue({ count: 0 });
    await onProposalEnvelopeCanceled("e1");
    expect(eventCreate).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it("via completa cancelada → no-op (cron expire trata)", async () => {
    envFind.mockResolvedValue({
      source: "proposal",
      proposalId: "p1",
      via: "completa",
      orgId: "org1",
      clicksignId: "ck-1",
    });
    await onProposalEnvelopeCanceled("e1");
    expect(propUpdateMany).not.toHaveBeenCalled();
  });

  it("envelope de contrato → no-op", async () => {
    envFind.mockResolvedValue({ source: "contract", proposalId: null, via: null });
    await onProposalEnvelopeCanceled("e1");
    expect(propUpdateMany).not.toHaveBeenCalled();
  });
});
