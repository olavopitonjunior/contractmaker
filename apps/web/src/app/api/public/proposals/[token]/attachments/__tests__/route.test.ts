import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/proposals/public-upload", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/proposals/public-upload")>();
  return { ...actual, resolvePublicUploadScope: vi.fn() };
});

import { GET } from "../route";
import { prisma } from "@/lib/db/prisma";
import { resolvePublicUploadScope } from "@/lib/proposals/public-upload";

const mockScope = vi.mocked(resolvePublicUploadScope);
const findMany = prisma.proposalAttachment.findMany as unknown as ReturnType<typeof vi.fn>;

const req = () => new NextRequest("http://localhost/api/public/proposals/tok1/attachments");
const params = { params: { token: "tok1" } };

beforeEach(() => {
  vi.clearAllMocks();
  mockScope.mockResolvedValue({
    ok: true,
    scope: { proposalId: "p1", orgId: "org1", userId: "u1", status: "enviada", dataJson: {} },
  } as never);
  findMany.mockResolvedValue([
    {
      id: "a1",
      filename: "rg.pdf",
      mime: "application/pdf",
      status: "awaiting_user",
      createdAt: new Date("2026-09-04T12:00:00Z"),
      url: "https://blob/secret.pdf",
      extractedData: { assignment: { kind: "fiador", index: 0 }, assignmentPersisted: true, fields: { cpf: "x" } },
    },
  ]);
});

describe("GET /api/public/proposals/[token]/attachments — o lead vê só o que ele mandou", () => {
  it("token inválido → 404; proposta fechada → 403", async () => {
    mockScope.mockResolvedValueOnce({ ok: false, reason: "not_found" } as never);
    expect((await GET(req(), params)).status).toBe(404);
    mockScope.mockResolvedValueOnce({ ok: false, reason: "closed" } as never);
    expect((await GET(req(), params)).status).toBe(403);
    expect(findMany).not.toHaveBeenCalled();
  });

  it("consulta filtra source=public da proposta do token (documentos internos nunca entram)", async () => {
    await GET(req(), params);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { proposalId: "p1", source: "public" } })
    );
  });

  it("resposta sem URL do blob e sem campos de OCR — só nome, tipo, status e parte", async () => {
    const body = await (await GET(req(), params)).json();
    expect(body.attachments).toHaveLength(1);
    const a = body.attachments[0];
    expect(a).toEqual(
      expect.objectContaining({ id: "a1", filename: "rg.pdf", assignment: { kind: "fiador", index: 0 } })
    );
    expect(a.url).toBeUndefined();
    expect(a.extractedData).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain("secret.pdf");
    expect(JSON.stringify(body)).not.toContain('"cpf"');
  });
});
