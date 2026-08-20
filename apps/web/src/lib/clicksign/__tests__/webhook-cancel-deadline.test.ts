/**
 * Primeiro teste do ramo `cancel`/`deadline` do webhook — até 2026-08 esse
 * ramo não tinha cobertura e2e nenhuma, e foi exatamente nele que a 1ª via
 * cancelada FORA da plataforma ficava presa (o hook era chamado sem causa e
 * fazia no-op).
 *
 * O que este arquivo trava: `cancel` e `deadline` chegam DISTINTOS do
 * `payload.event.name` e o webhook repassa a causa certa ao hook. Se alguém
 * unificar os dois (ou voltar à chamada sem causa), o `toHaveBeenCalledWith`
 * quebra — e o estrago seria ou proposta presa de novo (cancel virando
 * unknown) ou proposta que nunca expira (deadline virando external_cancel).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "@/lib/db/prisma";

vi.mock("@/lib/clicksign/signed-pdf", () => ({
  persistSignedPdf: vi.fn().mockResolvedValue(undefined),
  persistSignedDocumentByKey: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/clicksign/envelopes", () => ({
  listEnvelopeDocuments: vi.fn().mockResolvedValue({ data: [] }),
}));
vi.mock("@/lib/clicksign/account", () => ({
  resolveClickSignCreds: vi.fn().mockResolvedValue({ apiToken: "t", baseUrl: "https://x" }),
}));
vi.mock("@/lib/security/audit", () => ({ audit: vi.fn().mockResolvedValue({}) }));
vi.mock("@/lib/contracts/auto-promote-signed", () => ({
  autoPromoteDealOnContractSigned: vi.fn().mockResolvedValue({ promoted: false }),
}));
vi.mock("@/lib/clicksign/notify-envelope", () => ({
  notifyEnvelopeMilestone: vi.fn().mockResolvedValue(undefined),
  resolveDealLink: vi.fn().mockResolvedValue(null),
}));
vi.mock("@/lib/notifications/deal-events", () => ({
  notifyDealEvent: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/locacao/inspection-signature", () => ({
  completeInspectionOnEnvelopeClosed: vi.fn().mockResolvedValue({ completed: false }),
  revertInspectionOnEnvelopeCanceled: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/proposals/webhook-hooks", () => ({
  onProposalEnvelopeClosed: vi.fn().mockResolvedValue(undefined),
  onProposalEnvelopeRefused: vi.fn().mockResolvedValue(undefined),
  onProposalEnvelopeCanceled: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/proposals/acceptance-webhook", () => ({
  processProposalAcceptanceEvent: vi.fn(),
}));
vi.mock("@vercel/functions", () => ({ waitUntil: vi.fn() }));

import { processClickSignWebhookPayload } from "../webhook-process";
import { onProposalEnvelopeCanceled } from "@/lib/proposals/webhook-hooks";
import { revertInspectionOnEnvelopeCanceled } from "@/lib/locacao/inspection-signature";
import type { WebhookPayload } from "@/lib/clicksign/types";

type MockFn = ReturnType<typeof vi.fn>;
const onCanceled = onProposalEnvelopeCanceled as unknown as MockFn;
const revertInspection = revertInspectionOnEnvelopeCanceled as unknown as MockFn;
const envelopeDb = prisma.envelope as unknown as Record<string, MockFn>;
const eventDb = prisma.envelopeEvent as unknown as Record<string, MockFn>;

const ENVELOPE = {
  id: "env-1",
  orgId: "org-1",
  dealId: null,
  clicksignId: "cs-env",
  documentClicksignId: "cs-doc-1",
  source: "proposal",
  status: "running",
  signedDocumentUrl: null,
};

function payloadFor(name: "cancel" | "deadline"): WebhookPayload {
  return {
    event: { name, occurred_at: "2026-08-20T12:00:00Z", data: {} },
    document: { key: "cs-doc-1" },
  } as unknown as WebhookPayload;
}

beforeEach(() => {
  vi.clearAllMocks();
  envelopeDb.findFirst = vi.fn().mockResolvedValue(ENVELOPE);
  envelopeDb.update = vi.fn().mockResolvedValue({});
  eventDb.create = vi.fn().mockResolvedValue({});
});

describe("webhook cancel/deadline — a causa chega distinta ao hook", () => {
  it("cancel → envelope canceled + hook com external_cancel", async () => {
    const res = await processClickSignWebhookPayload(payloadFor("cancel"));
    expect(res.envelopeId).toBe("env-1");
    expect(envelopeDb.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "env-1" },
        data: expect.objectContaining({ status: "canceled" }),
      })
    );
    expect(onCanceled).toHaveBeenCalledWith("env-1", "external_cancel");
  });

  it("deadline → envelope canceled + hook com deadline (nunca external_cancel)", async () => {
    await processClickSignWebhookPayload(payloadFor("deadline"));
    expect(envelopeDb.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "canceled" }) })
    );
    expect(onCanceled).toHaveBeenCalledWith("env-1", "deadline");
  });

  it("os dois ramos continuam revertendo a vistoria (fall-through preservado)", async () => {
    await processClickSignWebhookPayload(payloadFor("cancel"));
    await processClickSignWebhookPayload(payloadFor("deadline"));
    expect(revertInspection).toHaveBeenCalledTimes(2);
  });
});
