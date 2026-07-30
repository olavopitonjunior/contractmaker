import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { createMockSession, createMockOrg } from "@/__tests__/helpers";

const mockSendAttachment = vi.fn();
vi.mock("@/lib/clicksign/executor", () => ({
  sendEnvelopeForAttachment: (...args: unknown[]) => mockSendAttachment(...args),
  EnvelopeBudgetError: class EnvelopeBudgetError extends Error {
    constructor(
      msg: string,
      public spentCents: number,
      public budgetCents: number,
      public planCostCents: number
    ) {
      super(msg);
    }
  },
  MissingEmailsError: class MissingEmailsError extends Error {
    constructor(public missing: unknown[]) {
      super("missing");
    }
  },
}));

vi.mock("@/lib/clicksign/client", () => ({
  ClicksignError: class ClicksignError extends Error {
    constructor(msg: string, public status: number) {
      super(msg);
    }
  },
}));

import { POST } from "../route";

const mockAuth = vi.mocked(auth);
const mockGetUserOrg = vi.mocked(getUserOrg);
const mockPrisma = vi.mocked(prisma);

beforeEach(() => {
  vi.clearAllMocks();
  mockGetUserOrg.mockResolvedValue(createMockOrg() as never);
  mockAuth.mockResolvedValue(createMockSession() as never);
  // Escopo do gerente (guardDealScope): a rota busca o deal pra resolver
  // criador/gerente. Default = deal da org do mock, criado pelo próprio user.
  mockPrisma.deal.findUnique.mockResolvedValue({
    userId: "user-1",
    managerUserId: null,
    pipeline: { orgId: "org-1" },
  } as never);
});

function makeReq(body: unknown) {
  return new NextRequest("http://localhost/api/deals/d1/envelopes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const validBody = {
  attachmentId: "att-1",
  authMethod: "email",
  signers: [
    { name: "João Silva", email: "joao@example.com" },
  ],
};

const matchingAttachment = {
  id: "att-1",
  dealId: "d1",
  mime: "application/pdf",
  deal: { pipeline: { orgId: "org-1" } },
};

describe("POST /api/deals/[dealId]/envelopes", () => {
  it("401 sem auth", async () => {
    mockAuth.mockResolvedValue(null);
    const res = await POST(makeReq(validBody), { params: { dealId: "d1" } });
    expect(res.status).toBe(401);
  });

  it("400 sem signers", async () => {
    const res = await POST(
      makeReq({ ...validBody, signers: [] }),
      { params: { dealId: "d1" } }
    );
    expect(res.status).toBe(400);
  });

  it("404 quando attachment não pertence ao deal", async () => {
    mockPrisma.dealAttachment.findUnique.mockResolvedValue({
      ...matchingAttachment,
      dealId: "d2", // outro deal
    } as never);
    const res = await POST(makeReq(validBody), { params: { dealId: "d1" } });
    expect(res.status).toBe(404);
  });

  it("403 quando deal pertence a outra org", async () => {
    mockPrisma.dealAttachment.findUnique.mockResolvedValue({
      ...matchingAttachment,
      deal: { pipeline: { orgId: "outra-org" } },
    } as never);
    const res = await POST(makeReq(validBody), { params: { dealId: "d1" } });
    expect(res.status).toBe(403);
  });

  it("happy path: chama sendEnvelopeForAttachment e retorna 201", async () => {
    mockPrisma.dealAttachment.findUnique.mockResolvedValue(matchingAttachment as never);
    mockSendAttachment.mockResolvedValue({
      id: "env-1",
      status: "running",
    });

    const res = await POST(makeReq(validBody), { params: { dealId: "d1" } });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.envelope.id).toBe("env-1");
    expect(mockSendAttachment).toHaveBeenCalledWith(
      expect.objectContaining({
        attachmentId: "att-1",
        authMethod: "email",
        signers: expect.arrayContaining([
          expect.objectContaining({ email: "joao@example.com" }),
        ]),
      })
    );
  });

  it("422 quando executor lança MissingEmailsError", async () => {
    mockPrisma.dealAttachment.findUnique.mockResolvedValue(matchingAttachment as never);
    const { MissingEmailsError } = await import("@/lib/clicksign/executor");
    mockSendAttachment.mockRejectedValueOnce(new MissingEmailsError([
      { sourceKind: "vendedor", sourceIndex: 0, name: "X" },
    ]));
    const res = await POST(makeReq(validBody), { params: { dealId: "d1" } });
    expect(res.status).toBe(422);
  });
});
