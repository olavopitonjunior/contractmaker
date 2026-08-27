import {
  GARANTIA_TIPOS,
  type GarantiaTipo,
} from "@/lib/contracts/template-category";

/**
 * Catálogo de garantias locatícias da imobiliária — parte PURA.
 *
 * Fica separado de `garantia-option-repo.ts` (que puxa o Prisma) porque este
 * módulo é importado pelo GarantiaStep, que roda no formulário PÚBLICO. O
 * catálogo desce server-side pela page do form, como o `requiredFieldsByStep`:
 * o form é anônimo, então não há API autenticada pra ele consultar.
 *
 * Taxonomia (decisão do dono, 28/08): o TIPO de garantia é fixado no sistema
 * (as 7 de `GARANTIA_TIPOS` — nenhum tenant cria tipos); o que a imobiliária
 * cadastra são as PRESTADORAS (seguradoras/garantidoras) de cada tipo. No
 * formulário isso vira DOIS campos: o tipo (select fixo) e a prestadora
 * (select do catálogo da org + "Outra…" de texto livre). A escolha grava
 * `garantia.tipo` + `garantia.provider` — é o `provider` normalizado que casa
 * com a cláusula da seguradora no acervo (tags `garantia:<tipo>` +
 * `provider:<slug>`); prestadora fora do catálogo cai na cláusula GENÉRICA do
 * tipo.
 */

/** Row do catálogo como ela viaja pro client (JSON puro). */
export interface GarantiaOptionLike {
  id?: string;
  tipo: string;
  provider: string;
  label?: string | null;
  active?: boolean;
  position?: number;
}

/**
 * Tipos de garantia que têm PRESTADORA a escolher (seguradora/garantidora).
 * Fiador, caução, garantia própria e sem garantia não têm empresa por trás —
 * o campo de prestadora nem aparece pra eles.
 */
export const TIPOS_COM_GARANTIDOR: readonly GarantiaTipo[] = [
  "seguro_fianca",
  "garantia_onerosa",
  "titulo_capitalizacao",
];

export function tipoTemGarantidor(tipo: unknown): tipo is GarantiaTipo {
  return (
    typeof tipo === "string" &&
    (TIPOS_COM_GARANTIDOR as readonly string[]).includes(tipo)
  );
}

/**
 * Defaults semeados quando a org não cadastrou nada. Só seguro-fiança: os
 * demais tipos (fiador, caução, título, própria, sem garantia) não têm
 * garantidor pra escolher e entram sempre, por baixo.
 */
export const DEFAULT_GARANTIA_OPTIONS: readonly GarantiaOptionLike[] = [
  { tipo: "seguro_fianca", provider: "Tokio Marine", position: 0 },
  { tipo: "seguro_fianca", provider: "Porto Seguro", position: 1 },
  { tipo: "seguro_fianca", provider: "Pottencial", position: 2 },
  { tipo: "seguro_fianca", provider: "Too", position: 3 },
] as const;

const isGarantiaTipo = (v: unknown): v is GarantiaTipo =>
  typeof v === "string" && (GARANTIA_TIPOS as readonly string[]).includes(v);

const clean = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/**
 * Prestadoras ATIVAS do catálogo para um tipo de garantia, na ordem de
 * `position` (empate: alfabética pt-BR), sem duplicata. É a lista do segundo
 * select do formulário; vazia = o form mostra só o texto livre (e a geração
 * usa a cláusula genérica do tipo).
 */
export function providersForTipo(
  options: readonly GarantiaOptionLike[] | null | undefined,
  tipo: string,
): string[] {
  if (!isGarantiaTipo(tipo)) return [];
  const rows = (options ?? [])
    .filter((o) => o.tipo === tipo && o.active !== false)
    .map((o) => ({
      provider: clean(o.provider),
      position: Number.isFinite(Number(o.position)) ? Number(o.position) : 0,
    }))
    .filter((o) => o.provider !== "");
  rows.sort(
    (a, b) =>
      a.position - b.position || a.provider.localeCompare(b.provider, "pt-BR"),
  );
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of rows) {
    if (seen.has(r.provider)) continue;
    seen.add(r.provider);
    out.push(r.provider);
  }
  return out;
}
