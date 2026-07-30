import { prisma } from "@/lib/db/prisma";
import {
  CANONICAL_TEMPLATES,
  DEFAULT_SCHEMA_TYPE,
  type CanonicalTemplate,
} from "./canonical-templates";
import { CANONICAL_TEMPLATE_SOURCES } from "./canonical-sources.generated";

/**
 * Seed dos templates canônicos (`ContractTemplate` engine="handlebars") pra uma
 * org. Sem isto o tenant nasce com ZERO template e a PRIMEIRA geração de
 * contrato morre em "Nenhum template ativo encontrado".
 *
 * Compartilhado por `POST /api/admin/orgs` (criação do tenant) e
 * `scripts/sync-templates.ts --seed` (backfill de orgs existentes).
 *
 * BUNDLING dos `.hbs`: o conteúdo vem do módulo gerado
 * `canonical-sources.generated.ts`, não do filesystem. `templates/` está na RAIZ
 * do monorepo (fora de `apps/web`), então numa serverless function nem o
 * `process.cwd()` aponta pra lá nem o file tracing do Next inclui o arquivo no
 * bundle — e o repo não usa `outputFileTracingIncludes` em lugar nenhum. O
 * loader é injetável (`loadSource`) pro CLI ler direto do disco e pros testes
 * rodarem sem fs.
 */

export interface SeedCanonicalTemplatesResult {
  /** Modalidades criadas nesta chamada. */
  created: string[];
  /** Modalidades puladas (a org já tinha template daquela modalidade). */
  skipped: string[];
}

export type CanonicalTemplateSourceLoader = (
  template: CanonicalTemplate
) => string | Promise<string>;

/**
 * Subconjunto do delegate `contractTemplate` que o seed usa. Existe pro CLI
 * injetar seu próprio `PrismaClient` (com um cast único no call site) sem
 * arrastar os tipos gerados do Prisma pra assinatura pública.
 */
export interface CanonicalSeedClient {
  contractTemplate: {
    findFirst(args: unknown): Promise<{ id: string } | null>;
    create(args: unknown): Promise<unknown>;
  };
}

export interface SeedCanonicalTemplatesOptions {
  /** De onde vem o `.hbs`. Default: conteúdo embarcado no bundle. */
  loadSource?: CanonicalTemplateSourceLoader;
  /** Cliente Prisma alternativo (CLI). Default: singleton do app. */
  db?: CanonicalSeedClient;
  /** Só calcula o que faria, sem escrever. */
  dryRun?: boolean;
  /** Restringe a estas modalidades. Default: todas as canônicas. */
  onlyModalidades?: string[];
}

/** Conteúdo embarcado no bundle — loader default. */
export function loadEmbeddedCanonicalSource(template: CanonicalTemplate): string {
  const source = CANONICAL_TEMPLATE_SOURCES[template.filename];
  if (!source) {
    throw new Error(
      `Fonte canônica ausente pra ${template.filename} — rode ` +
        `\`npm run gen:canonical-templates\` em apps/web.`
    );
  }
  return source;
}

/**
 * Idempotente: pra cada modalidade canônica, se a org JÁ tem QUALQUER template
 * daquela modalidade (qualquer engine, qualquer status), pula. É o guard
 * multitenant — um modelo `engine="google_docs"` da imobiliária ou um canônico
 * que o tenant arquivou de propósito nunca são duplicados por um re-seed.
 */
export async function seedCanonicalTemplatesForOrg(
  orgId: string,
  opts: SeedCanonicalTemplatesOptions = {}
): Promise<SeedCanonicalTemplatesResult> {
  const db = opts.db ?? (prisma as unknown as CanonicalSeedClient);
  const loadSource = opts.loadSource ?? loadEmbeddedCanonicalSource;
  const targets = opts.onlyModalidades
    ? CANONICAL_TEMPLATES.filter((t) => opts.onlyModalidades!.includes(t.modalidade))
    : CANONICAL_TEMPLATES;

  const created: string[] = [];
  const skipped: string[] = [];

  for (const template of targets) {
    const exists = await db.contractTemplate.findFirst({
      where: { orgId, modalidade: template.modalidade },
      select: { id: true },
    });
    if (exists) {
      skipped.push(template.modalidade);
      continue;
    }

    if (!opts.dryRun) {
      const source = await loadSource(template);
      // Sem un-default prévio: só chegamos aqui quando a org não tem NENHUM
      // template da modalidade, então não há default concorrente pra desfazer.
      await db.contractTemplate.create({
        data: {
          orgId,
          name: template.canonicalName,
          description: template.canonicalDescription,
          handlebarsSource: source,
          modalidade: template.modalidade,
          isDefault: true,
          status: "active",
          schemaType: template.schemaType ?? DEFAULT_SCHEMA_TYPE,
          version: "2.0.0",
          engine: "handlebars",
        },
      });
    }
    created.push(template.modalidade);
  }

  return { created, skipped };
}
