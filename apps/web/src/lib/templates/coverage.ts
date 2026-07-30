/**
 * Cobertura de modelos — o painel "Modelos do sistema".
 *
 * É aqui que o front ENSINA o que o sistema espera: quais modelos toda
 * imobiliária precisa ter, quais são opcionais no módulo dela, e em que estado
 * cada um está. Sem isso o tenant descobre que falta um modelo só quando a
 * geração falha com "nenhum template ativo".
 *
 * KIT MÍNIMO (definição do dono): CCV à vista, CCV financiado, proposta de
 * compra e venda, proposta de locação (residencial) e contrato de locação
 * (residencial). Administração e locação comercial são OPCIONAIS — úteis, mas a
 * imobiliária opera sem eles.
 *
 * As linhas são filtradas pelos MÓDULOS habilitados: um tenant só-locação não vê
 * (nem é cobrado por) os modelos de venda.
 *
 * Módulo puro e client-safe.
 */

import {
  CANONICAL_TEMPLATES,
  CANONICAL_MODALIDADES_BY_MODULE,
  type CanonicalModalidade,
} from "./canonical-templates";
import { modalidadeLabel } from "@/lib/contracts/template-category";

/** Modalidades do kit mínimo obrigatório, na ordem em que o painel as mostra. */
export const REQUIRED_KIT_MODALIDADES: CanonicalModalidade[] = [
  "a_vista",
  "financiamento",
  "proposta_venda",
  "proposta_locacao_residencial",
  "locacao",
];

export type CoverageState = "own" | "canonical" | "missing";

export interface CoverageTemplateLite {
  id: string;
  name: string;
  modalidade: string | null;
  status: string;
  engine: string;
  /** SHA-256 do DOCX de origem — só existe em modelo ingerido pela imobiliária. */
  sourceHash?: string | null;
}

export interface CoverageRow {
  modalidade: CanonicalModalidade;
  label: string;
  module: string;
  required: boolean;
  state: CoverageState;
  /** Template que satisfaz a linha (quando `state !== "missing"`). */
  templateId?: string;
  templateName?: string;
}

export interface CoverageReport {
  rows: CoverageRow[];
  requiredTotal: number;
  requiredDone: number;
  /** Kit mínimo completo (o que o passo de onboarding mede). */
  kitComplete: boolean;
}

/** Módulo de cada modalidade canônica (inverso de CANONICAL_MODALIDADES_BY_MODULE). */
const MODULE_BY_MODALIDADE = new Map<string, string>(
  Object.entries(CANONICAL_MODALIDADES_BY_MODULE).flatMap(([mod, mods]) =>
    mods.map((m) => [m as string, mod] as const)
  )
);

/** Nome canônico de cada modalidade — usado pra distinguir seed × modelo do tenant. */
const CANONICAL_NAME_BY_MODALIDADE = new Map<string, string>(
  CANONICAL_TEMPLATES.map((t) => [t.modalidade as string, t.canonicalName])
);

/**
 * "É o modelo DA IMOBILIÁRIA?" — sim quando veio de um DOCX ingerido
 * (`sourceHash`/engine google_docs) ou quando o nome já não é o do canônico
 * (template criado do zero ou renomeado deliberadamente pelo tenant).
 *
 * Só o nome não bastaria: o operador pode editar o conteúdo do canônico sem
 * renomear. Aceitamos esse falso "canônico" — a consequência é o painel
 * convidar a subir o modelo timbrado, que é justamente o que queremos.
 */
export function isOwnTemplate(t: CoverageTemplateLite): boolean {
  if (t.engine === "google_docs") return true;
  if (t.sourceHash) return true;
  const canonicalName = CANONICAL_NAME_BY_MODALIDADE.get(t.modalidade ?? "");
  return canonicalName ? t.name.trim() !== canonicalName : true;
}

/**
 * Estado de cobertura por modalidade, considerando só os módulos habilitados.
 * Templates arquivados/rascunho não contam — o painel espelha o que a GERAÇÃO
 * enxerga (`status: "active"`).
 */
export function computeTemplateCoverage(input: {
  modules: readonly string[];
  templates: CoverageTemplateLite[];
}): CoverageReport {
  const enabled = new Set(input.modules);
  const active = input.templates.filter((t) => t.status === "active");

  const modalidades = CANONICAL_TEMPLATES.map((t) => t.modalidade).filter((m) => {
    const mod = MODULE_BY_MODALIDADE.get(m);
    return mod ? enabled.has(mod) : false;
  });

  // Kit primeiro (na ordem definida), depois os opcionais do módulo.
  const ordered = [
    ...REQUIRED_KIT_MODALIDADES.filter((m) => modalidades.includes(m)),
    ...modalidades.filter((m) => !REQUIRED_KIT_MODALIDADES.includes(m)),
  ];

  const rows: CoverageRow[] = ordered.map((modalidade) => {
    const matches = active.filter((t) => t.modalidade === modalidade);
    const own = matches.find(isOwnTemplate);
    const chosen = own ?? matches[0];
    const state: CoverageState = own ? "own" : chosen ? "canonical" : "missing";
    return {
      modalidade,
      label: modalidadeLabel(modalidade),
      module: MODULE_BY_MODALIDADE.get(modalidade) ?? "",
      required: REQUIRED_KIT_MODALIDADES.includes(modalidade),
      state,
      templateId: chosen?.id,
      templateName: chosen?.name,
    };
  });

  const required = rows.filter((r) => r.required);
  // Canônico ativo JÁ gera contrato — conta como coberto. O painel diferencia
  // visualmente ("modelo do sistema" × "seu modelo") sem transformar o canônico
  // em pendência, senão o onboarding nunca fecharia pra quem está satisfeito
  // com o modelo de fábrica.
  const requiredDone = required.filter((r) => r.state !== "missing").length;

  return {
    rows,
    requiredTotal: required.length,
    requiredDone,
    kitComplete: requiredDone === required.length,
  };
}
