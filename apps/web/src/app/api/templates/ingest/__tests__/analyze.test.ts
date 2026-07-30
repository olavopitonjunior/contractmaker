import { describe, it, expect, vi, beforeEach } from "vitest";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";

vi.mock("@/lib/auth/impersonation", () => ({
  getEffectiveUserId: vi.fn(async (id: string) => id),
}));

const extractDocxMock = vi.fn();
vi.mock("@/lib/extraction/docx", () => ({
  extractDocx: (...args: unknown[]) => extractDocxMock(...args),
}));

const extractPlainTextMock = vi.fn();
vi.mock("@/lib/ai/ocr", () => ({
  extractPlainText: (...args: unknown[]) => extractPlainTextMock(...args),
}));

const classifyMock = vi.fn();
vi.mock("@/lib/knowledge/upload-classifier", () => ({
  classifyKnowledgeUpload: (...args: unknown[]) => classifyMock(...args),
}));

const getOrgModulesMock = vi.fn();
vi.mock("@/lib/modules/read", () => ({
  getOrgModules: (...args: unknown[]) => getOrgModulesMock(...args),
}));

import { POST } from "../analyze/route";

const authMock = auth as unknown as ReturnType<typeof vi.fn>;
const getUserOrgMock = getUserOrg as unknown as ReturnType<typeof vi.fn>;
const membershipFindFirst = prisma.orgMembership.findFirst as unknown as ReturnType<
  typeof vi.fn
>;
const templateFindFirst = prisma.contractTemplate.findFirst as unknown as ReturnType<
  typeof vi.fn
>;

/** DOCX é um ZIP — só o magic header importa (a extração está mockada). */
function docxFile(name = "contrato.docx"): File {
  const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, ...new Array(60).fill(0x41)]);
  return new File([bytes], name, { type: "application/octet-stream" });
}

function pdfFile(name = "modelo.pdf"): File {
  const bytes = new TextEncoder().encode(`%PDF-1.7\n${"x".repeat(60)}`);
  return new File([bytes], name, { type: "application/pdf" });
}

function req(file?: File): Request {
  const fd = new FormData();
  if (file) fd.append("file", file);
  return new Request("http://localhost/api/templates/ingest/analyze", {
    method: "POST",
    body: fd,
  });
}

const CONTRATO_LOCACAO = [
  "INSTRUMENTO PARTICULAR DE CONTRATO DE LOCAÇÃO RESIDENCIAL",
  "Pelo presente instrumento, de um lado a PARTE LOCADORA e de outro a PARTE LOCATÁRIA, inscrita no CPF sob nº 123.456.789-00, residente e domiciliada nesta cidade.",
  "CLÁUSULA PRIMEIRA - DO OBJETO",
  "1.1. A locação recai sobre o imóvel residencial descrito abaixo.",
  "CLÁUSULA SEGUNDA - DO ALUGUEL",
  "2.1. O aluguel mensal é de R$ 2.500,00.",
  "E por estarem assim justos e contratados, firmam o presente em duas vias.",
].join("\n");

describe("POST /api/templates/ingest/analyze", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue({ user: { id: "u1" } });
    getUserOrgMock.mockResolvedValue({ id: "org1" });
    membershipFindFirst.mockResolvedValue({ role: "owner" });
    templateFindFirst.mockResolvedValue(null);
    extractDocxMock.mockResolvedValue({ text: CONTRATO_LOCACAO, html: "" });
    extractPlainTextMock.mockResolvedValue(CONTRATO_LOCACAO);
    classifyMock.mockResolvedValue({
      kind: "template",
      confidence: 0.9,
      reason: "Estrutura de contrato completo.",
    });
    getOrgModulesMock.mockResolvedValue({
      enabled: { vendas: true, locacao: true },
      features: {},
    });
  });

  it("401 sem sessão", async () => {
    authMock.mockResolvedValue(null);
    expect((await POST(req(docxFile()) as never)).status).toBe(401);
  });

  it("403 para membro comum (só owner/admin ingerem modelos)", async () => {
    membershipFindFirst.mockResolvedValue({ role: "member" });
    expect((await POST(req(docxFile()) as never)).status).toBe(403);
  });

  it("400 sem arquivo", async () => {
    expect((await POST(req() as never)).status).toBe(400);
  });

  it("422 para formato que não é DOCX nem PDF", async () => {
    const file = new File([new Uint8Array([1, 2, 3, 4, 5])], "x.txt");
    const res = await POST(req(file) as never);
    expect(res.status).toBe(422);
  });

  it("422 quando não sai texto suficiente", async () => {
    extractDocxMock.mockResolvedValue({ text: "oi", html: "" });
    expect((await POST(req(docxFile()) as never)).status).toBe(422);
  });

  it("502 quando a extração falha", async () => {
    extractDocxMock.mockRejectedValue(new Error("mammoth explodiu"));
    const res = await POST(req(docxFile()) as never);
    expect(res.status).toBe(502);
    expect((await res.json()).error).toContain("mammoth");
  });

  it("NÃO cria nada — a análise é read-only", async () => {
    await POST(req(docxFile()) as never);
    expect(
      (prisma.contractTemplate.create as unknown as ReturnType<typeof vi.fn>)
    ).not.toHaveBeenCalled();
  });

  it("sugere contrato de locação residencial pro DOCX de locação", async () => {
    const res = await POST(req(docxFile("locacao-fiador.docx")) as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.fileKind).toBe("docx");
    expect(body.suggestion.type).toBe("contrato_locacao");
    expect(body.suggestion.subOption).toBe("residencial");
    expect(body.text).toContain("CLÁUSULA PRIMEIRA");
    expect(body.sourceHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("classificação 'clauses' vira sugestão de cláusulas avulsas", async () => {
    classifyMock.mockResolvedValue({
      kind: "clauses",
      confidence: 0.85,
      reason: "Coleção de cláusulas soltas.",
    });
    const body = await (await POST(req(docxFile()) as never)).json();
    expect(body.suggestion.type).toBe("clausulas");
  });

  it("org só-locação não recebe os tipos de venda", async () => {
    getOrgModulesMock.mockResolvedValue({
      enabled: { vendas: false, locacao: true },
      features: {},
    });
    const body = await (await POST(req(docxFile()) as never)).json();
    const keys = body.docTypes.map((d: { key: string }) => d.key);
    expect(keys).not.toContain("contrato_venda");
    expect(keys).not.toContain("proposta_venda");
    expect(keys).toContain("contrato_locacao");
    expect(keys).toContain("clausulas");
  });

  it("palpite que cai em módulo desligado abre o card SEM tipo escolhido", async () => {
    getOrgModulesMock.mockResolvedValue({
      enabled: { vendas: false, locacao: true },
      features: {},
    });
    extractDocxMock.mockResolvedValue({
      text: [
        "INSTRUMENTO PARTICULAR DE COMPROMISSO DE COMPRA E VENDA",
        "O VENDEDOR compromete-se a vender ao COMPRADOR o imóvel abaixo descrito.",
        "CLÁUSULA PRIMEIRA - DO PREÇO",
        "1.1. O preço certo e ajustado é de R$ 500.000,00, pago à vista.",
        "E por estarem assim justos e contratados, firmam o presente.",
      ].join("\n"),
      html: "",
    });
    const body = await (await POST(req(docxFile("ccv.docx")) as never)).json();
    expect(body.suggestion.type).toBeNull();
    expect(body.suggestion.reason).toContain("não está habilitado");
  });

  it("avisa duplicata sem bloquear (o 409 é da criação)", async () => {
    templateFindFirst.mockResolvedValue({
      id: "t9",
      name: "Locação Residencial",
      status: "active",
      modalidade: "locacao",
    });
    const res = await POST(req(docxFile()) as never);
    expect(res.status).toBe(200);
    expect((await res.json()).duplicate.id).toBe("t9");
  });

  it("PDF é aceito na análise (o aviso 'modelo exige DOCX' é da UI)", async () => {
    const res = await POST(req(pdfFile()) as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.fileKind).toBe("pdf");
    // PDF não participa do dedup de template (não vira modelo).
    expect(body.duplicate).toBeNull();
    expect(extractPlainTextMock).toHaveBeenCalled();
  });
});
