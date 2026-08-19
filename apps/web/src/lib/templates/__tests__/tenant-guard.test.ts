/**
 * Guard anti-clobber dos templates de TENANT.
 *
 * Incidente (2026-08-18/19, prod+staging): o `sync-templates.ts --apply`
 * sobrescreveu as rows "… - Newcore" com o `.hbs` canônico, porque o sync
 * atualiza TODA row handlebars ativa da modalidade sem distinguir dono.
 * O guard tem duas pernas: marcador `tenant-template:` no source (sobrevive a
 * rename na UI) e nome do manifest (cobre row semeada antes do marcador ou já
 * clobberada). Este teste trava as duas + o marcador nos arquivos do repo +
 * o `archiveOthers` do seed (um template ativo por modalidade).
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  TENANT_MANIFESTS,
  TENANT_TEMPLATE_MARKER,
  TENANT_TEMPLATE_NAMES,
  isTenantManagedRow,
  seedTenantTemplatesForOrg,
  type TenantSeedClient,
} from "../../../../scripts/seed-tenant-templates";

/** Raiz do repo — vitest roda com cwd = apps/web. */
function tenantFile(dir: string, filename: string): string {
  const rel = path.join("templates", "tenants", dir, filename);
  const candidates = [path.join(process.cwd(), "..", "..", rel), path.join(process.cwd(), rel)];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  throw new Error(`Arquivo de tenant não encontrado: ${rel}`);
}

describe("isTenantManagedRow", () => {
  it("reconhece pelo marcador no source, independente do nome", () => {
    expect(
      isTenantManagedRow({
        name: "Renomeado na UI",
        handlebarsSource: `{{!-- ${TENANT_TEMPLATE_MARKER} newcore --}}\n<div>x</div>`,
      })
    ).toBe(true);
  });

  it("reconhece pelo nome do manifest mesmo com source canônico (row clobberada)", () => {
    for (const name of TENANT_TEMPLATE_NAMES) {
      expect(isTenantManagedRow({ name, handlebarsSource: "<div>canônico</div>" })).toBe(true);
    }
    expect(TENANT_TEMPLATE_NAMES.size).toBeGreaterThan(0);
  });

  it("não marca row canônica comum", () => {
    expect(
      isTenantManagedRow({
        name: "Proposta de Compra",
        handlebarsSource: "<div>Proposta canônica</div>",
      })
    ).toBe(false);
  });
});

describe("marcador nos .hbs de tenant do repo", () => {
  for (const manifest of TENANT_MANIFESTS) {
    for (const entry of manifest.templates) {
      it(`${manifest.dir}/${entry.filename} carrega "${TENANT_TEMPLATE_MARKER} ${manifest.dir}"`, () => {
        const source = fs.readFileSync(tenantFile(manifest.dir, entry.filename), "utf-8");
        expect(source).toContain(`${TENANT_TEMPLATE_MARKER} ${manifest.dir}`);
      });
    }
  }
});

describe("seedTenantTemplatesForOrg — archiveOthers", () => {
  const NEWCORE = TENANT_MANIFESTS.find((m) => m.dir === "newcore")!;
  const VENDA_ENTRY = NEWCORE.templates.find((t) => t.filename === "proposta_venda_v1.hbs")!;
  const MANIFEST_SO_VENDA = { ...NEWCORE, templates: [VENDA_ENTRY] };
  const SOURCE = `{{!-- ${TENANT_TEMPLATE_MARKER} newcore --}}\n<div>proposta</div>`;

  function mockDb(rows: Array<Record<string, unknown>>) {
    const calls: { updateMany: unknown[]; update: unknown[] } = { updateMany: [], update: [] };
    const db = {
      contractTemplate: {
        findFirst: async (args: { where: { name: string } }) =>
          rows.find((r) => r.name === args.where.name) ?? null,
        findMany: async (args: { where: { id: { not: string } } }) =>
          rows
            .filter((r) => r.status === "active" && r.id !== args.where.id.not)
            .map((r) => ({ id: r.id, name: r.name })),
        count: async () => rows.filter((r) => r.isDefault && r.status === "active").length,
        create: async () => ({ id: "nova" }),
        update: async (args: unknown) => calls.update.push(args),
        updateMany: async (args: unknown) => calls.updateMany.push(args),
      },
    } as unknown as TenantSeedClient;
    return { db, calls };
  }

  it("arquiva as outras rows handlebars ativas da modalidade", async () => {
    const { db, calls } = mockDb([
      {
        id: "tenant-1",
        name: VENDA_ENTRY.name,
        handlebarsSource: SOURCE,
        schemaType: "compra_venda_v1",
        isDefault: true,
        status: "active",
      },
      { id: "canonico-1", name: "Proposta de Compra", status: "active" },
    ]);

    const result = await seedTenantTemplatesForOrg("org-1", MANIFEST_SO_VENDA, {
      db,
      loadSource: () => SOURCE,
      archiveOthers: true,
    });

    expect(result.archived).toEqual(["canonico-1"]);
    expect(calls.updateMany).toContainEqual({
      where: { id: { in: ["canonico-1"] } },
      data: { status: "archived", isDefault: false },
    });
    // A sobrevivente assume o default mesmo sem --make-default (invariante
    // 1-default-por-(org, modalidade) não pode ficar vazia pós-arquivamento).
    expect(calls.update).toContainEqual({
      where: { id: "tenant-1" },
      data: { isDefault: true },
    });
  });

  it("dry-run: reporta mas não escreve", async () => {
    const { db, calls } = mockDb([
      {
        id: "tenant-1",
        name: VENDA_ENTRY.name,
        handlebarsSource: SOURCE,
        schemaType: "compra_venda_v1",
        isDefault: true,
        status: "active",
      },
      { id: "canonico-1", name: "Proposta de Compra", status: "active" },
    ]);

    const result = await seedTenantTemplatesForOrg("org-1", MANIFEST_SO_VENDA, {
      db,
      loadSource: () => SOURCE,
      archiveOthers: true,
      dryRun: true,
    });

    expect(result.archived).toEqual(["canonico-1"]);
    expect(calls.updateMany).toHaveLength(0);
    expect(calls.update).toHaveLength(0);
  });

  it("sem a flag, nada é arquivado", async () => {
    const { db, calls } = mockDb([
      {
        id: "tenant-1",
        name: VENDA_ENTRY.name,
        handlebarsSource: SOURCE,
        schemaType: "compra_venda_v1",
        isDefault: true,
        status: "active",
      },
      { id: "canonico-1", name: "Proposta de Compra", status: "active" },
    ]);

    const result = await seedTenantTemplatesForOrg("org-1", MANIFEST_SO_VENDA, {
      db,
      loadSource: () => SOURCE,
    });

    expect(result.archived).toEqual([]);
    expect(calls.updateMany).toHaveLength(0);
  });
});
