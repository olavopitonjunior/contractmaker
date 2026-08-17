import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "@/lib/db/prisma";

vi.mock("../envelopes", () => ({
  addRequirement: vi.fn(),
  addSigner: vi.fn(),
  bulkRequirements: vi.fn(),
  listEnvelopeRequirements: vi.fn(),
  notifySigner: vi.fn(),
  removeRequirement: vi.fn(),
  removeSigner: vi.fn(),
  updateSigner: vi.fn(),
}));
vi.mock("../account", () => ({
  getSignatureSettings: vi.fn(),
  resolveClickSignCreds: vi.fn(),
}));

import { resendSignerAction } from "../signer-actions";
import { notifySigner } from "../envelopes";
import { resolveClickSignCreds } from "../account";

type MockFn = ReturnType<typeof vi.fn>;
const notifyMock = notifySigner as unknown as MockFn;
const credsMock = resolveClickSignCreds as unknown as MockFn;
const signerDb = prisma.envelopeSigner as unknown as Record<string, MockFn>;

function makeSigner(overrides: Record<string, unknown> = {}) {
  return {
    id: "sig-1",
    status: "pending",
    resendCount: 0,
    lastResendAt: null,
    clicksignId: "cs-sig",
    envelope: { id: "env-1", orgId: "org-1", clicksignId: "cs-env" },
    ...overrides,
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  credsMock.mockResolvedValue({ token: "t", baseUrl: "https://x" });
  signerDb.update = vi.fn().mockResolvedValue({ id: "sig-1", status: "notified" });
});

describe("resendSignerAction", () => {
  it("caminho feliz: chama notifySigner e persiste resendCount + notified", async () => {
    const result = await resendSignerAction(makeSigner());

    expect(result.ok).toBe(true);
    expect(notifyMock).toHaveBeenCalledWith("cs-env", "cs-sig", {
      token: "t",
      baseUrl: "https://x",
    });
    expect(signerDb.update).toHaveBeenCalled();
  });

  // Regressão: o reenvio sem IDs remotos era um no-op silencioso que ainda
  // incrementava resendCount e marcava "notified" — a UI dizia "Lembrete
  // enviado" sem NENHUMA chamada à ClickSign.
  it("sem clicksignId do signer → 409, sem notify e sem update", async () => {
    const result = await resendSignerAction(makeSigner({ clicksignId: null }));

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(409);
    expect(notifyMock).not.toHaveBeenCalled();
    expect(signerDb.update).not.toHaveBeenCalled();
  });

  it("sem clicksignId do envelope → 409, sem notify e sem update", async () => {
    const result = await resendSignerAction(
      makeSigner({ envelope: { id: "env-1", orgId: "org-1", clicksignId: null } })
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(409);
    expect(notifyMock).not.toHaveBeenCalled();
    expect(signerDb.update).not.toHaveBeenCalled();
  });

  it("sem credenciais da org → 503, sem notify e sem update", async () => {
    credsMock.mockResolvedValue(null);

    const result = await resendSignerAction(makeSigner());

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(503);
    expect(notifyMock).not.toHaveBeenCalled();
    expect(signerDb.update).not.toHaveBeenCalled();
  });
});
