import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { GET, DELETE, PATCH } from "../route";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { createMockSession, createMockOrg } from "@/__tests__/helpers";

const mockAuth = vi.mocked(auth);
const mockGetUserOrg = vi.mocked(getUserOrg);
const mockPrisma = vi.mocked(prisma);

beforeEach(() => {
  vi.clearAllMocks();
  mockGetUserOrg.mockResolvedValue(createMockOrg() as never);
});

function makeReq(method: "GET" | "DELETE" = "GET", url = "http://localhost/api/deals/d1") {
  return new NextRequest(url, { method });
}

describe("GET /api/deals/[dealId] (retrofit Newton)", () => {
  it("401 sem auth", async () => {
    mockAuth.mockResolvedValue(null);
    const res = await GET(makeReq(), { params: { dealId: "d1" } });
    expect(res.status).toBe(401);
  });

  it("404 deal não existe", async () => {
    mockAuth.mockResolvedValue(createMockSession() as never);
    mockPrisma.deal.findUnique.mockResolvedValue(null as never);
    const res = await GET(makeReq(), { params: { dealId: "d1" } });
    expect(res.status).toBe(404);
  });

  it("403 cross-org via form", async () => {
    mockAuth.mockResolvedValue(createMockSession() as never);
    mockPrisma.deal.findUnique.mockResolvedValue({
      id: "d1",
      stageId: "s1",
      updatedAt: new Date(),
      form: { orgId: "other-org", dataJson: {}, token: "t", status: "ok" },
      pipeline: { orgId: "other-org" },
      stage: { id: "s1", name: "Lead" },
    } as never);
    const res = await GET(makeReq(), { params: { dealId: "d1" } });
    expect(res.status).toBe(403);
  });

  it("403 cross-org sem form (via deal.pipeline.orgId)", async () => {
    mockAuth.mockResolvedValue(createMockSession() as never);
    mockPrisma.deal.findUnique.mockResolvedValue({
      id: "d1",
      stageId: "s1",
      updatedAt: new Date(),
      form: null,
      pipeline: { orgId: "other-org" },
      stage: { id: "s1", name: "Lead" },
    } as never);
    const res = await GET(makeReq(), { params: { dealId: "d1" } });
    expect(res.status).toBe(403);
  });

  it("200 retorna deal com header ETag baseado em updatedAt", async () => {
    mockAuth.mockResolvedValue(createMockSession() as never);
    const updatedAt = new Date("2026-05-01T10:00:00Z");
    mockPrisma.deal.findUnique.mockResolvedValue({
      id: "d1",
      stageId: "s1",
      updatedAt,
      form: {
        orgId: "org-1",
        dataJson: {},
        token: "tok",
        status: "ok",
      },
      pipeline: { orgId: "org-1" },
      stage: { id: "s1", name: "Lead" },
    } as never);

    const res = await GET(makeReq(), { params: { dealId: "d1" } });
    expect(res.status).toBe(200);
    const etag = res.headers.get("ETag");
    expect(etag).toMatch(/^W\/"[a-f0-9]{16}"$/);
  });
});

describe("DELETE /api/deals/[dealId] (retrofit Newton)", () => {
  it("401 sem auth", async () => {
    mockAuth.mockResolvedValue(null);
    const res = await DELETE(makeReq("DELETE"), { params: { dealId: "d1" } });
    expect(res.status).toBe(401);
  });

  it("404 quando deal não existe", async () => {
    mockAuth.mockResolvedValue(createMockSession() as never);
    mockPrisma.deal.findUnique.mockResolvedValue(null as never);
    const res = await DELETE(makeReq("DELETE"), { params: { dealId: "d1" } });
    expect(res.status).toBe(404);
  });

  it("403 cross-org", async () => {
    mockAuth.mockResolvedValue(createMockSession() as never);
    mockPrisma.deal.findUnique.mockResolvedValue({
      id: "d1",
      formId: "f1",
      title: "x",
      form: { orgId: "outsider" },
      stage: null,
    } as never);
    const res = await DELETE(makeReq("DELETE"), { params: { dealId: "d1" } });
    expect(res.status).toBe(403);
  });

  it("hard delete: deleta + audita DEAL_DELETE", async () => {
    mockAuth.mockResolvedValue(createMockSession() as never);
    mockPrisma.deal.findUnique.mockResolvedValue({
      id: "d1",
      formId: "f1",
      title: "Caso Maria",
      form: { orgId: "org-1" },
      stage: null,
    } as never);

    const res = await DELETE(makeReq("DELETE"), { params: { dealId: "d1" } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.mode).toBe("hard");

    expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "DEAL_DELETE",
          resource: "d1",
        }),
      })
    );
  });

  it("soft delete (?soft=1) move para stage Arquivado", async () => {
    mockAuth.mockResolvedValue(createMockSession() as never);
    mockPrisma.deal.findUnique.mockResolvedValue({
      id: "d1",
      formId: null,
      title: "x",
      form: null,
      stage: { pipeline: { orgId: "org-1" } },
    } as never);
    mockPrisma.pipelineStage.findFirst.mockResolvedValue({
      id: "stage-arq",
    } as never);
    mockPrisma.deal.update.mockResolvedValue({} as never);

    const url = "http://localhost/api/deals/d1?soft=1";
    const res = await DELETE(
      new NextRequest(url, { method: "DELETE" }),
      { params: { dealId: "d1" } }
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.mode).toBe("soft");
    expect(mockPrisma.deal.update).toHaveBeenCalledWith({
      where: { id: "d1" },
      data: { stageId: "stage-arq", stageEnteredAt: expect.any(Date) },
    });
  });

  it("soft delete sem stage Arquivado retorna 400", async () => {
    mockAuth.mockResolvedValue(createMockSession() as never);
    mockPrisma.deal.findUnique.mockResolvedValue({
      id: "d1",
      formId: null,
      title: "x",
      form: null,
      stage: { pipeline: { orgId: "org-1" } },
    } as never);
    mockPrisma.pipelineStage.findFirst.mockResolvedValue(null as never);

    const url = "http://localhost/api/deals/d1?soft=1";
    const res = await DELETE(
      new NextRequest(url, { method: "DELETE" }),
      { params: { dealId: "d1" } }
    );
    expect(res.status).toBe(400);
  });
});

describe("PATCH /api/deals/[dealId] (Newton stage move)", () => {
  function patchReq(body: unknown) {
    return new NextRequest("http://localhost/api/deals/d1", {
      method: "PATCH",
      body: JSON.stringify(body),
    });
  }

  const baseDeal = {
    id: "d1",
    pipelineId: "p1",
    stageId: "s1",
    form: { orgId: "org-1" },
    pipeline: { orgId: "org-1" },
    stage: { id: "s1", name: "Lead" },
  };

  it("401 sem auth", async () => {
    mockAuth.mockResolvedValue(null);
    const res = await PATCH(patchReq({ stageId: "s2" }), { params: { dealId: "d1" } });
    expect(res.status).toBe(401);
  });

  it("400 body vazio", async () => {
    mockAuth.mockResolvedValue(createMockSession() as never);
    const res = await PATCH(patchReq({}), { params: { dealId: "d1" } });
    expect(res.status).toBe(400);
  });

  it("404 deal inexistente", async () => {
    mockAuth.mockResolvedValue(createMockSession() as never);
    mockPrisma.deal.findUnique.mockResolvedValue(null as never);
    const res = await PATCH(patchReq({ stageId: "s2" }), { params: { dealId: "d1" } });
    expect(res.status).toBe(404);
  });

  it("403 cross-org", async () => {
    mockAuth.mockResolvedValue(createMockSession() as never);
    mockPrisma.deal.findUnique.mockResolvedValue({
      ...baseDeal,
      form: { orgId: "other-org" },
      pipeline: { orgId: "other-org" },
    } as never);
    const res = await PATCH(patchReq({ stageId: "s2" }), { params: { dealId: "d1" } });
    expect(res.status).toBe(403);
  });

  it("400 stageId fora do pipeline", async () => {
    mockAuth.mockResolvedValue(createMockSession() as never);
    mockPrisma.deal.findUnique.mockResolvedValue(baseDeal as never);
    mockPrisma.pipelineStage.findFirst.mockResolvedValue(null as never);
    const res = await PATCH(patchReq({ stageId: "s2-bad" }), { params: { dealId: "d1" } });
    expect(res.status).toBe(400);
  });

  it("200 happy path: stage move", async () => {
    mockAuth.mockResolvedValue(createMockSession() as never);
    mockPrisma.deal.findUnique.mockResolvedValue(baseDeal as never);
    mockPrisma.pipelineStage.findFirst.mockResolvedValue({
      id: "s2",
      name: "Negociação",
    } as never);
    mockPrisma.deal.update.mockResolvedValue({
      id: "d1",
      title: "x",
      stageId: "s2",
      stage: { id: "s2", name: "Negociação" },
      updatedAt: new Date(),
    } as never);

    const res = await PATCH(patchReq({ stageId: "s2" }), { params: { dealId: "d1" } });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.stageId).toBe("s2");
    expect(json.stage.name).toBe("Negociação");
  });
});
