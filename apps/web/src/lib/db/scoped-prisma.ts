import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";

/**
 * scopedPrisma(orgId) — extensão Prisma que injeta `orgId` automaticamente nas
 * operações dos models que têm coluna `orgId` direta (multitenant Fase 0b).
 * Defesa-em-profundidade contra esquecer o filtro `where: { orgId }` no código.
 *
 * QUAIS models são escopados: derivado em runtime do DMMF — qualquer model com
 * um campo escalar chamado `orgId`. Models globais (User, etc.) e os escopados
 * por relação (Deal via pipeline.orgId, Contract via deal, ...) NÃO têm coluna
 * `orgId` e passam direto (ver CAVEATS).
 *
 * CAVEATS (limitações conhecidas — RLS no Postgres é o backstop, Fase 2):
 *   - `findUnique`/`findUniqueOrThrow`/`update`/`delete` usam `where` de campo
 *     ÚNICO (não aceitam filtro arbitrário) → NÃO são escopados aqui. Pra leitura
 *     escopada de 1 registro use `findFirst`; pra escrita escopada use
 *     `updateMany`/`deleteMany`.
 *   - `upsert`: injeta `orgId` em `create.data`, mas o `where` (único) não é
 *     filtrado por org.
 *   - Models escopados por relação (sem coluna `orgId`) não são filtrados —
 *     o caller deve passar o filtro via relação (`where: { pipeline: { orgId } }`)
 *     ou confiar no RLS.
 */

// Nomes (PascalCase) dos models que têm coluna `orgId` direta.
export const ORG_SCOPED_MODELS: ReadonlySet<string> = new Set(
  Prisma.dmmf.datamodel.models
    .filter((m) => m.fields.some((f) => f.name === "orgId"))
    .map((m) => m.name)
);

// Models globais conhecidos (sem orgId, por design) — documentados pra intenção.
// A lista real de "escopados" vem do DMMF acima; isto é referência humana.
export const KNOWN_GLOBAL_MODELS: readonly string[] = [
  "User",
  "Account",
  "Session",
  "VerificationToken",
  "PlatformRole",
  "PlatformConfig",
  "PlatformConfigHistory",
];

type Op = string;

const WHERE_FILTER_OPS: ReadonlySet<Op> = new Set([
  "findMany",
  "findFirst",
  "findFirstOrThrow",
  "count",
  "aggregate",
  "groupBy",
  "updateMany",
  "deleteMany",
]);

export function scopedPrisma(orgId: string) {
  return prisma.$extends({
    name: "tenant-scope",
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (!model || !ORG_SCOPED_MODELS.has(model)) return query(args);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const a = (args ?? {}) as any;

          if (WHERE_FILTER_OPS.has(operation)) {
            a.where = a.where ? { AND: [a.where, { orgId }] } : { orgId };
          } else if (operation === "create") {
            a.data = { ...(a.data ?? {}), orgId };
          } else if (operation === "createMany") {
            a.data = Array.isArray(a.data)
              ? a.data.map((d: Record<string, unknown>) => ({ ...d, orgId }))
              : { ...(a.data ?? {}), orgId };
          } else if (operation === "upsert") {
            // where é único (não filtrável por org aqui); garante orgId no create.
            a.create = { ...(a.create ?? {}), orgId };
          }
          // findUnique/findUniqueOrThrow/update/delete: passam direto (caveat).

          return query(a);
        },
      },
    },
  });
}

export type ScopedPrismaClient = ReturnType<typeof scopedPrisma>;
