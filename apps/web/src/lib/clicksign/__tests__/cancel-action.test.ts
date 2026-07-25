import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "@/lib/db/prisma";

// runEnvelopeCancel deve delegar a chamada remota a envelopes.ts::cancelEnvelope
// (mecanismo v3 por documento) — nunca montar PATCH próprio.
vi.mock("../envelopes", () => ({ cancelEnvelope: vi.fn() }));
vi.mock("../account", () => ({
  resolveClickSignCreds: vi
    .fn()
    .mockResolvedValue({ token: "t", baseUrl: "https://x" }),
}));

import { runEnvelopeCancel } from "../cancel-action";
import { cancelEnvelope } from "../envelopes";

const cancelMock = cancelEnvelope as unknown as ReturnType<typeof vi.fn>;
type MockFn = ReturnType<typeof vi.fn>;
const envelopeDb = prisma.envelope as unknown as Record<string, MockFn>;

const baseArgs = { envelopeId: "env-db-1", reason: "teste", actorUserId: "u1" };

beforeEach(() => {
  vi.clearAllMocks();
  envelopeDb.findUnique = vi.fn().mockResolvedValue({
    id: "env-db-1",
    clicksignId: "cs-env",
    status: "running",
    orgId: "org-1",
  });
  envelopeDb.update = vi.fn().mockResolvedValue({
    id: "env-db-1",
    status: "canceled",
    canceledAt: new Date("2026-07-24T00:00:00Z"),
  });
  cancelMock.mockResolvedValue(undefined);
});

describe("runEnvelopeCancel", () => {
  it("delega à cancelEnvelope e persiste canceled + canceledAt", async () => {
    const result = await runEnvelopeCancel(baseArgs);

    expect(result.status).toBe(200);
    expect(cancelMock).toHaveBeenCalledWith("cs-env", {
      token: "t",
      baseUrl: "https://x",
    });
    expect(envelopeDb.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "env-db-1" },
        data: expect.objectContaining({
          status: "canceled",
          canceledAt: expect.any(Date),
        }),
      })
    );
  });

  it("falha remota → 502 sem persistir", async () => {
    cancelMock.mockRejectedValue(new Error("Clicksign: recusado"));

    const result = await runEnvelopeCancel(baseArgs);

    expect(result.status).toBe(502);
    expect(envelopeDb.update).not.toHaveBeenCalled();
  });

  it("404 remoto (envelope já removido) → idempotente: persiste canceled", async () => {
    const { ClicksignError } = await import("../client");
    cancelMock.mockRejectedValue(new ClicksignError("não encontrado", 404));

    const result = await runEnvelopeCancel(baseArgs);

    expect(result.status).toBe(200);
    expect(envelopeDb.update).toHaveBeenCalled();
  });

  it("já cancelado → 200 idempotente sem chamada remota", async () => {
    envelopeDb.findUnique = vi.fn().mockResolvedValue({
      id: "env-db-1",
      clicksignId: "cs-env",
      status: "canceled",
      orgId: "org-1",
    });

    const result = await runEnvelopeCancel(baseArgs);

    expect(result.status).toBe(200);
    expect(cancelMock).not.toHaveBeenCalled();
  });
});
