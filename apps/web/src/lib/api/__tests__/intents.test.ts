import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db/prisma";

// Mock o registry pra não importar libs pesadas (Asaas/charges-action) no test
vi.mock("@/lib/api/intent-executors", () => ({
  ensureIntentExecutorsRegistered: vi.fn(),
}));

import {
  canonicalize,
  hashPayload,
  requireApproval,
  executeIntent,
  registerIntentExecutor,
  IntentExecutionError,
  expirePendingIntents,
} from "../intents";

const baseAuth = {
  ident: { via: "bearer" as const, userId: "u-1", tokenId: "tk-1", scopes: ["charges:rw"] },
  actor: { effectiveUserId: "u-1", via: "newton" as const },
  org: { id: "org-1" },
};

const sessionAuth = {
  ident: { via: "session" as const, userId: "u-1", email: "u@x.com" },
  actor: { effectiveUserId: "u-1" },
  org: { id: "org-1" },
};

function makeReq(): Request {
  return new Request("https://example.com/api/x", { method: "POST" });
}

describe("canonicalize", () => {
  it("ordena chaves de objeto", () => {
    expect(canonicalize({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });
  it("recursivo em arrays", () => {
    expect(canonicalize([{ b: 1, a: 2 }])).toBe('[{"a":2,"b":1}]');
  });
  it("estavel pra string vazia / null", () => {
    expect(canonicalize(null)).toBe("null");
    expect(canonicalize("")).toBe('""');
  });
});

describe("hashPayload", () => {
  it("hash diferente quando chave reordenada (não é) — confirma canonicalização", () => {
    expect(hashPayload({ a: 1, b: 2 })).toBe(hashPayload({ b: 2, a: 1 }));
  });
  it("hash diferente quando valor muda", () => {
    expect(hashPayload({ a: 1 })).not.toBe(hashPayload({ a: 2 }));
  });
});

describe("requireApproval", () => {
  beforeEach(() => {
    vi.mocked(prisma.actionIntent.create).mockReset();
    vi.mocked(prisma.actionIntent.findUnique).mockReset();
    // `update` também: sem reset, asserções sobre `mock.calls[0]` leem a
    // chamada do teste ANTERIOR e passam/falham pelo motivo errado.
    vi.mocked(prisma.actionIntent.update).mockReset();
  });

  it("session: executa run() direto, sem criar intent", async () => {
    const run = vi.fn().mockResolvedValue({ status: 201, body: { id: "x" } });
    const r = await requireApproval({
      ctx: sessionAuth,
      action: "CHARGE_CREATE",
      payload: { amount: 1000 },
      preview: { summary: "test", details: {} },
      req: makeReq(),
      run,
    });
    expect(r.via).toBe("executed");
    expect(r.status).toBe(201);
    expect(run).toHaveBeenCalled();
    expect(prisma.actionIntent.create).not.toHaveBeenCalled();
  });

  it("bearer + autoApprove: executa na hora e grava a intent como executed", async () => {
    // Sem isto, o corretor que pede "manda a proposta" no WhatsApp gera uma
    // intent que só a tela do app aprova — o pedido dele expira em 24h.
    vi.mocked(prisma.actionIntent.create).mockResolvedValue({
      id: "intent-auto",
      status: "pending",
      action: "PROPOSAL_SEND",
      preview: { summary: "test", details: {} },
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    } as never);
    vi.mocked(prisma.actionIntent.update).mockResolvedValue({ id: "intent-auto" } as never);

    const run = vi.fn().mockResolvedValue({ status: 200, body: { ok: true } });
    const r = await requireApproval({
      ctx: baseAuth,
      action: "PROPOSAL_SEND",
      payload: { proposalId: "p-1" },
      preview: { summary: "test", details: {} },
      req: makeReq(),
      autoApprove: true,
      run,
    });

    expect(r.via).toBe("executed");
    expect(r.status).toBe(200);
    expect(run).toHaveBeenCalled();
    // A intent continua existindo: é o rastro de quem pediu e o que resultou.
    expect(prisma.actionIntent.create).toHaveBeenCalled();
    expect(vi.mocked(prisma.actionIntent.update).mock.calls[0][0]).toMatchObject({
      data: expect.objectContaining({ status: "executed" }),
    });
  });

  it("bearer + autoApprove: run() que falha marca a intent failed, não pending", async () => {
    // `pending` numa ação que já falhou mentiria que alguém ainda vai aprovar.
    vi.mocked(prisma.actionIntent.create).mockResolvedValue({
      id: "intent-fail",
      status: "pending",
      action: "PROPOSAL_SEND",
      preview: { summary: "test", details: {} },
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    } as never);
    vi.mocked(prisma.actionIntent.update).mockResolvedValue({ id: "intent-fail" } as never);

    const run = vi.fn().mockRejectedValue(new Error("clicksign fora do ar"));
    await expect(
      requireApproval({
        ctx: baseAuth,
        action: "PROPOSAL_SEND",
        payload: { proposalId: "p-1" },
        preview: { summary: "test", details: {} },
        req: makeReq(),
        autoApprove: true,
        run,
      })
    ).rejects.toThrow("clicksign fora do ar");

    expect(vi.mocked(prisma.actionIntent.update).mock.calls[0][0]).toMatchObject({
      data: expect.objectContaining({ status: "failed" }),
    });
  });

  it("bearer SEM autoApprove: segue exigindo aprovação (default não mudou)", async () => {
    vi.mocked(prisma.actionIntent.create).mockResolvedValue({
      id: "intent-gated",
      status: "pending",
      action: "PROPOSAL_CANCEL",
      preview: { summary: "test", details: {} },
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    } as never);
    const run = vi.fn();
    const r = await requireApproval({
      ctx: baseAuth,
      action: "PROPOSAL_CANCEL",
      payload: { proposalId: "p-1" },
      preview: { summary: "test", details: {} },
      req: makeReq(),
      run,
    });
    expect(r.via).toBe("pending");
    expect(run).not.toHaveBeenCalled();
  });

  it("bearer: cria intent pending e retorna 202", async () => {
    vi.mocked(prisma.actionIntent.create).mockResolvedValue({
      id: "intent-1",
      status: "pending",
      action: "CHARGE_CREATE",
      preview: { summary: "test", details: {} },
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    } as never);

    const run = vi.fn();
    const r = await requireApproval({
      ctx: baseAuth,
      action: "CHARGE_CREATE",
      payload: { amount: 1000 },
      preview: { summary: "test", details: { amount: 1000 } },
      req: makeReq(),
      run,
    });

    expect(r.via).toBe("pending");
    expect(r.status).toBe(202);
    expect(run).not.toHaveBeenCalled();
    expect(prisma.actionIntent.create).toHaveBeenCalled();
    const body = r.body as { intentId: string; status: string; approvalUrl: string };
    expect(body.intentId).toBe("intent-1");
    expect(body.status).toBe("pending");
    expect(body.approvalUrl).toBe("/intents/intent-1");
  });

  it("bearer com idempotencyKey: reusa intent existente pendente", async () => {
    vi.mocked(prisma.actionIntent.findUnique).mockResolvedValue({
      id: "intent-1",
      status: "pending",
      action: "CHARGE_CREATE",
      preview: { summary: "test", details: {} },
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    } as never);

    const r = await requireApproval({
      ctx: baseAuth,
      action: "CHARGE_CREATE",
      payload: { amount: 1000 },
      preview: { summary: "test", details: {} },
      req: makeReq(),
      run: vi.fn(),
      idempotencyKey: "key-123",
    });

    expect(r.status).toBe(202);
    expect(prisma.actionIntent.create).not.toHaveBeenCalled();
  });

  it("bearer com idempotencyKey: replays resultJson se já executou", async () => {
    vi.mocked(prisma.actionIntent.findUnique).mockResolvedValue({
      id: "intent-1",
      status: "executed",
      action: "CHARGE_CREATE",
      preview: { summary: "test", details: {} },
      expiresAt: new Date(),
      resultJson: { status: 201, body: { chargeId: "ch-1" } },
    } as never);

    const r = await requireApproval({
      ctx: baseAuth,
      action: "CHARGE_CREATE",
      payload: { amount: 1000 },
      preview: { summary: "test", details: {} },
      req: makeReq(),
      run: vi.fn(),
      idempotencyKey: "key-123",
    });

    expect(r.via).toBe("executed");
    expect(r.status).toBe(201);
    expect(r.body).toEqual({ chargeId: "ch-1" });
  });
});

describe("executeIntent", () => {
  beforeEach(() => {
    vi.mocked(prisma.actionIntent.findUnique).mockReset();
    vi.mocked(prisma.actionIntent.update).mockReset().mockResolvedValue({} as never);
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("executor sucesso: marca executed + retorna resultado", async () => {
    const payload = { amount: 1000 };
    const hash = hashPayload(payload);
    vi.mocked(prisma.actionIntent.findUnique).mockResolvedValue({
      id: "intent-1",
      orgId: "org-1",
      requestedBy: "u-1",
      action: "CHARGE_CREATE",
      status: "approved",
      payload,
      payloadHash: hash,
      expiresAt: new Date(Date.now() + 60_000),
    } as never);

    const executor = vi.fn().mockResolvedValue({ status: 201, body: { chargeId: "ch-1" } });
    registerIntentExecutor("CHARGE_CREATE", executor);

    const r = await executeIntent("intent-1");

    expect(executor).toHaveBeenCalledWith(
      payload,
      expect.objectContaining({ intentId: "intent-1", requestedBy: "u-1" })
    );
    expect(r.status).toBe(201);
    expect(r.body).toEqual({ chargeId: "ch-1" });
    expect(prisma.actionIntent.update).toHaveBeenCalledWith({
      where: { id: "intent-1" },
      data: expect.objectContaining({ status: "executed" }),
    });
  });

  it("rejeita se status != approved", async () => {
    vi.mocked(prisma.actionIntent.findUnique).mockResolvedValue({
      id: "intent-1",
      status: "pending",
    } as never);
    await expect(executeIntent("intent-1")).rejects.toThrow(IntentExecutionError);
  });

  it("detecta tampering: payloadHash diferente → marca failed + INTENT_TAMPERED", async () => {
    vi.mocked(prisma.actionIntent.findUnique).mockResolvedValue({
      id: "intent-1",
      orgId: "org-1",
      requestedBy: "u-1",
      action: "CHARGE_CREATE",
      status: "approved",
      payload: { amount: 9999 }, // payload "tampered"
      payloadHash: hashPayload({ amount: 1000 }), // hash original
      expiresAt: new Date(Date.now() + 60_000),
    } as never);

    await expect(executeIntent("intent-1")).rejects.toMatchObject({ code: "tampered" });
    expect(prisma.actionIntent.update).toHaveBeenCalledWith({
      where: { id: "intent-1" },
      data: expect.objectContaining({ status: "failed" }),
    });
  });

  it("expirada: marca expired + falha", async () => {
    vi.mocked(prisma.actionIntent.findUnique).mockResolvedValue({
      id: "intent-1",
      status: "approved",
      expiresAt: new Date(Date.now() - 1000),
    } as never);
    await expect(executeIntent("intent-1")).rejects.toMatchObject({ code: "expired" });
  });
});

describe("expirePendingIntents", () => {
  it("delega para updateMany com filtro pending+expired", async () => {
    vi.mocked(prisma.actionIntent.updateMany).mockResolvedValue({ count: 3 } as never);
    const n = await expirePendingIntents();
    expect(n).toBe(3);
    expect(prisma.actionIntent.updateMany).toHaveBeenCalled();
  });
});
