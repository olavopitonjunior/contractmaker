import { prisma } from "@/lib/db/prisma";
import {
  parseCategoryAppliesTo,
  parseCategoryFields,
  type ParticipantCategory,
} from "./participant-category";

/**
 * Acesso ao banco das categorias de terceiro. Fica separado de
 * `participant-category.ts` de propósito: aquele módulo é puro (zod + regex) e
 * é importado por componentes client — puxar o Prisma pra lá quebraria o
 * bundle do formulário público.
 */

type Row = {
  id: string;
  slug: string;
  label: string;
  description: string | null;
  appliesTo: string[];
  fields: unknown;
  active: boolean;
};

function toCategory(row: Row): ParticipantCategory {
  return {
    id: row.id,
    slug: row.slug,
    label: row.label,
    description: row.description,
    appliesTo: parseCategoryAppliesTo(row.appliesTo),
    fields: parseCategoryFields(row.fields),
    active: row.active,
  };
}

const SELECT = {
  id: true,
  slug: true,
  label: true,
  description: true,
  appliesTo: true,
  fields: true,
  active: true,
} as const;

/** Categorias da org. `activeOnly` pra tudo que é oferecido ao cliente final. */
export async function listOrgParticipantCategories(
  orgId: string,
  opts: { activeOnly?: boolean } = {},
): Promise<ParticipantCategory[]> {
  const rows = await prisma.formParticipantCategory.findMany({
    where: { orgId, ...(opts.activeOnly ? { active: true } : {}) },
    orderBy: { label: "asc" },
    select: SELECT,
  });
  return rows.map(toCategory);
}

/** Uma categoria por slug (não filtra `active` — o caller decide o erro). */
export async function findOrgParticipantCategory(
  orgId: string,
  slug: string,
): Promise<ParticipantCategory | null> {
  const row = await prisma.formParticipantCategory.findUnique({
    where: { orgId_slug: { orgId, slug } },
    select: SELECT,
  });
  return row ? toCategory(row) : null;
}
