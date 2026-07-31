import { GARANTIA_LABELS, GARANTIA_TIPOS, type GarantiaTipo } from "@/lib/contracts/template-category";

/**
 * Catálogo de garantias locatícias da imobiliária — parte PURA.
 *
 * Fica separado de `garantia-option-repo.ts` (que puxa o Prisma) porque este
 * módulo é importado pelo GarantiaStep, que roda no formulário PÚBLICO. O
 * catálogo desce server-side pela page do form, como o `requiredFieldsByStep`:
 * o form é anônimo, então não há API autenticada pra ele consultar.
 *
 * A escolha do form vira UM par: `garantia.tipo` + `garantia.provider`. Antes o
 * tipo era um select fechado e o garantidor um Input livre — e é o `provider`
 * que amarra a cláusula da seguradora (tags `garantia:<tipo>` + provider), então
 * texto livre desalinhava documento e formulário.
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

/** Uma entrada do select do formulário. */
export interface GarantiaChoice {
  /** Valor opaco do select — casar por igualdade, nunca fatiar. */
  value: string;
  label: string;
  tipo: GarantiaTipo;
  provider: string;
  /** "Outro garantidor…" — abre o campo de texto livre (escape hatch). */
  isOutro: boolean;
}

/**
 * Defaults semeados quando a org não cadastrou nada. Só seguro-fiança: as
 * demais modalidades (fiador, caução, título, própria, sem garantia) não têm
 * garantidor pra escolher e entram sempre, por baixo.
 */
export const DEFAULT_GARANTIA_OPTIONS: readonly GarantiaOptionLike[] = [
  { tipo: "seguro_fianca", provider: "Tokio Marine", position: 0 },
  { tipo: "seguro_fianca", provider: "Porto Seguro", position: 1 },
  { tipo: "seguro_fianca", provider: "Pottencial", position: 2 },
  { tipo: "seguro_fianca", provider: "Too", position: 3 },
] as const;

const OUTRO_SUFFIX = "::__outro__";

const isGarantiaTipo = (v: unknown): v is GarantiaTipo =>
  typeof v === "string" && (GARANTIA_TIPOS as readonly string[]).includes(v);

const clean = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/** Valor opaco de uma escolha tipo × garantidor. */
export function garantiaChoiceValue(tipo: string, provider: string): string {
  return provider ? `${tipo}::${provider}` : tipo;
}

function defaultChoiceLabel(tipo: GarantiaTipo, provider: string): string {
  const base = GARANTIA_LABELS[tipo];
  return provider ? `${base} — ${provider}` : base;
}

/**
 * Monta as opções do select a partir do catálogo da org.
 *
 * Ordem: as opções cadastradas (por `position`, depois pela ordem canônica dos
 * tipos), com o "Outro garantidor…" logo após o último garantidor do MESMO
 * tipo — os pares de um tipo ficam juntos, que é o agrupamento visual que o
 * select nativo consegue sem optgroup redundante.
 *
 * Depois entram as modalidades que nenhum garantidor cobre (fiador, caução,
 * título de capitalização, GARANTIA PRÓPRIA — que faltava na UI antiga — e sem
 * garantia). Elas são incondicionais de propósito: um catálogo com só
 * seguradoras não pode fazer o formulário perder "Fiador".
 */
export function buildGarantiaChoices(
  options: readonly GarantiaOptionLike[] | null | undefined,
): GarantiaChoice[] {
  const rows = (options ?? [])
    .filter((o) => o.active !== false && isGarantiaTipo(o.tipo))
    .map((o) => ({
      tipo: o.tipo as GarantiaTipo,
      provider: clean(o.provider),
      label: clean(o.label),
      position: Number.isFinite(Number(o.position)) ? Number(o.position) : 0,
    }));

  const tipoOrder = new Map(GARANTIA_TIPOS.map((t, i) => [t, i]));
  rows.sort((a, b) => {
    const ta = tipoOrder.get(a.tipo) ?? 99;
    const tb = tipoOrder.get(b.tipo) ?? 99;
    if (ta !== tb) return ta - tb;
    if (a.position !== b.position) return a.position - b.position;
    return a.provider.localeCompare(b.provider, "pt-BR");
  });

  const choices: GarantiaChoice[] = [];
  const seen = new Set<string>();
  const tiposComProvider = new Set<GarantiaTipo>();
  const tiposDiretos = new Set<GarantiaTipo>();

  for (const row of rows) {
    const value = garantiaChoiceValue(row.tipo, row.provider);
    if (seen.has(value)) continue;
    seen.add(value);
    if (row.provider) tiposComProvider.add(row.tipo);
    else tiposDiretos.add(row.tipo);
    choices.push({
      value,
      label: row.label || defaultChoiceLabel(row.tipo, row.provider),
      tipo: row.tipo,
      provider: row.provider,
      isOutro: false,
    });
  }

  // "Outro garantidor…" por tipo que tem garantidores cadastrados, logo depois
  // do último deles.
  const withEscape: GarantiaChoice[] = [];
  for (let i = 0; i < choices.length; i++) {
    withEscape.push(choices[i]);
    const tipo = choices[i].tipo;
    const isLastOfTipo =
      tiposComProvider.has(tipo) &&
      choices[i].provider !== "" &&
      (i === choices.length - 1 || choices[i + 1].tipo !== tipo);
    if (isLastOfTipo) {
      withEscape.push({
        value: `${tipo}${OUTRO_SUFFIX}`,
        label: `${GARANTIA_LABELS[tipo]} — outro garantidor…`,
        tipo,
        provider: "",
        isOutro: true,
      });
    }
  }

  // Modalidades sem garantidor: sempre disponíveis.
  for (const tipo of GARANTIA_TIPOS) {
    if (tiposComProvider.has(tipo) || tiposDiretos.has(tipo)) continue;
    withEscape.push({
      value: tipo,
      label: GARANTIA_LABELS[tipo],
      tipo,
      provider: "",
      isOutro: false,
    });
  }

  return withEscape;
}

export function findGarantiaChoice(
  choices: readonly GarantiaChoice[],
  value: string,
): GarantiaChoice | undefined {
  return choices.find((c) => c.value === value);
}

/**
 * Qual opção representa o que já está gravado no formulário?
 *
 * Garantidor que não está (ou não está mais) no catálogo cai no "Outro
 * garantidor…" com o texto preservado — desativar uma seguradora não pode
 * apagar o que um formulário em andamento já tinha escolhido.
 */
export function selectedGarantiaChoiceValue(
  choices: readonly GarantiaChoice[],
  tipo: unknown,
  provider: unknown,
): string {
  const t = isGarantiaTipo(tipo) ? tipo : "caucao";
  const p = clean(provider);
  if (p) {
    const exact = choices.find((c) => c.tipo === t && c.provider === p && !c.isOutro);
    if (exact) return exact.value;
    const outro = choices.find((c) => c.tipo === t && c.isOutro);
    if (outro) return outro.value;
  }
  const direto = choices.find((c) => c.tipo === t && !c.provider && !c.isOutro);
  if (direto) return direto.value;
  // Tipo só existe como par tipo × garantidor (ex.: seguro-fiança sem provider
  // gravado): o escape hatch é a representação honesta.
  return choices.find((c) => c.tipo === t)?.value ?? choices[0]?.value ?? t;
}
