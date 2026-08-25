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

import { POST } from "../runs/route";

const authMock = auth as unknown as ReturnType<typeof vi.fn>;
const getUserOrgMock = getUserOrg as unknown as ReturnType<typeof vi.fn>;
const membershipFindFirst = prisma.orgMembership.findFirst as unknown as ReturnType<
  typeof vi.fn
>;
const templateFindMany = prisma.contractTemplate.findMany as unknown as ReturnType<
  typeof vi.fn
>;
const runCreate = prisma.ingestionRun.create as unknown as ReturnType<typeof vi.fn>;

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const BLOB = "https://store.public.blob.vercel-storage.com";

function file(overrides: Record<string, unknown> = {}) {
  return {
    filename: "locacao.docx",
    blobUrl: `${BLOB}/ingestion/org-1/locacao.docx`,
    fileKind: "docx",
    sourceHash: HASH_A,
    size: 12_345,
    ...overrides,
  };
}

function req(body: unknown): Request {
  return new Request("http://localhost/api/templates/ingest/runs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** Visão de módulos com a ingestão ligada só na locação. */
function modulesWithIngestion(enabled = true) {
  return {
    enabled: { vendas: false, locacao: true },
    features: {
      [FEATURE.LOCACAO_INGESTAO_ACERVO]: enabled,
      [FEATURE.VENDAS_INGESTAO_ACERVO]: false,
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  authMock.mockResolvedValue({ user: { id: "user-1" } });
  getUserOrgMock.mockResolvedValue({ id: "org-1" });
  membershipFindFirst.mockResolvedValue({ role: "owner" });
  getOrgModulesMock.mockResolvedValue(modulesWithIngestion());
  templateFindMany.mockResolvedValue([]);
  runCreate.mockImplementation(async () => ({
    id: "run-1",
    status: "queued",
    itemsTotal: 1,
  }));
});

describe("POST /api/templates/ingest/runs — porta de entrada", () => {
  it("401 sem sessão", async () => {
    authMock.mockResolvedValue(null);
    const res = await POST(req({ files: [file()] }) as never);
    expect(res.status).toBe(401);
  });

  it("403 para quem não é owner/admin", async () => {
    membershipFindFirst.mockResolvedValue({ role: "corretor" });
    const res = await POST(req({ files: [file()] }) as never);
    expect(res.status).toBe(403);
    expect(runCreate).not.toHaveBeenCalled();
  });

  it("403 quando a feature de ingestão está desligada", async () => {
    getOrgModulesMock.mockResolvedValue(modulesWithIngestion(false));
    const res = await POST(req({ files: [file()] }) as never);
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("INGESTION_DISABLED");
  });

  it("400 com payload inválido", async () => {
    const res = await POST(req({ files: [] }) as never);
    expect(res.status).toBe(400);
  });

  it("400 quando o sourceHash não é SHA-256 hex", async () => {
    const res = await POST(req({ files: [file({ sourceHash: "nope" })] }) as never);
    expect(res.status).toBe(400);
  });

  it("403 para blob fora do espaço da imobiliária", async () => {
    const res = await POST(
      req({
        files: [file({ blobUrl: `${BLOB}/ingestion/org-2/roubado.docx` })],
      }) as never
    );
    expect(res.status).toBe(403);
    expect(runCreate).not.toHaveBeenCalled();
  });

  it("403 para host que não é o Vercel Blob (SSRF)", async () => {
    const res = await POST(
      req({
        files: [file({ blobUrl: "https://evil.example.com/ingestion/org-1/x.docx" })],
      }) as never
    );
    expect(res.status).toBe(403);
  });
});

describe("POST /api/templates/ingest/runs — criação do lote", () => {
  it("cria o run com um item por arquivo, todos pendentes", async () => {
    const res = await POST(
      req({
        files: [file(), file({ filename: "venda.docx", sourceHash: HASH_B })],
      }) as never
    );
    expect(res.status).toBe(201);

    const data = runCreate.mock.calls[0][0].data;
    expect(data.orgId).toBe("org-1");
    expect(data.trigger).toBe("central");
    expect(data.status).toBe("queued");
    expect(data.itemsTotal).toBe(2);
    expect(data.items.create).toHaveLength(2);
    expect(data.items.create.every((i: { status: string }) => i.status === "pending")).toBe(
      true
    );
  });

  it("aceita o gatilho de onboarding", async () => {
    await POST(req({ trigger: "onboarding", files: [file()] }) as never);
    expect(runCreate.mock.calls[0][0].data.trigger).toBe("onboarding");
  });

  it("dispara a primeira fatia fora do request", async () => {
    await POST(req({ files: [file()] }) as never);
    expect(chainAdvanceMock).toHaveBeenCalledWith("http://localhost", "run-1");
  });
});

describe("POST /api/templates/ingest/runs — dedup por sourceHash", () => {
  it("arquivo já importado nasce como DESCARTE SUGERIDO, não erro", async () => {
    templateFindMany.mockResolvedValue([
      { id: "tpl-1", name: "Locação residencial padrão", sourceHash: HASH_A },
    ]);

    const res = await POST(
      req({
        files: [file(), file({ filename: "novo.docx", sourceHash: HASH_B })],
      }) as never
    );
    expect(res.status).toBe(201);

    const created = runCreate.mock.calls[0][0].data.items.create;
    expect(created[0].status).toBe("discarded");
    expect(created[0].classification.duplicate).toEqual({
      reason: "duplicate_source_hash",
      templateId: "tpl-1",
      templateName: "Locação residencial padrão",
    });
    // O outro segue o caminho normal — o descarte é por arquivo, não por lote.
    expect(created[1].status).toBe("pending");
    expect(created[1].classification).toBeUndefined();

    expect(await res.json()).toMatchObject({ duplicates: ["locacao.docx"] });
  });

  it("consulta o dedup escopado na org e ignorando arquivados", async () => {
    await POST(req({ files: [file()] }) as never);
    expect(templateFindMany.mock.calls[0][0].where).toEqual({
      orgId: "org-1",
      sourceHash: { in: [HASH_A] },
      status: { not: "archived" },
    });
  });

  it("template de OUTRA org com o mesmo hash não marca descarte", async () => {
    // A consulta é escopada por orgId, então a linha de outra org nem volta.
    templateFindMany.mockResolvedValue([]);
    await POST(req({ files: [file()] }) as never);
    expect(runCreate.mock.calls[0][0].data.items.create[0].status).toBe("pending");
  });

  it("hashes repetidos no mesmo lote viram uma consulta só", async () => {
    await POST(
      req({ files: [file(), file({ filename: "copia.docx" })] }) as never
    );
    expect(templateFindMany.mock.calls[0][0].where.sourceHash.in).toEqual([HASH_A]);
  });
});
