import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "../route";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { createMockSession, createMockOrg } from "@/__tests__/helpers";

vi.mock("@vercel/blob", () => ({
  put: vi.fn(async (_p, _b, _o) => ({ url: "https://blob/fake.pdf" })),
}));

const mockAuth = vi.mocked(auth);
const mockGetUserOrg = vi.mocked(getUserOrg);
const mockPrisma = vi.mocked(prisma);

beforeEach(() => {
  vi.clearAllMocks();
  mockGetUserOrg.mockResolvedValue(createMockOrg() as never);
  process.env.BLOB_READ_WRITE_TOKEN = "test-token";
});

function makeReq(body: unknown) {
  return new NextRequest("http://localhost/api/deals/d1/attachments-newton", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

const validBody = {
  filename: "matricula.pdf",
  mime: "application/pdf",
  base64Data: Buffer.from("hello world").toString("base64"),
};

const baseDeal = {
  id: "d1",
  form: { orgId: "org-1" },
  pipeline: { orgId: "org-1" },
};

describe("POST /api/deals/[dealId]/attachments-newton", () => {
  it("401 sem auth", async () => {
    mockAuth.mockResolvedValue(null);
    const res = await POST(makeReq(validBody), { params: { dealId: "d1" } });
    expect(res.status).toBe(401);
  });

  it("400 mime invalido", async () => {
    mockAuth.mockResolvedValue(createMockSession() as never);
    const res = await POST(
      makeReq({ ...validBody, mime: "application/zip" }),
      { params: { dealId: "d1" } }
    );
    expect(res.status).toBe(400);
  });

  it("404 deal inexistente", async () => {
    mockAuth.mockResolvedValue(createMockSession() as never);
    mockPrisma.deal.findUnique.mockResolvedValue(null as never);
    const res = await POST(makeReq(validBody), { params: { dealId: "d1" } });
    expect(res.status).toBe(404);
  });

  it("403 cross-org", async () => {
    mockAuth.mockResolvedValue(createMockSession() as never);
    mockPrisma.deal.findUnique.mockResolvedValue({
      ...baseDeal,
      form: { orgId: "other-org" },
      pipeline: { orgId: "other-org" },
    } as never);
    const res = await POST(makeReq(validBody), { params: { dealId: "d1" } });
    expect(res.status).toBe(403);
  });

  it("400 base64 vazio", async () => {
    mockAuth.mockResolvedValue(createMockSession() as never);
    mockPrisma.deal.findUnique.mockResolvedValue(baseDeal as never);
    const res = await POST(
      makeReq({ ...validBody, base64Data: "" }),
      { params: { dealId: "d1" } }
    );
    expect(res.status).toBe(400);
  });

  it("201 happy path: upload + persist", async () => {
    mockAuth.mockResolvedValue(createMockSession() as never);
    mockPrisma.deal.findUnique.mockResolvedValue(baseDeal as never);
    mockPrisma.dealAttachment.create.mockResolvedValue({
      id: "att-1",
      filename: validBody.filename,
      mime: validBody.mime,
      url: "https://blob/fake.pdf",
      category: null,
      createdAt: new Date(),
    } as never);

    const res = await POST(makeReq(validBody), { params: { dealId: "d1" } });
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.id).toBe("att-1");
    expect(json.url).toBe("https://blob/fake.pdf");
  });
});
