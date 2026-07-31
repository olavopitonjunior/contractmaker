import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { prisma } from "@/lib/db/prisma";
import {
  seedCanonicalTemplatesForOrg,
  loadEmbeddedCanonicalSource,
} from "../canonical-seed";
import {
  CANONICAL_TEMPLATES,
  canonicalModalidadesForModules,
} from "../canonical-templates";
import { CANONICAL_TEMPLATE_SOURCES } from "../canonical-sources.generated";

const findFirst = prisma.contractTemplate.findFirst as unknown as ReturnType<typeof vi.fn>;
const create = prisma.contractTemplate.create as unknown as ReturnType<typeof vi.fn>;

/** Loader fake — os testes de seed não precisam de filesystem nem do bundle. */
const fakeLoader = vi.fn((t: { filename: string }) => `-- fonte de ${t.filename} --`);

/**
 * Estado in-memory do banco por (orgId, modalidade): reproduz o exists-check
 * e a idempotência sem tocar em Postgres.
 */
function stubDb(seedRows: Array<{ modalidade: string; engine?: string; status?: string }> = []) {
  const rows = seedRows.map((r, i) => ({ id: `pre-${i}`, ...r }));
  findFirst.mockImplementation(async (args: { where: { modalidade: string } }) => {
    const hit = rows.find((r) => r.modalidade === args.where.modalidade);
    return hit ? { id: hit.id } : null;
  });
  create.mockImplementation(async (args: { data: { modalidade: string } }) => {
    rows.push({ id: `new-${rows.length}`, modalidade: args.data.modalidade });
    return { id: `new-${rows.length}` };
  });
  return rows;
}

describe("seedCanonicalTemplatesForOrg", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fakeLoader.mockImplementation((t: { filename: string }) => `-- fonte de ${t.filename} --`);
  });

  it("org sem nenhum template → cria as 8 modalidades canônicas", async () => {
    stubDb();

    const { created, skipped } = await seedCanonicalTemplatesForOrg("org1", {
      loadSource: fakeLoader,
    });

    expect(created).toHaveLength(8);
    expect(skipped).toEqual([]);
    expect(created).toEqual(CANONICAL_TEMPLATES.map((t) => t.modalidade));
    expect(create).toHaveBeenCalledTimes(8);
  });

  it("row criada é o canônico ativo e default da modalidade", async () => {
    stubDb();

    await seedCanonicalTemplatesForOrg("org1", { loadSource: fakeLoader });

    const aVista = create.mock.calls
      .map((c) => (c[0] as { data: Record<string, unknown> }).data)
      .find((d) => d.modalidade === "a_vista");
    expect(aVista).toMatchObject({
      orgId: "org1",
      name: "CCV - Pagamento À Vista",
      modalidade: "a_vista",
      isDefault: true,
      status: "active",
      engine: "handlebars",
      version: "2.0.0",
      schemaType: "compra_venda_v2",
      handlebarsSource: "-- fonte de ccv_a_vista_v2.hbs --",
    });

    // Locação usa o schemaType próprio (não o default de venda).
    const locacao = create.mock.calls
      .map((c) => (c[0] as { data: Record<string, unknown> }).data)
      .find((d) => d.modalidade === "locacao");
    expect(locacao).toMatchObject({ schemaType: "locacao_residencial_v1" });
  });

  it("modalidade com template google_docs do tenant é PULADA (guard multitenant)", async () => {
    stubDb([{ modalidade: "locacao", engine: "google_docs", status: "active" }]);

    const { created, skipped } = await seedCanonicalTemplatesForOrg("org1", {
      loadSource: fakeLoader,
    });

    expect(skipped).toEqual(["locacao"]);
    expect(created).toHaveLength(7);
    expect(created).not.toContain("locacao");
    // Nenhum create tocou a modalidade do modelo do tenant.
    expect(
      create.mock.calls.map((c) => (c[0] as { data: { modalidade: string } }).data.modalidade)
    ).not.toContain("locacao");
  });

  it("template ARQUIVADO da modalidade também pula (não ressuscita o que o tenant desativou)", async () => {
    stubDb([{ modalidade: "a_vista", engine: "handlebars", status: "archived" }]);

    const { created, skipped } = await seedCanonicalTemplatesForOrg("org1", {
      loadSource: fakeLoader,
    });

    expect(skipped).toEqual(["a_vista"]);
    expect(created).toHaveLength(7);
  });

  it("idempotente: 2ª chamada não cria nada", async () => {
    stubDb();

    const first = await seedCanonicalTemplatesForOrg("org1", { loadSource: fakeLoader });
    expect(first.created).toHaveLength(8);

    create.mockClear();
    const second = await seedCanonicalTemplatesForOrg("org1", { loadSource: fakeLoader });

    expect(second.created).toEqual([]);
    expect(second.skipped).toHaveLength(8);
    expect(create).not.toHaveBeenCalled();
  });

  it("dryRun não escreve nem lê a fonte", async () => {
    stubDb();

    const { created } = await seedCanonicalTemplatesForOrg("org1", {
      loadSource: fakeLoader,
      dryRun: true,
    });

    expect(created).toHaveLength(8);
    expect(create).not.toHaveBeenCalled();
    expect(fakeLoader).not.toHaveBeenCalled();
  });

  it("onlyModalidades restringe o seed", async () => {
    stubDb();

    const { created } = await seedCanonicalTemplatesForOrg("org1", {
      loadSource: fakeLoader,
      onlyModalidades: ["a_vista", "financiamento"],
    });

    expect(created).toEqual(["a_vista", "financiamento"]);
  });

  it("escopo por org: o exists-check consulta orgId + modalidade", async () => {
    stubDb();

    await seedCanonicalTemplatesForOrg("org-xyz", {
      loadSource: fakeLoader,
      onlyModalidades: ["a_vista"],
    });

    expect(findFirst).toHaveBeenCalledWith({
      where: { orgId: "org-xyz", modalidade: "a_vista" },
      select: { id: true },
    });
  });
});

describe("canonicalModalidadesForModules", () => {
  it("só-locação não inclui nenhuma modalidade de venda", () => {
    const only = canonicalModalidadesForModules(["locacao"]);
    expect(only).toEqual([
      "locacao",
      "locacao_comercial",
      "administracao_locacao",
      "proposta_locacao_residencial",
      "proposta_locacao_comercial",
    ]);
  });

  it("só-vendas cobre à vista, financiamento e proposta de compra", () => {
    expect(canonicalModalidadesForModules(["vendas"])).toEqual([
      "a_vista",
      "financiamento",
      "proposta_venda",
    ]);
  });

  it("os dois módulos cobrem o catálogo inteiro (nenhuma modalidade órfã)", () => {
    expect(canonicalModalidadesForModules(["vendas", "locacao"]).sort()).toEqual(
      CANONICAL_TEMPLATES.map((t) => t.modalidade).sort()
    );
  });

  it("lista vazia ou módulo desconhecido → nada a semear (não 'tudo')", () => {
    expect(canonicalModalidadesForModules([])).toEqual([]);
    expect(canonicalModalidadesForModules(["financeiro"])).toEqual([]);
  });

  it("`onlyModalidades: []` faz o seed não criar nada", async () => {
    vi.clearAllMocks();
    stubDb();
    const { created } = await seedCanonicalTemplatesForOrg("org1", {
      loadSource: fakeLoader,
      onlyModalidades: [],
    });
    expect(created).toEqual([]);
    expect(create).not.toHaveBeenCalled();
  });
});

/**
 * O conteúdo dos `.hbs` é EMBARCADO num módulo gerado porque `templates/` vive
 * na raiz do monorepo, fora do file tracing do Next (ver header de
 * `scripts/generate-canonical-template-sources.ts`). O preço é drift: editar o
 * `.hbs` sem regerar faria o tenant novo nascer com um template velho. Este
 * bloco é a trava.
 */
describe("canonical-sources.generated (drift)", () => {
  function templatePath(filename: string): string {
    // vitest roda com cwd = apps/web → repo/templates fica em ../../templates.
    const candidates = [
      path.join(process.cwd(), "..", "..", "templates", filename),
      path.join(process.cwd(), "templates", filename),
    ];
    for (const c of candidates) {
      try {
        readFileSync(c);
        return c;
      } catch {
        /* try next */
      }
    }
    throw new Error(`Template não encontrado: ${filename}`);
  }

  it("cobre exatamente os 8 arquivos do catálogo", () => {
    expect(Object.keys(CANONICAL_TEMPLATE_SOURCES).sort()).toEqual(
      CANONICAL_TEMPLATES.map((t) => t.filename).sort()
    );
  });

  it.each(CANONICAL_TEMPLATES.map((t) => t.filename))(
    "%s embarcado === arquivo em templates/",
    (filename) => {
      // Normaliza os DOIS lados: o assunto deste teste é DRIFT DE CONTEÚDO, não
      // identidade de bytes. O working tree de quem roda depende do
      // `core.autocrlf` da máquina (CRLF no Windows, LF no Linux da CI), e sem
      // isto o teste virava um detector de sistema operacional — foi o que
      // deixou a CI da master vermelha por ~1 dia. O gerador já grava LF; isto
      // é o suspensório, para que nem um checkout exótico reintroduza o falso
      // negativo.
      const norm = (s: string) => s.replace(/\r\n/g, "\n");
      const onDisk = readFileSync(templatePath(filename), "utf-8");
      expect(
        norm(CANONICAL_TEMPLATE_SOURCES[filename]),
        `${filename} mudou em templates/ — rode \`npm run gen:canonical-templates\``
      ).toBe(norm(onDisk));
    }
  );

  it("loader embarcado devolve o conteúdo e explode em arquivo desconhecido", () => {
    const t = CANONICAL_TEMPLATES[0];
    expect(loadEmbeddedCanonicalSource(t).length).toBeGreaterThan(100);
    expect(() =>
      loadEmbeddedCanonicalSource({ ...t, filename: "nao_existe.hbs" })
    ).toThrow(/gen:canonical-templates/);
  });
});
