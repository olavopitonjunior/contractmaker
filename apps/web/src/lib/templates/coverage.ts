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
import {
  GARANTIA_LABELS,
  GARANTIA_TIPOS,
  modalidadeLabel,
  parseMatchCriteria,
  templateFamilyForModalidade,
  type GarantiaTipo,
} from "@/lib/contracts/template-category";

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
  /**
   * Critérios de pareamento (`ContractTemplate.matchCriteria`). Opcional: só a
   * matriz modalidade × garantia lê este campo — o painel "Modelos do sistema"
   * segue passando os mesmos campos de antes.
   */
  matchCriteria?: unknown;
  /** Padrão da modalidade — é ele que o painel deve exibir como representante. */
  isDefault?: boolean;
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
  /**
   * Existe um template ativo `isDefault` nesta modalidade? Distingue "tem
   * modelos mas ninguém é o padrão" de "atribuído": a geração usa o padrão
   * como desempate e como fallback quando o formulário não decide — uma
   * modalidade com ativos e sem padrão é um estado que a tela precisa acusar,
   * não esconder atrás do primeiro representante que encontrar.
   */
  defaultAssigned: boolean;
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
    // O representante da linha é o PADRÃO da modalidade — é ele que a geração
    // usa quando o formulário não decide. Mostrar "um modelo qualquer" aqui fez
    // o painel da Ativa exibir o Seguro-Fiança enquanto o padrão era o Fiador:
    // o operador trocou o padrão e a tela pareceu não ter mudado nada.
    const ownDefault = matches.find((t) => t.isDefault === true && isOwnTemplate(t));
    const own = ownDefault ?? matches.find(isOwnTemplate);
    const chosen = own ?? matches.find((t) => t.isDefault === true) ?? matches[0];
    const state: CoverageState = own ? "own" : chosen ? "canonical" : "missing";
    return {
      modalidade,
      label: modalidadeLabel(modalidade),
      module: MODULE_BY_MODALIDADE.get(modalidade) ?? "",
      required: REQUIRED_KIT_MODALIDADES.includes(modalidade),
      state,
      templateId: chosen?.id,
      templateName: chosen?.name,
      defaultAssigned: matches.some((t) => t.isDefault === true),
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

// ────────────────────────────────────────────────────────────────────────────
// Matriz modalidade × garantia
// ────────────────────────────────────────────────────────────────────────────

/**
 * A segunda dimensão da cobertura: GARANTIA.
 *
 * `computeTemplateCoverage` responde "a imobiliária tem um modelo de locação?".
 * Depois da ingestão em lote a pergunta que importa é outra — "tem o modelo de
 * locação COM FIADOR?" —, porque garantia diferente é template físico diferente
 * (`matchCriteria.garantia` é o que `pickTemplateByFacts` elege). Um tenant com
 * um único modelo de locação genérico e cinco garantias no formulário tem
 * cobertura "completa" pelo painel antigo e quatro buracos na prática.
 *
 * A matriz enxerga também o RASCUNHO, e é de propósito: o run de ingestão nasce
 * suggest-only (template `draft`), então o relatório precisa distinguir "você
 * ganhou este modelo, falta ativar" de "este continua faltando".
 */
export type GarantiaCoverageState = "active" | "draft" | "missing";

export interface GarantiaCoverageCell {
  garantia: GarantiaTipo;
  label: string;
  state: GarantiaCoverageState;
  templateId?: string;
  templateName?: string;
}

export interface GarantiaCoverageRow {
  modalidade: string;
  label: string;
  cells: GarantiaCoverageCell[];
  /**
   * Estado do modelo SEM critério de garantia — o genérico da modalidade. Ele
   * não é eleito por fato do formulário (pontua 0 no pareamento); só serve como
   * `isDefault`. Fica separado das células para não fingir que cobre todas.
   */
  genericState: GarantiaCoverageState;
}

export interface GarantiaCoverageReport {
  garantias: GarantiaTipo[];
  rows: GarantiaCoverageRow[];
  /** Células vazias de uma modalidade que a org JÁ começou a cobrir. */
  gaps: Array<{ modalidade: string; garantia: GarantiaTipo; label: string }>;
}

/**
 * Modalidades em que a garantia decide o modelo: as de locação e as propostas
 * de locação (o form de proposta também coleta `garantia.tipo`).
 */
function garantiaAwareModalidades(enabled: ReadonlySet<string>): string[] {
  return CANONICAL_TEMPLATES.map((t) => t.modalidade)
    .filter((m) => {
      const mod = MODULE_BY_MODALIDADE.get(m);
      return mod ? enabled.has(mod) : false;
    })
    .filter(
      (m) =>
        templateFamilyForModalidade(m) === "locacao" ||
        m.startsWith("proposta_locacao")
    );
}

function stateOf(status: string): GarantiaCoverageState | null {
  if (status === "active") return "active";
  if (status === "draft") return "draft";
  return null;
}

/**
 * Matriz modalidade × garantia da org.
 *
 * Recebe os templates NÃO arquivados (ativos e rascunhos) — diferente de
 * `computeTemplateCoverage`, que só olha ativos porque espelha o que a geração
 * enxerga.
 */
export function computeGarantiaCoverage(input: {
  modules: readonly string[];
  templates: CoverageTemplateLite[];
}): GarantiaCoverageReport {
  const enabled = new Set(input.modules);
  const garantias = [...GARANTIA_TIPOS];
  const usable = input.templates.filter((t) => stateOf(t.status) !== null);

  const rows: GarantiaCoverageRow[] = garantiaAwareModalidades(enabled).map(
    (modalidade) => {
      const mine = usable.filter((t) => t.modalidade === modalidade);

      const cells = garantias.map<GarantiaCoverageCell>((garantia) => {
        const matches = mine.filter(
          (t) => parseMatchCriteria(t.matchCriteria)?.garantia === garantia
        );
        // Ativo vence rascunho: o que a geração usa hoje é a informação mais
        // útil na célula.
        const chosen =
          matches.find((t) => t.status === "active") ?? matches[0] ?? null;
        return {
          garantia,
          label: GARANTIA_LABELS[garantia],
          state: chosen ? stateOf(chosen.status)! : "missing",
          templateId: chosen?.id,
          templateName: chosen?.name,
        };
      });

      const generic = mine.filter((t) => !parseMatchCriteria(t.matchCriteria)?.garantia);
      const genericChosen =
        generic.find((t) => t.status === "active") ?? generic[0] ?? null;

      return {
        modalidade,
        label: modalidadeLabel(modalidade),
        cells,
        genericState: genericChosen ? stateOf(genericChosen.status)! : "missing",
      };
    }
  );

  // Buraco só é buraco onde a imobiliária JÁ opera: listar as 7 garantias de uma
  // modalidade que o tenant nunca usou transformaria o relatório num muro de
  // pendências falsas, e a primeira reação a um muro desses é ignorá-lo inteiro.
  const gaps = rows
    .filter((r) => r.cells.some((c) => c.state !== "missing"))
    .flatMap((r) =>
      r.cells
        .filter((c) => c.state === "missing")
        .map((c) => ({ modalidade: r.modalidade, garantia: c.garantia, label: c.label }))
    );

  return { garantias, rows, gaps };
}
