import { describe, it, expect, vi, beforeEach } from "vitest";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";

/**
 * A rota devolve o texto CRU do contrato que deu origem ao modelo — dado
 * pessoal de locador e locatário incluído. O que estes casos guardam é o
 * perímetro (quem lê) e a junção (de QUAL tenant o texto vem): o hash do
 * arquivo é o mesmo em qualquer org que tenha ingerido o mesmo modelo de
 * mercado, e sem o `run.orgId` no where a rota serviria o contrato alheio.
 */
import { GET } from "../[id]/source-text/route";

const authMock = auth as unknown as ReturnType<typeof vi.fn>;
const getUserOrgMock = getUserOrg as unknown as ReturnType<typeof vi.fn>;
const templateFindFirst = vi.fn();
const membershipFindFirst = vi.fn();
const itemFindFirst = vi.fn();
Object.assign(prisma.contractTemplate, { findFirst: templateFindFirst });
Object.assign(prisma.orgMembership, { findFirst: membershipFindFirst });
Object.assign(prisma.ingestionItem, { findFirst: itemFindFirst });

const call = () =>
  GET(new Request("http://localhost/x") as never, { params: { id: "tpl1" } });

beforeEach(() => {
  vi.clearAllMocks();
  authMock.mockResolvedValue({ user: { id: "u1" } });
  getUserOrgMock.mockResolvedValue({ id: "org1" });
  membershipFindFirst.mockResolvedValue({ role: "admin" });
  templateFindFirst.mockResolvedValue({ engine: "google_docs", sourceHash: "abc" });
  itemFindFirst.mockResolvedValue({
    id: "item1",
    runId: "run1",
    text: "CLÁUSULA 1\n\nLOCADOR: João da Silva, CPF 123.456.789-00.\n  \nCLÁUSULA 2",
  });
});

describe("GET /api/templates/[id]/source-text — perímetro", () => {
  it("401 sem sessão; nada é consultado", async () => {
    authMock.mockResolvedValue(null);
    expect((await call()).status).toBe(401);
    expect(itemFindFirst).not.toHaveBeenCalled();
  });

  it("403 para member (mesmo papel que lê o Doc inteiro em doc-text)", async () => {
    membershipFindFirst.mockResolvedValue({ role: "member" });
    expect((await call()).status).toBe(403);
    expect(itemFindFirst).not.toHaveBeenCalled();
  });

  it("404 para template de outro tenant (o escopo está na query)", async () => {
    templateFindFirst.mockResolvedValue(null);
    expect((await call()).status).toBe(404);
    expect(templateFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "tpl1", orgId: "org1" } })
    );
    expect(itemFindFirst).not.toHaveBeenCalled();
  });

  it("400 para modelo Handlebars (não há Doc para alinhar)", async () => {
    templateFindFirst.mockResolvedValue({ engine: "handlebars", sourceHash: "abc" });
    expect((await call()).status).toBe(400);
  });
});

describe("GET /api/templates/[id]/source-text — junção", () => {
  it("devolve os parágrafos pelo divisor compartilhado, com item e run", async () => {
    const res = await call();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      available: true,
      paragraphs: ["CLÁUSULA 1", "LOCADOR: João da Silva, CPF 123.456.789-00.", "CLÁUSULA 2"],
      itemId: "item1",
      runId: "run1",
    });
  });

  it("procura o item pelo hash E pela org do run, o mais recente primeiro", async () => {
    await call();
    expect(itemFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { sourceHash: "abc", run: { orgId: "org1" } },
        orderBy: { createdAt: "desc" },
      })
    );
  });

  it("modelo sem sourceHash → available:false sem consultar o lote", async () => {
    templateFindFirst.mockResolvedValue({ engine: "google_docs", sourceHash: null });
    const res = await call();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ available: false, paragraphs: [] });
    expect(itemFindFirst).not.toHaveBeenCalled();
  });

  it("upload direto sem lote (nenhum item) → available:false", async () => {
    itemFindFirst.mockResolvedValue(null);
    expect(await (await call()).json()).toEqual({ available: false, paragraphs: [] });
  });

  it("item sem texto extraído → available:false (não confunde vazio com 'igual')", async () => {
    itemFindFirst.mockResolvedValue({ id: "item1", runId: "run1", text: null });
    expect(await (await call()).json()).toEqual({ available: false, paragraphs: [] });
  });
});
