import { prisma } from "@/lib/db/prisma";
import {
  DEFAULT_GARANTIA_OPTIONS,
  type GarantiaOptionLike,
} from "./garantia-catalog";

/**
 * Acesso ao banco do catálogo de garantias. Separado de `garantia-catalog.ts`
 * (puro, importado pelo formulário público) pelo mesmo motivo do
 * `participant-category-repo`: Prisma não pode entrar no bundle do form.
 */

type Row = {
  id: string;
  tipo: string;
  provider: string;
  label: string | null;
  active: boolean;
  position: number;
};

const SELECT = {
  id: true,
  tipo: true,
  provider: true,
  label: true,
  active: true,
  position: true,
} as const;

const toOption = (row: Row): GarantiaOptionLike => ({
  id: row.id,
  tipo: row.tipo,
  provider: row.provider,
  label: row.label,
  active: row.active,
  position: row.position,
});

/**
 * Catálogo da org. **Org sem nenhuma row cai nos DEFAULTS** (seguro-fiança ×
 * Tokio Marine / Porto Seguro / Pottencial / Too) — as orgs que existiam antes
 * da tabela não ficam com um formulário pior do que tinham. Uma vez que o admin
 * cadastra qualquer coisa, o catálogo dela manda (inclusive quando ela desativa
 * tudo: aí sobram só as modalidades sem garantidor, que o
 * `buildGarantiaChoices` sempre oferece).
 */
export async function listGarantiaOptions(
  orgId: string,
  opts: { activeOnly?: boolean } = {},
): Promise<GarantiaOptionLike[]> {
  const rows = await prisma.garantiaOption.findMany({
    where: { orgId },
    orderBy: [{ position: "asc" }, { provider: "asc" }],
    select: SELECT,
  });
  if (rows.length === 0) return DEFAULT_GARANTIA_OPTIONS.map((o) => ({ ...o }));
  const all = rows.map(toOption);
  return opts.activeOnly ? all.filter((o) => o.active !== false) : all;
}

/**
 * Semeia os defaults numa org nova. Idempotente via @@unique(orgId, tipo,
 * provider) + skipDuplicates — rodar duas vezes não duplica nem levanta.
 */
export async function seedDefaultGarantiaOptions(
  orgId: string,
  client: { garantiaOption: { createMany: typeof prisma.garantiaOption.createMany } } = prisma,
): Promise<number> {
  const res = await client.garantiaOption.createMany({
    data: DEFAULT_GARANTIA_OPTIONS.map((o) => ({
      orgId,
      tipo: o.tipo,
      provider: o.provider,
      position: o.position ?? 0,
    })),
    skipDuplicates: true,
  });
  return res.count;
}
