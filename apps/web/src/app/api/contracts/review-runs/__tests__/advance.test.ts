import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db/prisma";

const advanceReviewRunMock = vi.fn();
vi.mock("@/lib/contract-review/executor", () => ({
  advanceReviewRun: (...args: unknown[]) => advanceReviewRunMock(...args),
}));

const authMock = vi.fn();
const getUserOrgMock = vi.fn();
vi.mock("@/lib/auth/auth", () => ({
  auth: (...args: unknown[]) => authMock(...args),
  getUserOrg: (...args: unknown[]) => getUserOrgMock(...args),
}));

import { POST } from "../[runId]/advance/route";

const runFindFirst = prisma.contractReviewRun.findFirst as ReturnType<typeof vi.fn>;

function request(headers: Record<string, string> = {}) {
  return new NextRequest("http://localhost/api/contracts/review-runs/run1/advance", {
    method: "POST",
    headers,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CRON_SECRET = "segredo";
  advanceReviewRunMock.mockResolvedValue({ runId: "run1", claimed: true, status: "done" });
});

describe("POST /api/contracts/review-runs/[runId]/advance", () => {
  it("porta interna: x-cron-secret válido processa sem tocar em sessão", async () => {
    const res = await POST(request({ "x-cron-secret": "segredo" }), {
      params: { runId: "run1" },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ runId: "run1", status: "done" });
    expect(authMock).not.toHaveBeenCalled();
    expect(advanceReviewRunMock).toHaveBeenCalledWith("run1");
  });

  it("sem sessão e sem secret → 401", async () => {
    authMock.mockResolvedValue(null);
    const res = await POST(request(), { params: { runId: "run1" } });
    expect(res.status).toBe(401);
    expect(advanceReviewRunMock).not.toHaveBeenCalled();
  });

  it("sessão de outra org → 404 idêntico a inexistente", async () => {
    authMock.mockResolvedValue({ user: { id: "u1" } });
    getUserOrgMock.mockResolvedValue({ id: "org2" });
    runFindFirst.mockResolvedValue(null);
    const res = await POST(request(), { params: { runId: "run1" } });
    expect(res.status).toBe(404);
    expect(runFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "run1", orgId: "org2" } })
    );
    expect(advanceReviewRunMock).not.toHaveBeenCalled();
  });

  it("sessão da org do run processa", async () => {
    authMock.mockResolvedValue({ user: { id: "u1" } });
    getUserOrgMock.mockResolvedValue({ id: "org1" });
    runFindFirst.mockResolvedValue({ id: "run1" });
    const res = await POST(request(), { params: { runId: "run1" } });
    expect(res.status).toBe(200);
    expect(advanceReviewRunMock).toHaveBeenCalledWith("run1");
  });

  it("run inexistente na porta interna → 404", async () => {
    advanceReviewRunMock.mockResolvedValue({
      runId: "run1",
      claimed: false,
      status: "not-found",
    });
    const res = await POST(request({ "x-cron-secret": "segredo" }), {
      params: { runId: "run1" },
    });
    expect(res.status).toBe(404);
  });
});
