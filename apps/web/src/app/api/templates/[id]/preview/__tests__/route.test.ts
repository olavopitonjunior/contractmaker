import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "../route";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { uploadHtmlAsGoogleDoc } from "@/lib/google/upload-rendered-html";
import { isGoogleDocsFeatureEnabled } from "@/lib/google/client";
import { createMockSession, createMockOrg } from "@/__tests__/helpers";

// O preview handlebars NÃO pode tocar o Google — o mock existe pra provar que
// ninguém o chama (era o `invalid_grant` que matava a tela em staging).
vi.mock("@/lib/google/upload-rendered-html", () => ({
  uploadHtmlAsGoogleDoc: vi.fn(),
}));
vi.mock("@/lib/google/client", () => ({
  isGoogleDocsFeatureEnabled: vi.fn(() => true),
}));

vi.unmock("@/lib/render/handlebars");

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const p = prisma as any;
const mockAuth = vi.mocked(auth);
const mockGetUserOrg = vi.mocked(getUserOrg);
const mockUpload = vi.mocked(uploadHtmlAsGoogleDoc);
const mockFeatureEnabled = vi.mocked(isGoogleDocsFeatureEnabled);

const HANDLEBARS_TEMPLATE = {
  id: "t1",
  orgId: "org-1",
  name: "CCV à vista",
  engine: "handlebars",
  modalidade: "a_vista",
  handlebarsSource: "<h1>CCV</h1><p>{{vendedores.0.nome}}</p>",
  googleTemplateDocId: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue(createMockSession() as never);
  mockGetUserOrg.mockResolvedValue(createMockOrg({ id: "org-1" }) as never);
  mockFeatureEnabled.mockReturnValue(true);
  p.contractTemplate.findUnique = vi.fn().mockResolvedValue(HANDLEBARS_TEMPLATE);
  p.contractTemplate.update = vi.fn();
});

function req(body: unknown = {}) {
  return new NextRequest("http://localhost/api/templates/t1/preview", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

describe("POST /api/templates/[id]/preview — guardas", () => {
  it("401 sem sessão", async () => {
    mockAuth.mockResolvedValue(null as never);
    const res = await POST(req(), { params: { id: "t1" } });
    expect(res.status).toBe(401);
  });

  it("404 pra template de outra org", async () => {
    p.contractTemplate.findUnique = vi
      .fn()
      .mockResolvedValue({ ...HANDLEBARS_TEMPLATE, orgId: "org-2" });
    const res = await POST(req(), { params: { id: "t1" } });
    expect(res.status).toBe(404);
  });
});

describe("POST /api/templates/[id]/preview — handlebars sem Google", () => {
  it("devolve o HTML renderizado e NÃO sobe nada pro Drive", async () => {
    const res = await POST(req(), { params: { id: "t1" } });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.mode).toBe("handlebars");
    expect(json.html).toContain("João Silva Santos");
    expect(json.fixture).toBe("a_vista");
    expect(mockUpload).not.toHaveBeenCalled();
    // Sem doc no Drive não há cache pra gravar.
    expect(p.contractTemplate.update).not.toHaveBeenCalled();
  });

  it("funciona com a integração Google DESLIGADA", async () => {
    // O guard `isGoogleDocsFeatureEnabled` cobria a rota inteira: sem
    // USE_GOOGLE_DOCS_EDITOR o preview handlebars 503ava sem motivo.
    mockFeatureEnabled.mockReturnValue(false);
    const res = await POST(req(), { params: { id: "t1" } });
    expect(res.status).toBe(200);
    expect((await res.json()).mode).toBe("handlebars");
  });

  it("HTML sai sanitizado (sem conteúdo ativo)", async () => {
    p.contractTemplate.findUnique = vi.fn().mockResolvedValue({
      ...HANDLEBARS_TEMPLATE,
      handlebarsSource: "<script>alert(1)</script><p onclick=\"x()\">oi</p>",
    });
    const json = await (await POST(req(), { params: { id: "t1" } })).json();
    expect(json.html).not.toContain("<script");
    expect(json.html).not.toContain("onclick");
  });

  it("respeita a modalidade pedida dentro da família de venda", async () => {
    const json = await (
      await POST(req({ modalidade: "financiamento" }), { params: { id: "t1" } })
    ).json();
    expect(json.fixture).toBe("financiamento");
  });

  it("ignora fixture de venda num template de proposta", async () => {
    p.contractTemplate.findUnique = vi.fn().mockResolvedValue({
      ...HANDLEBARS_TEMPLATE,
      modalidade: "proposta_locacao_residencial",
      handlebarsSource: "<p>{{locatarios.0.nome}} — proposta {{numero_proposta}}</p>",
    });
    const json = await (
      await POST(req({ modalidade: "financiamento" }), { params: { id: "t1" } })
    ).json();
    expect(json.fixture).toBe("proposta_locacao_residencial");
    expect(json.html).toContain("Carlos Eduardo Almeida");
    expect(json.html).toContain("0001");
  });

  it("422 com a mensagem do compilador quando o source é inválido", async () => {
    p.contractTemplate.findUnique = vi
      .fn()
      .mockResolvedValue({ ...HANDLEBARS_TEMPLATE, handlebarsSource: "{{#if x}}sem fim" });
    const res = await POST(req(), { params: { id: "t1" } });
    expect(res.status).toBe(422);
    expect((await res.json()).error).toContain("Falha ao renderizar Handlebars");
  });
});

describe("POST /api/templates/[id]/preview — engine google_docs", () => {
  const GDOC = {
    ...HANDLEBARS_TEMPLATE,
    engine: "google_docs",
    googleTemplateDocId: "doc-123",
  };

  it("devolve a URL de embed do doc-fonte", async () => {
    p.contractTemplate.findUnique = vi.fn().mockResolvedValue(GDOC);
    const json = await (await POST(req(), { params: { id: "t1" } })).json();
    expect(json.mode).toBe("google_docs");
    expect(json.embedUrl).toContain("doc-123");
    expect(mockUpload).not.toHaveBeenCalled();
  });

  it("503 quando a integração está desligada", async () => {
    p.contractTemplate.findUnique = vi.fn().mockResolvedValue(GDOC);
    mockFeatureEnabled.mockReturnValue(false);
    const res = await POST(req(), { params: { id: "t1" } });
    expect(res.status).toBe(503);
  });

  it("400 quando não há doc associado", async () => {
    p.contractTemplate.findUnique = vi
      .fn()
      .mockResolvedValue({ ...GDOC, googleTemplateDocId: null });
    const res = await POST(req(), { params: { id: "t1" } });
    expect(res.status).toBe(400);
  });
});
