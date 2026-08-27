import { describe, it, expect, vi, beforeEach } from "vitest";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { FEATURE } from "@/lib/modules/catalog";

vi.mock("@/lib/auth/impersonation", () => ({
  getEffectiveUserId: vi.fn(async (id: string) => id),
}));
vi.mock("@vercel/functions", () => ({ waitUntil: vi.fn() }));

const chainAdvanceMock = vi.fn(async () => ({ scheduled: true }));
vi.mock("@/lib/ingestion/chain", async () => {
  const actual = await vi.importActual<typeof import("@/lib/ingestion/chain")>(
    "@/lib/ingestion/chain"
  );
  return { ...actual, chainAdvance: (...args: unknown[]) => chainAdvanceMock(...args) };
});

const getOrgModulesMock = vi.fn();
vi.mock("@/lib/modules/read", async () => {
  const actual = await vi.importActual<typeof import("@/lib/modules/read")>(
    "@/lib/modules/read"
  );
  return { ...actual, getOrgModules: (...args: unknown[]) => getOrgModulesMock(...args) };
});

import { POST } from "../runs/[id]/items/route";

const authMock = auth as unknown as ReturnType<typeof vi.fn>;
const getUserOrgMock = getUserOrg as unknown as ReturnType<typeof vi.fn>;
const membershipFindFirst = prisma.orgMembership.findFirst as unknown as ReturnType<
  typeof vi.fn
>;
const runFindFirst = prisma.ingestionRun.findFirst as unknown as ReturnType<typeof vi.fn>;
const runUpdateMany = prisma.ingestionRun.updateMany as unknown as ReturnType<
  typeof vi.fn
>;
const itemFindFirst = prisma.ingestionItem.findFirst as unknown as ReturnType<
  typeof vi.fn
>;
const itemUpdate = prisma.ingestionItem.update as unknown as ReturnType<typeof vi.fn>;
const itemCreateMany = prisma.ingestionItem.createMany as unknown as ReturnType<
  typeof vi.fn
>;
const itemCount = prisma.ingestionItem.count as unknown as ReturnType<typeof vi.fn>;
const templateFindMany = prisma.contractTemplate.findMany as unknown as ReturnType<
  typeof vi.fn
>;

const HASH = "a".repeat(64);
const BLOB = "https://store.public.blob.vercel-storage.com";

function file(overrides: Record<string, unknown> = {}) {
  return {
    filename: "minuta-em-branco.docx",
    fileKind: "docx",
    blobUrl: `${BLOB}/ingestion/org-1/minuta-em-branco.docx`,
    sourceHash: HASH,
    ...overrides,
  };
}

function req(body: unknown): Request {
  return new Request("http://localhost/api/templates/ingest/runs/run-1/items", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const call = (body: unknown) => POST(req(body) as never, { params: { id: "run-1" } });

beforeEach(() => {
  vi.clearAllMocks();
  authMock.mockResolvedValue({ user: { id: "user-1" } });
  getUserOrgMock.mockResolvedValue({ id: "org-1" });
  membershipFindFirst.mockResolvedValue({ role: "owner" });
  getOrgModulesMock.mockResolvedValue({
    enabled: { vendas: false, locacao: true },
    features: { [FEATURE.LOCACAO_INGESTAO_ACERVO]: true },
  });
  runFindFirst.mockResolvedValue({
    id: "run-1",
    status: "awaiting_review",
    report: { planning: {}, grouping: {}, planningComments: ["x"] },
  });
  runUpdateMany.mockResolvedValue({ count: 1 });
  itemFindFirst.mockResolvedValue({ id: "item-velho" });
  itemCount.mockResolvedValue(21);
  templateFindMany.mockResolvedValue([]);
});

describe("POST /runs/[id]/items — reanexar na revisão", () => {
  it("anexa, invalida grouping/planning e devolve o run para extracting", async () => {
    const res = await call({ files: [file()] });
    expect(res.status).toBe(200);

    expect(itemCreateMany).toHaveBeenCalledTimes(1);
    const [{ data }] = runUpdateMany.mock.calls[0];
    expect(data.status).toBe("extracting");
    expect(data.itemsTotal).toBe(21);
    // O plano anterior foi computado sobre um lote que deixou de existir.
    expect(data.report.planning).toBeUndefined();
    expect(data.report.grouping).toBeUndefined();
    expect(data.report.planningComments).toBeUndefined();
    expect(chainAdvanceMock).toHaveBeenCalled();
  });

  it("substituir marca o item antigo como descarte do OPERADOR, com o motivo", async () => {
    await call({ files: [file()], replaceItemId: "item-velho" });
    const [{ where, data }] = itemUpdate.mock.calls[0];
    expect(where.id).toBe("item-velho");
    expect(data.status).toBe("discarded");
    expect(data.classification.via).toBe("operator");
    expect(data.classification.reason).toContain("minuta-em-branco.docx");
  });

  it("substituir item que não é do lote é 404", async () => {
    itemFindFirst.mockResolvedValue(null);
    const res = await call({ files: [file()], replaceItemId: "de-outro-run" });
    expect(res.status).toBe(404);
    expect(itemCreateMany).not.toHaveBeenCalled();
  });

  it("dedup do intake vale igual: arquivo que já é template nasce descartado", async () => {
    templateFindMany.mockResolvedValue([
      { id: "tpl-1", name: "Modelo existente", sourceHash: HASH },
    ]);
    const res = await call({ files: [file()] });
    const body = await res.json();
    expect(body.duplicates).toEqual(["minuta-em-branco.docx"]);
    const [{ data }] = itemCreateMany.mock.calls[0];
    expect(data[0].status).toBe("discarded");
    expect(data[0].classification.via).toBe("intake");
  });

  it("blob de outra imobiliária é 403", async () => {
    const res = await call({
      files: [file({ blobUrl: `${BLOB}/ingestion/org-2/roubado.docx` })],
    });
    expect(res.status).toBe(403);
  });

  it("execução já iniciada recusa com instrução de lote novo", async () => {
    runFindFirst.mockResolvedValue({
      id: "run-1",
      status: "awaiting_review",
      report: { execution: {} },
    });
    const res = await call({ files: [file()] });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain("lote novo");
  });
});
