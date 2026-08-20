import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "@/lib/db/prisma";

// ClickSign REST layer — respostas mínimas; cada teste sobrescreve o status.
vi.mock("../envelopes", () => ({
  getEnvelope: vi.fn(),
  listEnvelopeSigners: vi.fn().mockResolvedValue({ data: [] }),
  listEnvelopeRequirements: vi.fn().mockResolvedValue({ data: [] }),
  listEnvelopeEvents: vi.fn().mockResolvedValue({ data: [] }),
  listEnvelopeDocuments: vi.fn().mockResolvedValue({ data: [] }),
}));
vi.mock("../account", () => ({
  resolveClickSignCreds: vi.fn().mockResolvedValue({ apiToken: "t", baseUrl: "https://x" }),
}));
vi.mock("@/lib/clicksign/signed-pdf", () => ({
  persistSignedPdf: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/contracts/auto-promote-signed", () => ({
  autoPromoteDealOnContractSigned: vi.fn().mockResolvedValue({ promoted: false }),
}));
vi.mock("@/lib/clicksign/notify-envelope", () => ({
  notifyEnvelopeMilestone: vi.fn().mockResolvedValue(undefined),
  resolveDealLink: vi.fn().mockResolvedValue(null),
}));
vi.mock("@/lib/locacao/inspection-signature", () => ({
  completeInspectionOnEnvelopeClosed: vi.fn().mockResolvedValue(undefined),
  revertInspectionOnEnvelopeCanceled: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/proposals/webhook-hooks", () => ({
  onProposalEnvelopeClosed: vi.fn().mockResolvedValue(undefined),
  onProposalEnvelopeRefused: vi.fn().mockResolvedValue(undefined),
  onProposalEnvelopeCanceled: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@vercel/functions", () => ({ waitUntil: vi.fn() }));

import { syncEnvelopeState } from "../sync";
import { getEnvelope, listEnvelopeEvents } from "../envelopes";
import {
  onProposalEnvelopeClosed,
  onProposalEnvelopeRefused,
  onProposalEnvelopeCanceled,
} from "@/lib/proposals/webhook-hooks";

const getEnv = getEnvelope as unknown as ReturnType<typeof vi.fn>;
const listEvents = listEnvelopeEvents as unknown as ReturnType<typeof vi.fn>;
const onClosed = onProposalEnvelopeClosed as unknown as ReturnType<typeof vi.fn>;
const onRefused = onProposalEnvelopeRefused as unknown as ReturnType<typeof vi.fn>;
const onCanceled = onProposalEnvelopeCanceled as unknown as ReturnType<typeof vi.fn>;

function makeEnvelope(over: Record<string, unknown> = {}) {
  return {
    id: "env-1",
    clicksignId: "cs-1",
    orgId: "org-1",
    source: "proposal",
    proposalId: "prop-1",
    dealId: null,
    via: "completa",
    status: "running",
    signedDocumentUrl: null,
    signers: [],
    ...over,
  } as never;
}

function remote(status: string) {
  return { data: { attributes: { status } } };
}

describe("syncEnvelopeState — propagação pra proposta", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // envelopeEvent não está no mock global do prisma — o reconciler grava o
    // audit `manual_sync`; stubamos aqui.
    (prisma as unknown as { envelopeEvent: { create: ReturnType<typeof vi.fn> } }).envelopeEvent = {
      create: vi.fn().mockResolvedValue({}),
    };
    (prisma.envelope.update as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({});
    listEvents.mockResolvedValue({ data: [] });
  });

  it("proposta fechada (close reconciliado) → chama onProposalEnvelopeClosed", async () => {
    getEnv.mockResolvedValue(remote("closed"));
    await syncEnvelopeState(makeEnvelope(), { actorVia: "cron" });
    expect(onClosed).toHaveBeenCalledWith("env-1");
    expect(onRefused).not.toHaveBeenCalled();
  });

  it("cancelada SEM recusa → onProposalEnvelopeCanceled, NUNCA recusa", async () => {
    // Antes: cancelamento virava `recusada_proponente` (terminal) com sino de
    // recusa — o histórico afirmava uma recusa que ninguém fez.
    // Feed vazio → causa "unknown": sem evidência o hook não mexe na 1ª via
    // (comportamento idêntico ao anterior — o fallback nunca piora nada).
    getEnv.mockResolvedValue(remote("canceled"));
    await syncEnvelopeState(makeEnvelope(), { actorVia: "cron" });
    expect(onCanceled).toHaveBeenCalledWith("env-1", "unknown");
    expect(onRefused).not.toHaveBeenCalled();
    expect(onClosed).not.toHaveBeenCalled();
  });

  it("canceled SEM feed de eventos → não decide, não fecha o envelope, tenta de novo depois", async () => {
    // O feed `/events` é a ÚNICA fonte de recusa e é best-effort. Sem ele,
    // "ninguém recusou" é indistinguível de "não consegui verificar" — e
    // fechar o envelope aqui perderia a recusa PARA SEMPRE (o cron só varre
    // `running`).
    getEnv.mockResolvedValue(remote("canceled"));
    listEvents.mockRejectedValue(new Error("429 rate limited"));
    await syncEnvelopeState(makeEnvelope(), { actorVia: "cron" });
    expect(onCanceled).not.toHaveBeenCalled();
    expect(onRefused).not.toHaveBeenCalled();
    expect(onClosed).not.toHaveBeenCalled();
    // Envelope segue `running` → volta no sweep do próximo cron.
    expect(prisma.envelope.update).not.toHaveBeenCalled();
  });

  it("canceled sem feed MAS com recusa já gravada localmente → decide recusa", async () => {
    // A evidência local basta: o webhook de recusa chegou antes.
    getEnv.mockResolvedValue(remote("canceled"));
    listEvents.mockRejectedValue(new Error("429 rate limited"));
    const env = makeEnvelope({
      signers: [
        {
          id: "sg-1",
          clicksignId: "sk-1",
          email: null,
          status: "refused",
          sourceKind: "proponente",
          refusedAt: new Date("2026-07-17T12:00:00Z"),
          signedAt: null,
          viewedAt: null,
        },
      ],
    });
    await syncEnvelopeState(env, { actorVia: "cron" });
    expect(onRefused).toHaveBeenCalledWith("env-1", { refusedSourceKind: null });
    expect(onCanceled).not.toHaveBeenCalled();
  });

  it("envelope RUNNING com recusa antiga → não redispara a cada sync", async () => {
    // `refusedRemotely` sozinho valia em toda rodada; com dois recusantes de
    // sourceKind diferente isso gravava um `status_transition_rejected` por
    // execução do cron, pra sempre.
    getEnv.mockResolvedValue(remote("running"));
    const env = makeEnvelope({
      signers: [
        {
          id: "sg-1",
          clicksignId: "sk-1",
          email: null,
          status: "refused",
          sourceKind: "proponente",
          refusedAt: new Date("2026-07-17T12:00:00Z"),
          signedAt: null,
          viewedAt: null,
        },
      ],
    });
    await syncEnvelopeState(env, { actorVia: "cron" });
    expect(onRefused).not.toHaveBeenCalled();
    expect(onCanceled).not.toHaveBeenCalled();
  });

  it("cancelada COM recusa → recusa (a ClickSign cancela o envelope na recusa)", async () => {
    getEnv.mockResolvedValue(remote("canceled"));
    listEvents.mockResolvedValue({
      data: [
        {
          attributes: {
            name: "refusal",
            created: "2026-07-17T12:00:00Z",
            data: { signer: { key: "sk-1" } },
          },
        },
      ],
    });
    const env = makeEnvelope({
      signers: [
        {
          id: "sg-1",
          clicksignId: "sk-1",
          email: null,
          status: "sent",
          sourceKind: "proponente",
          refusedAt: null,
          signedAt: null,
          viewedAt: null,
        },
      ],
    });
    await syncEnvelopeState(env, { actorVia: "cron" });
    expect(onRefused).toHaveBeenCalledWith("env-1", { refusedSourceKind: "proponente" });
    expect(onCanceled).not.toHaveBeenCalled();
  });

  it("recusa JÁ conhecida + envelope cancelado → ainda é recusa, não cancelamento", async () => {
    // O discriminador é `refusedRemotely` (existe signatário com refusedAt no
    // remoto), não `refusedNewly`: numa reconciliação posterior a recusa já
    // está gravada localmente e mesmo assim o desfecho continua sendo recusa.
    getEnv.mockResolvedValue(remote("canceled"));
    listEvents.mockResolvedValue({
      data: [
        {
          attributes: {
            name: "refusal",
            created: "2026-07-17T12:00:00Z",
            data: { signer: { key: "sk-1" } },
          },
        },
      ],
    });
    const env = makeEnvelope({
      signers: [
        {
          id: "sg-1",
          clicksignId: "sk-1",
          email: null,
          status: "refused",
          sourceKind: "proponente",
          refusedAt: new Date("2026-07-17T12:00:00Z"),
          signedAt: null,
          viewedAt: null,
        },
      ],
    });
    await syncEnvelopeState(env, { actorVia: "cron" });
    expect(onRefused).toHaveBeenCalledWith("env-1", { refusedSourceKind: "proponente" });
    expect(onCanceled).not.toHaveBeenCalled();
  });

  it("recusa recém-descoberta na via única → propaga o sourceKind do recusante", async () => {
    getEnv.mockResolvedValue(remote("running"));
    listEvents.mockResolvedValue({
      data: [
        {
          attributes: {
            name: "refusal",
            created: "2026-07-17T12:00:00Z",
            data: { signer: { key: "sk-vendedor" } },
          },
        },
      ],
    });
    const env = makeEnvelope({
      signers: [
        {
          id: "sg-1",
          clicksignId: "sk-vendedor",
          email: null,
          status: "sent",
          sourceKind: "vendedor",
          refusedAt: null,
          signedAt: null,
          viewedAt: null,
        },
      ],
    });
    await syncEnvelopeState(env, { actorVia: "cron" });
    expect(onRefused).toHaveBeenCalledWith("env-1", { refusedSourceKind: "vendedor" });
    expect(onClosed).not.toHaveBeenCalled();
  });

  it("envelope de contrato fechado → NÃO toca nos hooks de proposta", async () => {
    getEnv.mockResolvedValue(remote("closed"));
    await syncEnvelopeState(
      makeEnvelope({ source: "contract", proposalId: null, dealId: "deal-1" }),
      { actorVia: "cron" }
    );
    expect(onClosed).not.toHaveBeenCalled();
    expect(onRefused).not.toHaveBeenCalled();
  });
});
