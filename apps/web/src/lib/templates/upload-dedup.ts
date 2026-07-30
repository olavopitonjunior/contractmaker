import { createHash } from "node:crypto";

/**
 * Dedup da ingestão "modelo da imobiliária (DOCX) → template".
 *
 * Identidade do modelo é o CONTEÚDO do arquivo (SHA-256), não o nome: subir o
 * mesmo .docx duas vezes deve devolver o template já existente em vez de criar
 * mais um draft. O nome, ao contrário, é só rótulo — colisão de nome sufixa
 * " (2)", " (3)"… e segue o baile.
 *
 * Lógica pura e sem import do prisma concreto (recebe `db`) pra ser testável.
 */

/** Status que NÃO participam do dedup — arquivado é lixeira, pode reingerir. */
const ARCHIVED_STATUS = "archived";

export type DuplicateTemplate = {
  id: string;
  name: string;
  status: string;
  modalidade: string | null;
};

/**
 * Superfície mínima do prisma consumida aqui (facilita o stub nos testes).
 * `any` nos args porque a assinatura genérica do PrismaClient não é atribuível
 * a um parâmetro tipado (contravariância) — o shape real é coberto no teste.
 */
export type TemplateDedupDb = {
  contractTemplate: {
    /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
    findFirst: (args: any) => Promise<unknown>;
    /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
    findMany: (args: any) => Promise<unknown>;
  };
};

/** SHA-256 hex do arquivo original — o que vai pra `ContractTemplate.sourceHash`. */
export function computeSourceHash(buffer: Buffer | Uint8Array): string {
  return createHash("sha256").update(buffer).digest("hex");
}

/**
 * Template NÃO-arquivado do mesmo org com o mesmo hash de origem, ou null.
 * Templates antigos têm `sourceHash` NULL e nunca casam (hash é sempre hex).
 */
export async function findDuplicateTemplate(
  db: TemplateDedupDb,
  orgId: string,
  sourceHash: string
): Promise<DuplicateTemplate | null> {
  if (!sourceHash) return null;
  const hit = await db.contractTemplate.findFirst({
    where: { orgId, sourceHash, status: { not: ARCHIVED_STATUS } },
    select: { id: true, name: true, status: true, modalidade: true },
    orderBy: { createdAt: "asc" },
  });
  return (hit as DuplicateTemplate | null) ?? null;
}

/**
 * Nome livre no org: `base` se ninguém usa, senão `base (2)`, `base (3)`…
 * Considera só não-arquivados — nome de template arquivado pode ser reusado.
 */
export async function resolveUniqueTemplateName(
  db: TemplateDedupDb,
  orgId: string,
  base: string
): Promise<string> {
  const taken = (await db.contractTemplate.findMany({
    where: {
      orgId,
      status: { not: ARCHIVED_STATUS },
      name: { startsWith: base },
    },
    select: { name: true },
  })) as Array<{ name: string }>;
  const used = new Set(taken.map((t) => t.name));
  if (!used.has(base)) return base;
  let n = 2;
  while (used.has(`${base} (${n})`)) n += 1;
  return `${base} (${n})`;
}
