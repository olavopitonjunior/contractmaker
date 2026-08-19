/**
 * Cadastra os templates PRÓPRIOS de um tenant (`templates/tenants/<pasta>/*.hbs`)
 * como rows `ContractTemplate` daquela org.
 *
 * Diferença pro `sync-templates.ts`: aquele cuida dos templates CANÔNICOS
 * (`templates/*.hbs`, catálogo em `lib/templates/canonical-templates.ts`, uma
 * modalidade por arquivo, todas as orgs). Este cuida do documento que UMA
 * imobiliária desenhou — o mesmo arquivo pode cobrir N modalidades (a ficha da
 * Ativa serve residencial e comercial) e só entra na org dela.
 *
 * Usage:
 *   npx tsx scripts/seed-tenant-templates.ts --org <orgId|slug>                          # dry-run
 *   npx tsx scripts/seed-tenant-templates.ts --org <orgId|slug> --dir templates/tenants/remax-ativa
 *   npx tsx scripts/seed-tenant-templates.ts --org <orgId|slug> --apply                  # persiste
 *
 * Flags:
 *   --org <orgId|slug>   obrigatório. Aceita o cuid ou o slug da Organization.
 *   --dir <caminho>      pasta do tenant, relativa à raiz do repo. Default: o
 *                        único manifest registrado, quando só existe um.
 *   --dry-run            default (redundante; explicitar é permitido).
 *   --apply              escreve no banco.
 *   --make-default       promove cada row do tenant a default ATIVO da
 *                        modalidade (derruba o default anterior, ex. o template
 *                        canônico). Sem isso, org que já tem default segue
 *                        selecionando o antigo — `pickTemplateByFacts` desempata
 *                        por `isDefault`.
 *   --archive-others     arquiva (status="archived", isDefault=false) as OUTRAS
 *                        rows handlebars ativas da mesma (org, modalidade) —
 *                        deixa UM template ativo por modalidade, o do tenant.
 *                        O seed canônico não recria (a checagem de existência
 *                        dele é por (orgId, modalidade), sem filtro de status).
 *
 * Env:
 *   DATABASE_URL — Prisma connection (passe a URL de staging/prod inline).
 *
 * Idempotência (por arquivo × modalidade):
 *   - já existe row da org na modalidade com o MESMO `name` e engine=handlebars
 *     → atualiza só o `handlebarsSource` (e o `schemaType`, se divergir);
 *   - não existe → cria `active` + `engine="handlebars"`, `isDefault=true` só
 *     quando a org ainda não tem default ATIVO daquela modalidade;
 *   - rows `engine="google_docs"` (o Doc-modelo do tenant no Drive) NUNCA são
 *     tocadas nem contadas como colisão de nome — no máximo seguram o
 *     `isDefault`.
 */
import fs from "fs";
import path from "path";
import { PrismaClient } from "@prisma/client";
import type { CanonicalSeedClient } from "../src/lib/templates/canonical-seed";

// ---------------------------------------------------------------------------
// Manifest
// ---------------------------------------------------------------------------

/** Uma modalidade servida por um arquivo do tenant. */
export interface TenantTemplateModalidade {
  modalidade: string;
  schemaType: string;
}

export interface TenantTemplateEntry {
  /** Arquivo dentro da pasta do tenant. */
  filename: string;
  name: string;
  description: string;
  /** O MESMO arquivo vira uma row por modalidade. */
  modalidades: TenantTemplateModalidade[];
  /**
   * `ContractTemplate.matchCriteria` — `{ garantia?, fiadorPessoa?, pessoa? }`.
   * `null` = template GENÉRICO da modalidade (o seletor não filtra por critério).
   */
  matchCriteria: Record<string, unknown> | null;
  /** `ContractTemplate.version` da row criada. */
  version: string;
}

export interface TenantManifest {
  /** Pasta em `templates/tenants/`. Também é a chave de lookup do `--dir`. */
  dir: string;
  /** Só documental — a org alvo vem sempre do `--org`. */
  tenant: string;
  templates: TenantTemplateEntry[];
}

/**
 * Manifests inline. Um por tenant com documento próprio.
 *
 * remax-ativa: ficha tabular única (as 4 fichas PDF da Ativa colapsadas num
 * arquivo). `matchCriteria: null` de propósito — os 3 eixos (pessoa, garantia,
 * fiadorPessoa) já são resolvidos por condicional DENTRO do template, então ele
 * é o genérico da modalidade e não deve ser desclassificado por critério nenhum.
 */
export const TENANT_MANIFESTS: TenantManifest[] = [
  {
    dir: "newcore",
    tenant: "Newcore",
    templates: [
      {
        filename: "proposta_venda_v1.hbs",
        name: "Proposta de Compra e Venda - Newcore",
        description:
          "Proposta de compra e venda da Newcore (1 página) - partes qualificadas, condições comerciais e cláusulas de mediação/aceite/desistência (CC arts. 722-729)",
        modalidades: [
          { modalidade: "proposta_venda", schemaType: "compra_venda_v1" },
        ],
        matchCriteria: null,
        version: "1.0.0",
      },
      {
        filename: "proposta_locacao_v1.hbs",
        name: "Proposta de Locação - Newcore",
        description:
          "Proposta de locação da Newcore (1 página) - cobre residencial e comercial, com aceite condicionado à aprovação cadastral (Lei 8.245/91)",
        modalidades: [
          {
            modalidade: "proposta_locacao_residencial",
            schemaType: "locacao_residencial_v1",
          },
          {
            modalidade: "proposta_locacao_comercial",
            schemaType: "locacao_comercial_v1",
          },
        ],
        matchCriteria: null,
        version: "1.0.0",
      },
    ],
  },
  {
    dir: "remax-ativa",
    tenant: "RE/MAX Ativa I",
    templates: [
      {
        filename: "proposta_locacao_v1.hbs",
        name: "Proposta de Locação - RE/MAX Ativa",
        description:
          "Ficha de proposta de locação da RE/MAX Ativa I - cobre locatário PF/PJ e fiador PF/PJ/ausente no mesmo documento",
        modalidades: [
          {
            modalidade: "proposta_locacao_residencial",
            schemaType: "locacao_residencial_v1",
          },
          {
            modalidade: "proposta_locacao_comercial",
            schemaType: "locacao_comercial_v1",
          },
        ],
        matchCriteria: null,
        version: "1.0.0",
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// Guard anti-clobber (consumido pelo sync-templates.ts)
// ---------------------------------------------------------------------------

/**
 * Marcador machine-readable no comentário de abertura dos `.hbs` de tenant.
 * O `sync-templates.ts` (que sobrescreve TODA row handlebars ativa da
 * modalidade com o canônico) pula rows cujo source carrega este marcador —
 * sem ele, um sync de rotina destruía o template do tenant (aconteceu em
 * prod/staging em 2026-08-18/19 com os templates da Newcore).
 */
export const TENANT_TEMPLATE_MARKER = "tenant-template:";

/** Nomes de row gerenciados por manifest — fallback do guard pra rows semeadas
 *  ANTES do marcador existir no source (ou já clobberadas com o canônico). */
export const TENANT_TEMPLATE_NAMES: ReadonlySet<string> = new Set(
  TENANT_MANIFESTS.flatMap((m) => m.templates.map((t) => t.name))
);

/** Row que pertence a um tenant: marcador no source OU nome de manifest.
 *  O marcador só conta no INÍCIO do source (1ª linha do comentário de
 *  abertura) — um canônico que apenas MENCIONE a string num comentário
 *  qualquer não vira falso positivo. */
export function isTenantManagedRow(
  row: { name: string; handlebarsSource: string },
  tenantNames: ReadonlySet<string> = TENANT_TEMPLATE_NAMES
): boolean {
  return (
    row.handlebarsSource.slice(0, 200).includes(TENANT_TEMPLATE_MARKER) ||
    tenantNames.has(row.name)
  );
}

// ---------------------------------------------------------------------------
// Seed
// ---------------------------------------------------------------------------

/**
 * Cliente mínimo usado pelo seed. Estende o do seed canônico (`findFirst` +
 * `create`) com o `update` — este script atualiza conteúdo, o canônico só cria.
 */
export interface TenantSeedClient extends CanonicalSeedClient {
  contractTemplate: CanonicalSeedClient["contractTemplate"] & {
    count(args: unknown): Promise<number>;
    findMany(args: unknown): Promise<unknown[]>;
    update(args: unknown): Promise<unknown>;
    updateMany(args: unknown): Promise<unknown>;
  };
}

/** Mesma forma de resultado do seed canônico, com o eixo "atualizado". */
export interface SeedTenantTemplatesResult {
  created: string[];
  updated: string[];
  unchanged: string[];
  /** Ids arquivados por `archiveOthers` (vazio sem a flag). */
  archived: string[];
}

export interface SeedTenantTemplatesOptions {
  db: TenantSeedClient;
  /** De onde vem o `.hbs`. Injetável igual ao seed canônico (CLI lê do disco). */
  loadSource: (entry: TenantTemplateEntry) => string | Promise<string>;
  dryRun?: boolean;
  /**
   * Promove cada row do tenant a default ATIVO da modalidade, derrubando o
   * default anterior (mesma invariante de POST/PATCH /api/templates: um
   * default por (orgId, modalidade)).
   */
  makeDefault?: boolean;
  /**
   * Arquiva as OUTRAS rows handlebars ativas da mesma (org, modalidade) —
   * garante um único template ativo por modalidade (o do tenant). Rows
   * `engine="google_docs"` não são tocadas (Doc-modelo do tenant no Drive).
   */
  archiveOthers?: boolean;
  log?: (line: string) => void;
}

export async function seedTenantTemplatesForOrg(
  orgId: string,
  manifest: TenantManifest,
  opts: SeedTenantTemplatesOptions
): Promise<SeedTenantTemplatesResult> {
  const log = opts.log ?? (() => {});
  const created: string[] = [];
  const updated: string[] = [];
  const unchanged: string[] = [];
  const archived: string[] = [];

  // Um default por (orgId, modalidade) — derruba os outros ANTES de setar o
  // novo, mesma ordem do POST /api/templates.
  async function promoteToDefault(id: string, modalidade: string, key: string) {
    log(`  ★ ${key}: promovendo a default da modalidade`);
    if (opts.dryRun) return;
    await opts.db.contractTemplate.updateMany({
      where: { orgId, modalidade, isDefault: true, id: { not: id } },
      data: { isDefault: false },
    });
    await opts.db.contractTemplate.update({
      where: { id },
      data: { isDefault: true },
    });
  }

  // Um template ATIVO por (org, modalidade): arquiva as outras rows handlebars
  // ativas. Nunca deleta (histórico/FKs) nem toca engine="google_docs".
  async function archiveOthersOf(id: string, modalidade: string, key: string) {
    if (!opts.archiveOthers) return;
    const others = (await opts.db.contractTemplate.findMany({
      where: { orgId, modalidade, engine: "handlebars", status: "active", id: { not: id } },
      select: { id: true, name: true },
    })) as { id: string; name: string }[];
    if (others.length === 0) return;
    for (const o of others) {
      log(`  🗄 ${key}: ${opts.dryRun ? "arquivaria" : "arquiva"} "${o.name}" (id=${o.id})`);
    }
    archived.push(...others.map((o) => o.id));
    if (opts.dryRun) return;
    await opts.db.contractTemplate.updateMany({
      where: { id: { in: others.map((o) => o.id) } },
      data: { status: "archived", isDefault: false },
    });
    // Invariante 1-default-por-(org, modalidade): se o default anterior acabou
    // de ser arquivado (rodou sem --make-default), a sobrevivente assume —
    // idempotente quando já é default.
    await opts.db.contractTemplate.update({
      where: { id },
      data: { isDefault: true },
    });
  }

  for (const entry of manifest.templates) {
    const source = await opts.loadSource(entry);

    for (const { modalidade, schemaType } of entry.modalidades) {
      const key = `${entry.filename} → ${modalidade}`;

      // Colisão de nome: só entre rows handlebars. O Doc-modelo do tenant
      // (engine="google_docs") nunca é sobrescrito por um .hbs.
      const existing = (await opts.db.contractTemplate.findFirst({
        where: { orgId, modalidade, name: entry.name, engine: "handlebars" },
        select: { id: true, handlebarsSource: true, schemaType: true, isDefault: true },
      })) as {
        id: string;
        handlebarsSource: string;
        schemaType: string;
        isDefault: boolean;
      } | null;

      if (existing) {
        const sourceDiffere = existing.handlebarsSource !== source;
        const schemaDiffere = existing.schemaType !== schemaType;
        if (!sourceDiffere && !schemaDiffere) {
          log(`✓  ${key}: já em dia (id=${existing.id})`);
          if (opts.makeDefault && !existing.isDefault) {
            await promoteToDefault(existing.id, modalidade, key);
            updated.push(key);
          } else {
            unchanged.push(key);
          }
          await archiveOthersOf(existing.id, modalidade, key);
          continue;
        }
        log(
          `⚡ ${key}: atualiza row existente (id=${existing.id})` +
            `${sourceDiffere ? " source" : ""}${schemaDiffere ? ` schemaType→${schemaType}` : ""}`
        );
        if (!opts.dryRun) {
          await opts.db.contractTemplate.update({
            where: { id: existing.id },
            data: { handlebarsSource: source, schemaType },
          });
          log(`  ✓ atualizado`);
        }
        if (opts.makeDefault && !existing.isDefault) {
          await promoteToDefault(existing.id, modalidade, key);
        }
        await archiveOthersOf(existing.id, modalidade, key);
        updated.push(key);
        continue;
      }

      // isDefault só quando a org ainda não tem default ATIVO da modalidade —
      // inclusive um google_docs, que segura a posição. `--make-default` força.
      const defaults = await opts.db.contractTemplate.count({
        where: { orgId, modalidade, isDefault: true, status: "active" },
      });
      const isDefault = defaults === 0;

      log(
        `＋ ${key}: cria row (isDefault=${isDefault}, schemaType=${schemaType}, ` +
          `matchCriteria=${entry.matchCriteria === null ? "null" : JSON.stringify(entry.matchCriteria)})`
      );
      if (!opts.dryRun) {
        const row = (await opts.db.contractTemplate.create({
          data: {
            orgId,
            name: entry.name,
            description: entry.description,
            handlebarsSource: source,
            modalidade,
            schemaType,
            // `undefined` (não `null`): em campo `Json?` do Prisma, `null` é o
            // JSON literal `null` e exigiria `Prisma.DbNull`. Omitir deixa a
            // coluna NULL, que é o "genérico da modalidade" do seletor.
            matchCriteria: entry.matchCriteria ?? undefined,
            isDefault,
            status: "active",
            version: entry.version,
            engine: "handlebars",
          },
        })) as { id: string };
        log(`  ✓ criado`);
        if (opts.makeDefault && !isDefault) {
          await promoteToDefault(row.id, modalidade, key);
        }
        await archiveOthersOf(row.id, modalidade, key);
      } else {
        if (opts.makeDefault && !isDefault) {
          log(`  ★ ${key}: seria promovido a default da modalidade`);
        }
        if (opts.archiveOthers) {
          log(`  🗄 ${key}: arquivaria as demais rows handlebars ativas da modalidade`);
        }
      }
      created.push(key);
    }
  }

  return { created, updated, unchanged, archived };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  if (i === -1) return undefined;
  const v = process.argv[i + 1];
  return v && !v.startsWith("--") ? v : undefined;
}

/** Resolve a pasta do tenant (relativa à raiz do monorepo). */
export function resolveTenantDir(relDir: string): string {
  const candidates = [
    path.join(process.cwd(), "..", "..", relDir),
    path.join(process.cwd(), relDir),
    path.join(__dirname, "..", "..", "..", relDir),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  throw new Error(`Pasta de tenant não encontrada: ${relDir}`);
}

/** `templates/tenants/remax-ativa` (ou só `remax-ativa`) → manifest. */
export function findManifest(dirArg: string): TenantManifest {
  const key = path.basename(dirArg.replace(/[\\/]+$/, ""));
  const hit = TENANT_MANIFESTS.find((m) => m.dir === key);
  if (!hit) {
    throw new Error(
      `Sem manifest pra "${key}". Registrados: ${TENANT_MANIFESTS.map((m) => m.dir).join(", ")}`
    );
  }
  return hit;
}

async function main() {
  const DRY_RUN = !process.argv.includes("--apply");
  const MAKE_DEFAULT = process.argv.includes("--make-default");
  const ARCHIVE_OTHERS = process.argv.includes("--archive-others");
  const org = argValue("--org");
  if (!org) {
    console.error(
      "[seed-tenant-templates] --org <orgId|slug> é obrigatório.\n" +
        "  npx tsx scripts/seed-tenant-templates.ts --org <orgId|slug> [--dir templates/tenants/<pasta>] [--apply]"
    );
    process.exit(1);
  }

  const dirArg =
    argValue("--dir") ??
    (TENANT_MANIFESTS.length === 1
      ? `templates/tenants/${TENANT_MANIFESTS[0].dir}`
      : undefined);
  if (!dirArg) {
    console.error(
      `[seed-tenant-templates] --dir é obrigatório (manifests: ${TENANT_MANIFESTS.map((m) => m.dir).join(", ")}).`
    );
    process.exit(1);
  }

  const manifest = findManifest(dirArg);
  const baseDir = resolveTenantDir(dirArg);

  console.log(`[seed-tenant-templates] ${DRY_RUN ? "DRY RUN" : "APPLY MODE"}`);
  console.log(`[seed-tenant-templates] tenant: ${manifest.tenant} (${manifest.dir})`);
  console.log(`[seed-tenant-templates] dir: ${baseDir}`);
  console.log(`[seed-tenant-templates] org (arg): ${org}`);
  console.log(
    `[seed-tenant-templates] DB: ${process.env.DATABASE_URL?.replace(/:[^:@]+@/, ":***@")}`
  );

  // Lê tudo do disco ANTES de tocar no banco — arquivo faltando falha barato.
  const sources = new Map<string, string>();
  for (const entry of manifest.templates) {
    const file = path.join(baseDir, entry.filename);
    if (!fs.existsSync(file)) throw new Error(`Arquivo não encontrado: ${file}`);
    const src = fs.readFileSync(file, "utf-8");
    sources.set(entry.filename, src);
    console.log(
      `[seed-tenant-templates] ${entry.filename}: ${src.length} chars → ` +
        `${entry.modalidades.map((m) => m.modalidade).join(", ")}`
    );
  }
  console.log();

  const prisma = new PrismaClient();
  try {
    const organization = await prisma.organization.findFirst({
      where: { OR: [{ id: org }, { slug: org }] },
      select: { id: true, name: true, slug: true },
    });
    if (!organization) {
      throw new Error(`Organization não encontrada por id nem slug: "${org}"`);
    }
    console.log(
      `[seed-tenant-templates] org: ${organization.name} (id=${organization.id}, slug=${organization.slug})`
    );
    console.log();

    const result = await seedTenantTemplatesForOrg(organization.id, manifest, {
      db: prisma as unknown as TenantSeedClient,
      loadSource: (entry) => sources.get(entry.filename)!,
      dryRun: DRY_RUN,
      makeDefault: MAKE_DEFAULT,
      archiveOthers: ARCHIVE_OTHERS,
      log: (line) => console.log(line),
    });

    console.log();
    console.log(
      `[seed-tenant-templates] ${DRY_RUN ? "would create" : "created"}: ${result.created.length}, ` +
        `${DRY_RUN ? "would update" : "updated"}: ${result.updated.length}, ` +
        `unchanged: ${result.unchanged.length}, ` +
        `${DRY_RUN ? "would archive" : "archived"}: ${result.archived.length}`
    );
    if (DRY_RUN && result.created.length + result.updated.length > 0) {
      console.log(`[seed-tenant-templates] Rode com --apply pra persistir.`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error("[seed-tenant-templates] ERROR:", err);
    process.exit(1);
  });
}
