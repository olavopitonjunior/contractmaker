import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { GET, PATCH, DELETE } from "../route";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { createMockSession, createMockOrg } from "@/__tests__/helpers";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const p = prisma as any;
const mockAuth = vi.mocked(auth);
const mockGetUserOrg = vi.mocked(getUserOrg);

const TEMPLATE = {
  id: "t1",
  orgId: "org-1",
  name: "CCV à vista",
  handlebarsSource: "<p>texto proprietário</p>",
  modalidade: "a_vista",
  category: "a_vista",
  matchCriteria: null,
  schemaType: "compra_venda_v1",
  isDefault: false,
  status: "active",
  engine: "handlebars",
  version: "1.0.0",
  description: null,
  googleTemplateDocId: null,
  _count: { contracts: 0 },
};

/**
 * O guard vive no `where` da query, então o mock do Prisma HONRA o filtro —
 * é exatamente isso que está sob teste. Um mock que devolvesse a row
 * independente do `where` passaria mesmo com a rota vulnerável.
 */
function findFirstHonoringWhere(row: Record<string, unknown> | null = TEMPLATE) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return vi.fn(async (args: any) => {
    if (!row) return null;
    const { id, orgId } = args?.where ?? {};
    if (id !== row.id) return null;
    // Rota vulnerável não manda orgId no where — o mock trata como "sem escopo".
    if (orgId === undefined || orgId !== row.orgId) return null;
    return row;
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue(createMockSession() as never);
  mockGetUserOrg.mockResolvedValue(createMockOrg() as never);
  // Mutação in place: o mock global é compartilhado (e o `$transaction` entrega
  // a mesma instância como `tx`).
  p.contractTemplate.findFirst = findFirstHonoringWhere();
  p.contractTemplate.findUnique = vi.fn().mockResolvedValue(TEMPLATE);
  p.contractTemplate.update = vi.fn().mockResolvedValue(TEMPLATE);
  p.contractTemplate.updateMany = vi.fn().mockResolvedValue({ count: 0 });
  p.contractTemplate.delete = vi.fn().mockResolvedValue(TEMPLATE);
});

function req(body?: unknown) {
  return new NextRequest("http://localhost/api/templates/t1", {
    method: body ? "PATCH" : "GET",
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

describe("GET /api/templates/[id]", () => {
  it("401 sem sessão", async () => {
    mockAuth.mockResolvedValue(null as never);
    const res = await GET(req(), { params: { id: "t1" } });
    expect(res.status).toBe(401);
  });

  it("200 pro template da própria org", async () => {
    const res = await GET(req(), { params: { id: "t1" } });
    expect(res.status).toBe(200);
    expect((await res.json()).handlebarsSource).toBe("<p>texto proprietário</p>");
  });

  it("404 cross-org — não vaza o handlebarsSource de outro tenant", async () => {
    mockGetUserOrg.mockResolvedValue({ ...createMockOrg(), id: "org-2" } as never);
    const res = await GET(req(), { params: { id: "t1" } });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.handlebarsSource).toBeUndefined();
    // Mesmo corpo do inexistente — não confirma existência.
    expect(body).toEqual({ error: "Template not found" });
  });

  it("404 (mesmo corpo) quando o template não existe", async () => {
    p.contractTemplate.findFirst = findFirstHonoringWhere(null);
    const res = await GET(req(), { params: { id: "t1" } });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Template not found" });
  });

  it("404 quando o usuário não tem org", async () => {
    mockGetUserOrg.mockResolvedValue(null as never);
    const res = await GET(req(), { params: { id: "t1" } });
    expect(res.status).toBe(404);
  });
});

describe("PATCH /api/templates/[id]", () => {
  it("404 cross-org SEM escrever nada", async () => {
    mockGetUserOrg.mockResolvedValue({ ...createMockOrg(), id: "org-2" } as never);
    const res = await PATCH(req({ handlebarsSource: "<p>invadido</p>" }), {
      params: { id: "t1" },
    });
    expect(res.status).toBe(404);
    expect(p.contractTemplate.update).not.toHaveBeenCalled();
    expect(p.contractTemplate.updateMany).not.toHaveBeenCalled();
  });

  it("200 e grava quando é da própria org", async () => {
    const res = await PATCH(req({ name: "Novo nome" }), { params: { id: "t1" } });
    expect(res.status).toBe(200);
    expect(p.contractTemplate.update).toHaveBeenCalledTimes(1);
    expect(p.contractTemplate.update.mock.calls[0][0].data.name).toBe("Novo nome");
  });

  /**
   * Trocar a família pra "venda" na tela de edição. `category` sozinha NÃO move
   * entre famílias (o guard de `resolveTemplateTaxonomy` protege o template de
   * locação que a tela sempre manda categoria); é a modalidade explícita que
   * autoriza. O editor manda os dois — este é o contrato que ele depende.
   */
  it("categoria + modalidade explícita move proposta → venda", async () => {
    p.contractTemplate.findFirst = findFirstHonoringWhere({
      ...TEMPLATE,
      modalidade: "proposta_locacao_residencial",
      category: null,
      matchCriteria: { garantia: "fiador" },
      schemaType: "locacao_residencial_v1",
    });

    const res = await PATCH(
      req({ category: "financiamento", modalidade: "financiamento" }),
      { params: { id: "t1" } }
    );

    expect(res.status).toBe(200);
    const data = p.contractTemplate.update.mock.calls[0][0].data;
    expect(data.modalidade).toBe("financiamento");
    expect(data.category).toBe("financiamento");
    // Em venda quem discrimina é a categoria — o critério de variante é limpo,
    // e o schemaType acompanha a modalidade nova.
    expect(data.schemaType).toBe("compra_venda_v2");
    expect(data.matchCriteria).toBe(Prisma.DbNull);
  });

  it("só `category` (sem modalidade) NÃO tira o template de proposta — guard do resolver", async () => {
    p.contractTemplate.findFirst = findFirstHonoringWhere({
      ...TEMPLATE,
      modalidade: "proposta_locacao_residencial",
      category: null,
    });

    await PATCH(req({ category: "financiamento" }), { params: { id: "t1" } });

    const data = p.contractTemplate.update.mock.calls[0][0].data;
    expect(data.modalidade).toBe("proposta_locacao_residencial");
    expect(data.category).toBeNull();
  });
});

/**
 * Ativar um modelo com espaço de cláusula sem cláusula aprovada no acervo é a
 * falha SILENCIOSA deste fluxo: o contrato sai com o texto canônico da
 * plataforma no lugar da redação da imobiliária, e o documento fica plausível.
 * A trava mora no servidor porque é por aqui que passam TODOS os caminhos de
 * ativação (a tela de revisão e a listagem).
 */
describe("PATCH /api/templates/[id] — trava da ativação com slot", () => {
  const COM_SLOT = {
    ...TEMPLATE,
    status: "draft",
    modalidade: "locacao",
    category: null,
    matchCriteria: { garantia: "seguro_fianca" },
    handlebarsSource:
      "<!-- engine=google_docs -->\n<!-- slots: {{slot_garantia}} -->",
  };

  beforeEach(() => {
    p.contractTemplate.findFirst = findFirstHonoringWhere(COM_SLOT);
    p.knowledgeItem.findMany = vi.fn().mockResolvedValue([]);
  });

  it("409 quando o acervo não tem cláusula aprovada pro slot", async () => {
    const res = await PATCH(req({ status: "active" }), { params: { id: "t1" } });

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe("SLOT_CLAUSE_MISSING");
    expect(body.error).toContain("texto padrão da plataforma");
    expect(body.gaps[0].slot).toBe("garantia");
    expect(p.contractTemplate.update).not.toHaveBeenCalled();
  });

  it("procura a cláusula NO ACERVO DA ORG e pela garantia do modelo", async () => {
    await PATCH(req({ status: "active" }), { params: { id: "t1" } });

    const where = p.knowledgeItem.findMany.mock.calls[0][0].where;
    expect(where.orgId).toBe("org-1");
    expect(where.status).toBe("approved");
    expect(where.parentId).toBeNull();
    expect(where.tags.hasEvery).toEqual([
      "slot:garantia",
      "garantia:seguro_fianca",
    ]);
  });

  it("ativa quando existe cláusula aprovada do tenant", async () => {
    p.knowledgeItem.findMany = vi.fn().mockResolvedValue([{ id: "kb-1" }]);

    const res = await PATCH(req({ status: "active" }), { params: { id: "t1" } });

    expect(res.status).toBe(200);
    expect(p.contractTemplate.update.mock.calls[0][0].data.status).toBe("active");
  });

  it("`forceActivate` é a saída consciente — o texto padrão é legítimo", async () => {
    const res = await PATCH(req({ status: "active", forceActivate: true }), {
      params: { id: "t1" },
    });

    expect(res.status).toBe(200);
    expect(p.knowledgeItem.findMany).not.toHaveBeenCalled();
    expect(p.contractTemplate.update.mock.calls[0][0].data.status).toBe("active");
  });

  it("modelo SEM slot ativa sem consultar o acervo", async () => {
    p.contractTemplate.findFirst = findFirstHonoringWhere({
      ...COM_SLOT,
      handlebarsSource: "<p>modelo comum</p>",
    });

    const res = await PATCH(req({ status: "active" }), { params: { id: "t1" } });

    expect(res.status).toBe(200);
    expect(p.knowledgeItem.findMany).not.toHaveBeenCalled();
  });

  it("PATCH que não ativa (renomear, arquivar) não passa pela trava", async () => {
    const renomeia = await PATCH(req({ name: "Outro nome" }), { params: { id: "t1" } });
    expect(renomeia.status).toBe(200);

    const arquiva = await PATCH(req({ status: "archived" }), { params: { id: "t1" } });
    expect(arquiva.status).toBe(200);
    expect(p.knowledgeItem.findMany).not.toHaveBeenCalled();
  });

  it("modelo JÁ ativo não é retravado por um PATCH qualquer", async () => {
    p.contractTemplate.findFirst = findFirstHonoringWhere({
      ...COM_SLOT,
      status: "active",
    });

    const res = await PATCH(req({ status: "active", isDefault: true }), {
      params: { id: "t1" },
    });

    expect(res.status).toBe(200);
    expect(p.knowledgeItem.findMany).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/templates/[id]", () => {
  it("404 cross-org sem apagar nem arquivar", async () => {
    mockGetUserOrg.mockResolvedValue({ ...createMockOrg(), id: "org-2" } as never);
    const res = await DELETE(req(), { params: { id: "t1" } });
    expect(res.status).toBe(404);
    expect(p.contractTemplate.delete).not.toHaveBeenCalled();
    expect(p.contractTemplate.update).not.toHaveBeenCalled();
  });

  it("apaga o template da própria org sem contratos", async () => {
    const res = await DELETE(req(), { params: { id: "t1" } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "deleted" });
    expect(p.contractTemplate.delete).toHaveBeenCalledTimes(1);
  });

  it("arquiva (não apaga) quando já há contratos gerados", async () => {
    p.contractTemplate.findFirst = findFirstHonoringWhere({
      ...TEMPLATE,
      _count: { contracts: 3 },
    });
    const res = await DELETE(req(), { params: { id: "t1" } });
    expect(await res.json()).toEqual({ status: "archived" });
    expect(p.contractTemplate.delete).not.toHaveBeenCalled();
    expect(p.contractTemplate.update.mock.calls[0][0].data.status).toBe("archived");
  });
});
