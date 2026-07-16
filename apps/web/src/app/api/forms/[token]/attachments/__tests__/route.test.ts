import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "../route";
import { prisma } from "@/lib/db/prisma";
import { resolveFormScope } from "@/lib/forms/resolve-form-scope";

vi.mock("@vercel/blob", () => ({
  put: vi.fn().mockResolvedValue({ url: "https://blob.test/f.pdf" }),
  del: vi.fn(),
}));

vi.mock("@/lib/forms/resolve-form-scope", () => ({
  resolveFormScope: vi.fn(),
  formLockedResponse: vi.fn(() => null),
}));

const mockPrisma = vi.mocked(prisma);
const mockResolveFormScope = vi.mocked(resolveFormScope);

function makeUploadReq(token: string) {
  const body = new FormData();
  body.append(
    "file",
    new File([`%PDF-1.7 ${"x".repeat(200)}`], "cnh.pdf", {
      type: "application/pdf",
    })
  );
  return new NextRequest(`http://localhost/api/forms/${token}/attachments`, {
    method: "POST",
    body,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.BLOB_READ_WRITE_TOKEN = "test-blob-token";
  mockResolveFormScope.mockResolvedValue({
    formId: "form1",
    orgId: "org1",
    participantId: null,
  } as never);
  mockPrisma.formAttachment.create.mockImplementation(
    async ({ data }: never) =>
      ({
        id: "att1",
        createdAt: new Date("2026-07-15T00:00:00Z"),
        ...(data as object),
      }) as never
  );
});

// Contrato client↔server do OCR on-demand (commit 0bb30a3d). O bug do teste
// RE/MAX Trio (2026-07-15) aconteceu porque o client ASSUMIA que o upload
// enfileirava OCR; estes testes travam o contrato: o POST responde com o
// `status` real e não dispara worker nenhum (awaiting_user é ignorado pelo
// cron — só o clique em "Extrair com IA" via /retry enfileira).
describe("POST /api/forms/[token]/attachments (OCR on-demand)", () => {
  it("upload não-cacheado: 202 com status='awaiting_user', sem OCR", async () => {
    mockPrisma.formAttachment.findFirst.mockResolvedValue(null as never);

    const res = await POST(makeUploadReq("tok1"), {
      params: { token: "tok1" },
    });

    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.status).toBe("awaiting_user");
    expect(body.cached).toBe(false);
    expect(body.extractedData).toBeNull();

    // O attachment persiste awaiting_user — estado que o cron do worker
    // ignora por design (extração só via clique do usuário).
    expect(mockPrisma.formAttachment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "awaiting_user" }),
      })
    );
  });

  it("cache-hit por content-hash: 202 com status='ready' + extractedData", async () => {
    mockPrisma.formAttachment.findFirst.mockResolvedValue({
      category: "cnh",
      extractedData: { fields: { nome: "Maria" }, confidence: 0.97 },
    } as never);

    const res = await POST(makeUploadReq("tok1"), {
      params: { token: "tok1" },
    });

    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.status).toBe("ready");
    expect(body.cached).toBe(true);
    expect(body.category).toBe("cnh");
    expect(body.extractedData).toEqual({
      fields: { nome: "Maria" },
      confidence: 0.97,
    });
  });
});
