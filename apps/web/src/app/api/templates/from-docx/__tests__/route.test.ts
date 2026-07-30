/**
 * Ingestão "modelo da imobiliária (.docx) → template".
 *
 * O foco é o CLAIM-ROW: o dedup-check e o create acontecem na mesma transação e
 * ANTES do pipeline Drive+IA (~2min). Antes eles eram separados por esse
 * pipeline inteiro e duas requests concorrentes com o mesmo arquivo criavam dois
 * drafts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";

vi.mock("@/lib/auth/impersonation", () => ({
  getEffectiveUserId: vi.fn().mockResolvedValue("u1"),
}));
vi.mock("@/lib/google/upload-file-as-gdoc", () => ({
  uploadFileAsGoogleDoc: vi.fn(),
}));
vi.mock("@/lib/google/client", () => ({
  isGoogleDocsFeatureEnabled: vi.fn().mockReturnValue(true),
}));
vi.mock("@/lib/templates/ai-placeholder-insertion", () => ({
  insertPlaceholdersWithAI: vi.fn().mockResolvedValue({ inserted: 3 }),
}));

import { POST } from "../route";
import { uploadFileAsGoogleDoc } from "@/lib/google/upload-file-as-gdoc";
import { insertPlaceholdersWithAI } from "@/lib/templates/ai-placeholder-insertion";

type MockFn = ReturnType<typeof vi.fn>;
const authMock = auth as unknown as MockFn;
const orgMock = getUserOrg as unknown as MockFn;
const uploadMock = uploadFileAsGoogleDoc as unknown as MockFn;
const aiMock = insertPlaceholdersWithAI as unknown as MockFn;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const p = prisma as any;

/** DOCX válido só precisa do magic header PK\x03\x04 pro guard da rota. */
function docxFile(content = "modelo"): File {
  const bytes = Buffer.concat([
    Buffer.from([0x50, 0x4b, 0x03, 0x04]),
    Buffer.from(content),
  ]);
  return new File([bytes], "Modelo.docx", {
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
}

function req(opts: { force?: boolean; file?: File } = {}): NextRequest {
  const fd = new FormData();
  fd.set("file", opts.file ?? docxFile());
  fd.set("modalidade", "locacao");
  if (opts.force) fd.set("force", "true");
  return new NextRequest("http://localhost/api/templates/from-docx", {
    method: "POST",
    body: fd,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  authMock.mockResolvedValue({ user: { id: "u1" } });
  orgMock.mockResolvedValue({ id: "org-1" });
  p.orgMembership.findFirst = vi.fn().mockResolvedValue({ role: "owner" });
  // Sem duplicata e sem colisão de nome, por padrão.
  p.contractTemplate.findFirst = vi.fn().mockResolvedValue(null);
  p.contractTemplate.findMany = vi.fn().mockResolvedValue([]);
  p.contractTemplate.create = vi
    .fn()
    .mockResolvedValue({ id: "tpl-1", name: "Modelo da imobiliária — Modelo" });
  p.contractTemplate.update = vi.fn().mockResolvedValue({});
  p.contractTemplate.delete = vi.fn().mockResolvedValue({});
  uploadMock.mockResolvedValue({
    docId: "gdoc-1",
    webViewLink: "https://docs/1",
    embedLink: "https://docs/1/embed",
  });
  aiMock.mockResolvedValue({ inserted: 3 });
});

describe("POST /api/templates/from-docx — claim-row", () => {
  it("cria a row ANTES do Drive, sem docId, e só depois preenche", async () => {
    const res = await POST(req());

    expect(res.status).toBe(200);
    // Ordem: create (claim) → upload → update(docId).
    const createOrder = p.contractTemplate.create.mock.invocationCallOrder[0];
    const uploadOrder = uploadMock.mock.invocationCallOrder[0];
    expect(createOrder).toBeLessThan(uploadOrder);

    const claim = p.contractTemplate.create.mock.calls[0][0].data;
    expect(claim.googleTemplateDocId).toBeNull();
    expect(claim.status).toBe("draft");
    expect(claim.sourceHash).toMatch(/^[0-9a-f]{64}$/);

    expect(p.contractTemplate.update).toHaveBeenCalledWith({
      where: { id: "tpl-1" },
      data: { googleTemplateDocId: "gdoc-1" },
    });
    expect(await res.json()).toMatchObject({ templateId: "tpl-1", docId: "gdoc-1" });
  });

  it("dedup: request concorrente enxerga a claim-row pelo hash → 409 sem tocar no Drive", async () => {
    p.contractTemplate.findFirst = vi.fn().mockResolvedValue({
      id: "tpl-claim",
      name: "Modelo da imobiliária — Modelo",
      status: "draft",
      modalidade: "locacao",
    });

    const res = await POST(req());

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      code: "DUPLICATE_TEMPLATE",
      existing: { id: "tpl-claim", status: "draft" },
    });
    expect(p.contractTemplate.create).not.toHaveBeenCalled();
    expect(uploadMock).not.toHaveBeenCalled();
  });

  it("`force=true` ignora a duplicata e cria mesmo assim", async () => {
    p.contractTemplate.findFirst = vi
      .fn()
      .mockResolvedValue({ id: "tpl-old", name: "X", status: "active", modalidade: "locacao" });

    const res = await POST(req({ force: true }));

    expect(res.status).toBe(200);
    expect(p.contractTemplate.create).toHaveBeenCalledTimes(1);
  });

  it("falha do Drive apaga a claim-row (hash não fica ocupado) e devolve 502", async () => {
    uploadMock.mockRejectedValue(new Error("Drive fora do ar"));

    const res = await POST(req());

    expect(res.status).toBe(502);
    expect(p.contractTemplate.delete).toHaveBeenCalledWith({ where: { id: "tpl-1" } });
  });

  it("falha do pass de IA NÃO apaga a claim-row (o doc já existe)", async () => {
    aiMock.mockRejectedValue(new Error("Anthropic 529"));

    const res = await POST(req());

    expect(res.status).toBe(200);
    expect(p.contractTemplate.delete).not.toHaveBeenCalled();
    expect((await res.json()).report).toBeNull();
  });

  it("modalidade inválida não chega a criar claim-row", async () => {
    const fd = new FormData();
    fd.set("file", docxFile());
    fd.set("modalidade", "inexistente");
    const res = await POST(
      new NextRequest("http://localhost/api/templates/from-docx", {
        method: "POST",
        body: fd,
      })
    );

    expect(res.status).toBe(400);
    expect(p.contractTemplate.create).not.toHaveBeenCalled();
  });
});
