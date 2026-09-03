import type { TargetKind } from "@/lib/certidoes/types";
import { TARGET_KIND_LABELS, type CertidoesEsteira } from "@/lib/certidoes/target-paths";

/**
 * Agrupamento por PARTE da pop-up de certidões e da aba (redesign 2026-06-10),
 * extraído do `ExtractCertidoesDialog` em 2026-09-03 para servir as duas
 * esteiras e ser testável sem RTL.
 *
 * Venda: Vendedores · Pessoas adicionais · Compradores · Imóvel · Pesquisa.
 * Locação (2026-09-03): Locatários · Fiador (fiador + cônjuge) · Pessoas
 * adicionais · Locadores · Imóvel · Pesquisa. O grupo deriva do targetKind
 * (+ tier para separar imóvel/pesquisa).
 */

export type Tier = "padrao" | "imovel" | "opcional" | "pesquisa";

export type Group =
  | "vendedores"
  | "adicionais"
  | "compradores"
  | "locatarios"
  | "fiador"
  | "locadores"
  | "imovel"
  | "pesquisa";

export const ALL_GROUPS: readonly Group[] = [
  "vendedores",
  "adicionais",
  "compradores",
  "locatarios",
  "fiador",
  "locadores",
  "imovel",
  "pesquisa",
];

const VENDEDOR_KINDS = new Set<string>([
  "vendedor",
  "conjuge_vendedor",
  "procurador_vendedor",
  "representante_vendedor",
]);
const FIADOR_KINDS = new Set<string>(["fiador", "conjuge_fiador"]);

export function groupForJob(j: { targetKind: string; tier?: Tier }): Group {
  if (j.tier === "pesquisa") return "pesquisa";
  if (j.tier === "imovel" || j.targetKind === "imovel") return "imovel";
  if (j.targetKind === "diligenciado") return "adicionais";
  if (VENDEDOR_KINDS.has(j.targetKind)) return "vendedores";
  if (j.targetKind === "locatario") return "locatarios";
  if (FIADOR_KINDS.has(j.targetKind)) return "fiador";
  if (j.targetKind === "locador") return "locadores";
  return "compradores"; // comprador (e fallback defensivo)
}

/**
 * Grupos que nascem pré-marcados: quem paga e quem garante. Venda: vendedores
 * (+ dependentes) e pessoas adicionais; locação: locatários, fiador (+ cônjuge)
 * e pessoas adicionais. Locadores/Compradores/Imóvel/Pesquisa são opt-in — cada
 * pessoa gera ~6-10 consultas pagas.
 */
export function defaultGroupsFor(esteira: CertidoesEsteira): Set<Group> {
  return esteira === "locacao"
    ? new Set<Group>(["locatarios", "fiador", "adicionais"])
    : new Set<Group>(["vendedores", "adicionais"]);
}

export interface SectionDef {
  group: Group;
  title: string;
  desc: string;
  /** Renderização por pessoa × região + controle "Adicionar outro local". */
  kind: "primary" | "adicionais" | "target";
  /** Mensagem quando o grupo está vazio (kind primary). */
  emptyMsg?: string;
}

const VENDA_SECTIONS: readonly SectionDef[] = [
  {
    group: "vendedores",
    title: "Vendedores",
    desc: "Certidões dos vendedores (e dependentes) na região do imóvel e na do endereço deles.",
    kind: "primary",
    emptyMsg: "Nenhum vendedor para diligenciar neste negócio.",
  },
  {
    group: "adicionais",
    title: "Pessoas adicionais",
    desc: "Pessoas externas ao contrato que você incluiu (sócios, avalistas, procuradores).",
    kind: "adicionais",
  },
  {
    group: "compradores",
    title: "Compradores",
    desc: "Certidões dos compradores — inclua se quiser diligenciá-los.",
    kind: "target",
  },
  {
    group: "imovel",
    title: "Imóvel",
    desc: "Matrícula (visualização ONR), IPTU e tributos municipais do imóvel, CCIR.",
    kind: "target",
  },
  {
    group: "pesquisa",
    title: "Pesquisa de bens",
    desc: "Pesquisa de Bens (ONR) e certidões menos comuns.",
    kind: "target",
  },
];

const LOCACAO_SECTIONS: readonly SectionDef[] = [
  {
    group: "locatarios",
    title: "Locatários",
    desc: "Certidões dos locatários na região do imóvel e na do endereço deles — quem paga o aluguel.",
    kind: "primary",
    emptyMsg: "Nenhum locatário com CPF/CNPJ neste negócio.",
  },
  {
    group: "fiador",
    title: "Fiador",
    desc: "Fiador e cônjuge do fiador (art. 1.647, III CC): a execução da fiança atinge o patrimônio do casal.",
    kind: "primary",
    emptyMsg: "Sem fiador identificado — a garantia não é fiança ou o fiador não tem CPF/CNPJ.",
  },
  {
    group: "adicionais",
    title: "Pessoas adicionais",
    desc: "Pessoas externas ao contrato que você incluiu (sócios, avalistas, procuradores).",
    kind: "adicionais",
  },
  {
    group: "locadores",
    title: "Locadores",
    desc: "Certidões dos locadores — inclua se quiser diligenciá-los.",
    kind: "target",
  },
  {
    group: "imovel",
    title: "Imóvel",
    desc: "Matrícula (visualização ONR), IPTU e tributos municipais do imóvel — dívidas do locador.",
    kind: "target",
  },
  {
    group: "pesquisa",
    title: "Pesquisa de bens",
    desc: "Pesquisa de Bens (ONR) do fiador e do cônjuge, e certidões menos comuns.",
    kind: "target",
  },
];

export function sectionsFor(esteira: CertidoesEsteira): readonly SectionDef[] {
  return esteira === "locacao" ? LOCACAO_SECTIONS : VENDA_SECTIONS;
}

/** Seções abertas por padrão = as pré-marcadas; o resto colapsado (menos scroll). */
export function initialOpenSections(esteira: CertidoesEsteira): Record<Group, boolean> {
  const defaults = defaultGroupsFor(esteira);
  return Object.fromEntries(ALL_GROUPS.map((g) => [g, defaults.has(g)])) as Record<Group, boolean>;
}

export function emptyByGroup<T>(): Record<Group, T[]> {
  return Object.fromEntries(ALL_GROUPS.map((g) => [g, [] as T[]])) as Record<Group, T[]>;
}

/** Rótulo PT-BR do alvo — fonte única em lib/certidoes/target-paths.ts. */
export const KIND_LABEL: Record<string, string> = TARGET_KIND_LABELS;

export function isTargetKind(value: string): value is TargetKind {
  return value in TARGET_KIND_LABELS;
}
