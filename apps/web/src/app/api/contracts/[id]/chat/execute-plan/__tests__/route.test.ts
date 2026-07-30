import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// Prisma local (o mock global de setup.ts não tem chatPlan) — só o que a rota usa.
const { db } = vi.hoisted(() => ({
  db: {
    chatPlan: { findUnique: vi.fn(), update: vi.fn() },
    contractChangeLog: { createMany: vi.fn() },
    chatMessage: { create: vi.fn() },
    chatSession: { update: vi.fn() },
  },
}));
vi.mock("@/lib/db/prisma", () => ({ prisma: db }));

const { mockRequireApiAuth, mockExecuteToolHandler } = vi.hoisted(() => ({
  mockRequireApiAuth: vi.fn(),
  mockExecuteToolHandler: vi.fn(),
}));
vi.mock("@/lib/api/require-auth", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/api/require-auth")
  >("@/lib/api/require-auth");
  return { ...actual, requireApiAuth: mockRequireApiAuth };
});
vi.mock("@/lib/ai/tool-handlers", () => ({
  executeToolHandler: mockExecuteToolHandler,
}));
// Escopo do gerente (veio da staging): liberado por padrão — o alvo destes
// testes é a atribuição do ChangeLog, não o RBAC (coberto em lib/deals).
vi.mock("@/lib/deals/route-helpers", () => ({
  guardContractScope: vi.fn().mockResolvedValue(null),
}));
vi.mock("@/lib/ai/budget", () => ({
  assertContractBudget: vi.fn(),
  ContractBudgetExceededError: class extends Error {},
}));
vi.mock("@/lib/google/docs", () => ({
  getDocPlainText: vi.fn(async () => "texto"),
}));

import { POST } from "../route";

const PLAN_ID = "clplan00000000000000000001";

function makePlan() {
  return {
    id: PLAN_ID,
    sessionId: "sess-1",
    status: "proposed",
    stepsJson: [
      {
        id: "s1",
        type: "write",
        status: "pending",
        tool: "replace_text",
        description: "Troca o valor",
        input: { from: "a", to: "b" },
      },
    ],
    session: {
      contractId: "c1",
      contract: {
        id: "c1",
        userId: "dono-do-contrato",
        status: "rascunho",
        htmlContent: "<p>x</p>",
        dataJson: {},
        googleDocId: null,
        templateOverride: null,
        template: null,
        clauses: [],
        deal: { pipeline: { orgId: "org-1" } },
      },
    },
  };
}

function createRequest(body: unknown) {
  return new NextRequest("http://localhost/api/contracts/c1/chat/execute-plan", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

async function drain(res: Response) {
  await res.text();
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireApiAuth.mockResolvedValue({
    ident: { via: "session", userId: "quem-aprovou" },
    actor: { effectiveUserId: "quem-aprovou" },
    org: { id: "org-1" },
  });
  mockExecuteToolHandler.mockResolvedValue({ success: true });
  db.chatPlan.findUnique.mockResolvedValue(makePlan());
  db.chatPlan.update.mockResolvedValue({});
  db.contractChangeLog.createMany.mockResolvedValue({ count: 1 });
  db.chatMessage.create.mockResolvedValue({});
  db.chatSession.update.mockResolvedValue({});
});

describe("POST execute-plan — atribuição do ChangeLog", () => {
  it("credita o ChangeLog a quem APROVOU o plano, não ao dono do contrato", async () => {
    const res = await POST(
      createRequest({ planId: PLAN_ID, approvedStepIds: ["s1"] }),
      { params: { id: "c1" } }
    );
    await drain(res);

    expect(db.contractChangeLog.createMany).toHaveBeenCalledTimes(1);
    const { data } = db.contractChangeLog.createMany.mock.calls[0][0] as {
      data: Array<Record<string, unknown>>;
    };
    expect(data).toHaveLength(1);
    expect(data[0].userId).toBe("quem-aprovou");
    expect(data[0].source).toBe("ai");
    expect(data[0].sessionId).toBe("sess-1");
  });

  it("sob impersonation usa a identidade efetiva (dono do tenant)", async () => {
    mockRequireApiAuth.mockResolvedValue({
      ident: { via: "session", userId: "super-admin" },
      actor: { effectiveUserId: "owner-do-tenant" },
      org: { id: "org-1" },
      impersonatedByUserId: "super-admin",
    });

    const res = await POST(
      createRequest({ planId: PLAN_ID, approvedStepIds: ["s1"] }),
      { params: { id: "c1" } }
    );
    await drain(res);

    const { data } = db.contractChangeLog.createMany.mock.calls[0][0] as {
      data: Array<Record<string, unknown>>;
    };
    expect(data[0].userId).toBe("owner-do-tenant");
  });

  it("404 quando o plano é de outra org", async () => {
    const plan = makePlan();
    plan.session.contract.deal.pipeline.orgId = "org-OUTRA";
    db.chatPlan.findUnique.mockResolvedValue(plan);

    const res = await POST(
      createRequest({ planId: PLAN_ID, approvedStepIds: ["s1"] }),
      { params: { id: "c1" } }
    );

    expect(res.status).toBe(404);
    expect(db.contractChangeLog.createMany).not.toHaveBeenCalled();
  });
});
