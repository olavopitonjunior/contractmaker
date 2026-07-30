import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "@/lib/db/prisma";
import {
  computeSourceHash,
  findDuplicateTemplate,
  resolveUniqueTemplateName,
  type TemplateDedupDb,
} from "../upload-dedup";

const findFirst = prisma.contractTemplate.findFirst as unknown as ReturnType<typeof vi.fn>;
const findMany = prisma.contractTemplate.findMany as unknown as ReturnType<typeof vi.fn>;

/** `prisma` mockado global (src/__tests__/setup.ts) tipado como o db do dedup. */
const db = prisma as unknown as TemplateDedupDb;

type Row = {
  id: string;
  orgId: string;
  name: string;
  status: string;
  modalidade: string | null;
  sourceHash: string | null;
};

type Where = {
  orgId: string;
  sourceHash?: string;
  status?: { not: string };
  name?: { startsWith: string };
};

/**
 * Estado in-memory: reproduz os dois filtros que o dedup usa (hash + nome)
 * sem tocar em Postgres.
 */
function stubDb(rows: Row[]) {
  findFirst.mockImplementation(async ({ where }: { where: Where }) =>
    rows.find(
      (r) =>
        r.orgId === where.orgId &&
        r.sourceHash === where.sourceHash &&
        (!where.status || r.status !== where.status.not)
    ) ?? null
  );
  findMany.mockImplementation(async ({ where }: { where: Where }) =>
    rows.filter(
      (r) =>
        r.orgId === where.orgId &&
        (!where.status || r.status !== where.status.not) &&
        (!where.name || r.name.startsWith(where.name.startsWith))
    )
  );
}

function row(p: Partial<Row> & { id: string }): Row {
  return {
    orgId: "org1",
    name: `T ${p.id}`,
    status: "draft",
    modalidade: "locacao",
    sourceHash: null,
    ...p,
  };
}

describe("computeSourceHash", () => {
  it("é determinístico e sensível a 1 byte", () => {
    const a = computeSourceHash(Buffer.from("PK\x03\x04 modelo"));
    const b = computeSourceHash(Buffer.from("PK\x03\x04 modelo"));
    const c = computeSourceHash(Buffer.from("PK\x03\x04 modelE"));
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("findDuplicateTemplate", () => {
  beforeEach(() => vi.clearAllMocks());

  it("acha o template não-arquivado com o mesmo hash", async () => {
    stubDb([row({ id: "t1", sourceHash: "abc", name: "Locação padrão" })]);

    const hit = await findDuplicateTemplate(db, "org1", "abc");

    expect(hit?.id).toBe("t1");
    expect(hit?.name).toBe("Locação padrão");
  });

  it("ignora template arquivado (pode reingerir)", async () => {
    stubDb([row({ id: "t1", sourceHash: "abc", status: "archived" })]);

    expect(await findDuplicateTemplate(db, "org1", "abc")).toBeNull();
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: { not: "archived" } }),
      })
    );
  });

  it("não cruza org (hash igual em outro tenant não é duplicata)", async () => {
    stubDb([row({ id: "t1", orgId: "org2", sourceHash: "abc" })]);

    expect(await findDuplicateTemplate(db, "org1", "abc")).toBeNull();
  });

  it("hash vazio nunca casa e nem consulta o banco", async () => {
    stubDb([row({ id: "t1", sourceHash: null })]);

    expect(await findDuplicateTemplate(db, "org1", "")).toBeNull();
    expect(findFirst).not.toHaveBeenCalled();
  });
});

describe("resolveUniqueTemplateName", () => {
  beforeEach(() => vi.clearAllMocks());

  it("nome livre volta intacto", async () => {
    stubDb([]);

    expect(await resolveUniqueTemplateName(db, "org1", "Modelo A")).toBe("Modelo A");
  });

  it("nome ocupado ganha sufixo (2)", async () => {
    stubDb([row({ id: "t1", name: "Modelo A" })]);

    expect(await resolveUniqueTemplateName(db, "org1", "Modelo A")).toBe("Modelo A (2)");
  });

  it("sufixa até achar o primeiro livre", async () => {
    stubDb([
      row({ id: "t1", name: "Modelo A" }),
      row({ id: "t2", name: "Modelo A (2)" }),
      row({ id: "t3", name: "Modelo A (3)" }),
    ]);

    expect(await resolveUniqueTemplateName(db, "org1", "Modelo A")).toBe("Modelo A (4)");
  });

  it("nome de template arquivado é reusável", async () => {
    stubDb([row({ id: "t1", name: "Modelo A", status: "archived" })]);

    expect(await resolveUniqueTemplateName(db, "org1", "Modelo A")).toBe("Modelo A");
  });
});
