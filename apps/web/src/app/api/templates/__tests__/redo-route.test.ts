import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";

/**
 * "Refazer padronização". O que estes casos guardam: só rascunho Google Docs
 * com arquivo no acervo é refeito; o arquivo tem de pertencer à org; o plano
 * do lote é reaproveitado pelo `sourceItemId` do item; `reuse` aponta para a
 * MESMA linha; a recusa do módulo (hash divergente) chega como 409.
 */
const authorizeMock = vi.fn();
const isOwnedMock = vi.fn();
vi.mock("@/lib/ingestion/route-auth", () => ({
  authorizeIngestion: (...a: unknown[]) => authorizeMock(...a),
  isOwnedBlobUrl: (...a: unknown[]) => isOwnedMock(...a),
}));

const ingestMock = vi.fn();
vi.mock("@/lib/templates/ingest-template-from-docx", async () => {
  const actual = await vi.importActual<typeof import("@/lib/templates/ingest-template-from-docx")>(
    "@/lib/templates/ingest-template-from-docx"
  );
  return { ...actual, ingestTemplateFromDocx: (...a: unknown[]) => ingestMock(...a) };
});

vi.mock("@/lib/ingestion/plan-executor", () => ({
  knownProviderLabels: () => ["Porto Seguro"],
  isFilledInstance: (c: unknown) => !!(c as { isFilledInstance?: boolean } | null)?.isFilledInstance,
}));
const sniffMock = vi.fn();
vi.mock("@/lib/ingestion/run-executor", () => ({
  sniffFileKind: (...a: unknown[]) => sniffMock(...a),
}));

const auditMock = vi.fn();
vi.mock("@/lib/security/audit", () => ({
  audit: (...a: unknown[]) => auditMock(...a),
  extractAuditContextFromRequest: (_r: unknown, orgId: string, userId: string) => ({ orgId, userId }),
}));

import { RedoTemplateError } from "@/lib/templates/ingest-template-from-docx";
import { POST } from "../[id]/redo/route";

const templateFindFirst = vi.fn();
const templateFindUnique = vi.fn();
const itemFindFirst = vi.fn();
Object.assign(prisma.contractTemplate, { findFirst: templateFindFirst, findUnique: templateFindUnique });
Object.assign(prisma.ingestionItem, { findFirst: itemFindFirst });

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

const call = () =>
  POST(new Request("http://localhost/x", { method: "POST" }) as never, { params: { id: "tpl1" } });

function template(over: Record<string, unknown> = {}) {
  return {
    id: "tpl1",
    name: "Residencial Caução",
    engine: "google_docs",
    status: "draft",
    modalidade: "locacao",
    sourceHash: "abc",
    googleTemplateDocId: "doc-old",
    matchCriteria: { garantia: "caucao" },
    ...over,
  };
}

const PLAN = {
  version: 1,
  templates: [
    {
      sourceItemId: "item-1",
      name: "Residencial Caução",
      modalidade: "locacao",
      matchCriteria: { garantia: "caucao" },
      slotBlocks: { garantia: ["8.1. A caução…"] },
      rationale: "x",
    },
  ],
  clauses: [],
  discards: [],
  issues: [],
};

function item(over: Record<string, unknown> = {}) {
  return {
    id: "item-1",
    filename: "modelo.docx",
    blobUrl: "https://x.public.blob.vercel-storage.com/ingestion/org-1/modelo.docx",
    text: "texto original",
    classification: { isFilledInstance: true },
    run: { id: "run-1", libraryPlan: PLAN, items: [{ classification: null }] },
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  authorizeMock.mockResolvedValue({ ok: true, actor: { orgId: "org-1", userId: "user-1" } });
  isOwnedMock.mockReturnValue(true);
  templateFindFirst.mockResolvedValue(template());
  templateFindUnique.mockResolvedValue({ draftReport: { redo: { count: 1 } } });
  itemFindFirst.mockResolvedValue(item());
  fetchMock.mockResolvedValue({ ok: true, arrayBuffer: async () => new Uint8Array([0x50, 0x4b, 3, 4]).buffer });
  sniffMock.mockReturnValue("docx");
  ingestMock.mockResolvedValue({
    templateId: "tpl1",
    name: "Residencial Caução",
    docId: "doc-new",
    webViewLink: "http://view",
    embedLink: "http://embed",
    report: {},
    slots: [{ slot: "garantia", applied: true, token: "clausula_garantia" }],
    neutralization: null,
  });
});

describe("POST /api/templates/[id]/redo — perímetro", () => {
  it("devolve a resposta da autorização quando ela recusa", async () => {
    authorizeMock.mockResolvedValue({
      ok: false,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    });
    expect((await call()).status).toBe(401);
    expect(ingestMock).not.toHaveBeenCalled();
  });

  it("409 TEMPLATE_ACTIVE: modelo ativo não é refeito", async () => {
    templateFindFirst.mockResolvedValue(template({ status: "active" }));
    const res = await call();
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("TEMPLATE_ACTIVE");
    expect(ingestMock).not.toHaveBeenCalled();
  });

  it("404 SOURCE_MISSING: sem sourceHash, ou sem item no acervo", async () => {
    templateFindFirst.mockResolvedValue(template({ sourceHash: null }));
    let res = await call();
    expect(res.status).toBe(404);
    expect((await res.json()).code).toBe("SOURCE_MISSING");
    expect(itemFindFirst).not.toHaveBeenCalled();

    templateFindFirst.mockResolvedValue(template());
    itemFindFirst.mockResolvedValue(null);
    res = await call();
    expect(res.status).toBe(404);
    expect((await res.json()).code).toBe("SOURCE_MISSING");
    // A junção é (sourceHash, org do run) — nunca só pelo hash.
    expect(itemFindFirst.mock.calls[0][0].where).toEqual({ sourceHash: "abc", run: { orgId: "org-1" } });
    expect(ingestMock).not.toHaveBeenCalled();
  });

  it("403 para blob que não pertence à org; nada é baixado", async () => {
    isOwnedMock.mockReturnValue(false);
    const res = await call();
    expect(res.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(ingestMock).not.toHaveBeenCalled();
  });

  it("422 quando o arquivo original não é DOCX", async () => {
    sniffMock.mockReturnValue("pdf");
    expect((await call()).status).toBe(422);
    expect(ingestMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/templates/[id]/redo — pipeline", () => {
  it("reaproveita o plano do lote pelo sourceItemId e refaz na MESMA linha", async () => {
    const res = await call();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      ok: true,
      docId: "doc-new",
      embedLink: "http://embed",
      report: { redo: { count: 1 } },
    });

    expect(ingestMock).toHaveBeenCalledTimes(1);
    const arg = ingestMock.mock.calls[0][0];
    expect(arg).toMatchObject({
      orgId: "org-1",
      filename: "modelo.docx",
      modalidade: "locacao",
      name: "Residencial Caução",
      matchCriteria: { garantia: "caucao" },
      slotBlocks: { garantia: ["8.1. A caução…"] },
      neutralizeProviders: ["Porto Seguro"],
      extractGabarito: { userId: "user-1" },
      sourceText: "texto original",
      reuse: { templateId: "tpl1" },
    });
    // Nunca `force`: o redo não é "criar por cima", é reaproveitar.
    expect(arg.force).toBeUndefined();

    const [, entry] = auditMock.mock.calls[0];
    expect(entry).toMatchObject({
      action: "TEMPLATE_REDO",
      result: "SUCCESS",
      resource: "tpl1",
      metadata: { previousDocId: "doc-old", newDocId: "doc-new", runId: "run-1", itemId: "item-1", slotsApplied: ["garantia"] },
    });
  });

  it("item sem plano (lote antigo) ainda refaz — sem slots, sem gabarito quando não é instância", async () => {
    itemFindFirst.mockResolvedValue(
      item({ classification: null, run: { id: "run-1", libraryPlan: null, items: [] } })
    );
    expect((await call()).status).toBe(200);
    const arg = ingestMock.mock.calls[0][0];
    expect(arg.slotBlocks).toEqual({});
    expect(arg.neutralizeProviders).toEqual([]);
    expect(arg.extractGabarito).toBeNull();
  });

  it("falha genérica DEPOIS da troca do Doc → 502 REDO_PARTIAL (a tela sabe que o Doc mudou)", async () => {
    ingestMock.mockRejectedValue(new Error("Drive indisponível na releitura"));
    templateFindUnique.mockResolvedValue({ googleTemplateDocId: "doc-new" });
    const res = await call();
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.code).toBe("REDO_PARTIAL");
    expect(body.error).toContain("Drive indisponível");
    expect(auditMock).not.toHaveBeenCalled();
  });

  it("falha genérica SEM troca do Doc → 502 sem código (nada mudou)", async () => {
    ingestMock.mockRejectedValue(new Error("quota"));
    templateFindUnique.mockResolvedValue({ googleTemplateDocId: "doc-old" });
    const res = await call();
    expect(res.status).toBe(502);
    expect((await res.json()).code).toBeUndefined();
  });

  it("recusa do módulo (hash divergente) chega como 409 SOURCE_MISMATCH, sem audit", async () => {
    ingestMock.mockRejectedValue(new RedoTemplateError("SOURCE_MISMATCH", 409, "não é o mesmo arquivo"));
    const res = await call();
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("SOURCE_MISMATCH");
    expect(auditMock).not.toHaveBeenCalled();
  });
});
