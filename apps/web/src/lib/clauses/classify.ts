/**
 * Núcleo PURO do classificador de cláusulas — sem prisma, sem rede.
 *
 * O classificador pega cláusulas JÁ GRAVADAS (tipicamente criadas à mão pelo
 * botão "Nova cláusula", que grava só título e texto) e propõe o que falta pra
 * elas ficarem no mesmo padrão do acervo curado: esteira, subcategoria, tags do
 * vocabulário, notas para o agente e — opcionalmente — a versão do texto com
 * chaves Handlebars no lugar dos valores literais.
 *
 * ## Disciplina: o LLM propõe, o código decide
 *
 * Nada que o modelo devolve entra no banco sem passar por aqui:
 *  - `isVariable` NÃO é perguntado ao modelo — é derivado do conteúdo;
 *  - `groupCode` é forçado a `null` fora da esteira de venda (G1..G6 é
 *    taxonomia de compra e venda; em locação um grupo é sempre erro);
 *  - `subcategory` é confinada ao eixo da esteira proposta;
 *  - tags passam pelo vocabulário fechado e pelo congelamento por origem;
 *  - tokenização vira `{trecho_literal → chave}` validada contra o catálogo, com
 *    trava de ocorrência única — o modelo NUNCA reescreve o texto livremente.
 *
 * E nada é aplicado sem revisão humana: este módulo produz PROPOSTA, com o
 * valor atual ao lado do proposto, pro revisor ver o diff campo a campo.
 */
import {
  deriveIsVariable,
  CLAUSE_SUBCATEGORY_SUGGESTIONS,
  CLAUSE_GROUP_CODES,
} from "@/lib/clauses/schema";
import {
  areTagsFrozen,
  mergeDescriptiveTags,
  type TagDef,
} from "@/lib/clauses/tag-vocabulary";
import { ESTEIRA_AXIS, type ClauseEsteira } from "@/lib/clauses/taxonomy";
import type { FormModule } from "@/lib/forms/presets";

/** Valor atual × valor proposto, pro diff da tela de revisão. */
export interface Proposed<T> {
  current: T;
  proposed: T;
}

export interface KeyMapping {
  /** Trecho LITERAL do conteúdo atual, copiado exatamente. */
  trecho: string;
  /** Caminho Handlebars, sem as chaves (`aluguel.valor`). */
  chave: string;
  /** `condicional` exige confirmação extra do revisor. */
  tier: "validada" | "condicional";
}

export interface RejectedMapping {
  trecho: string;
  chave: string;
  motivo: "chave_desconhecida" | "trecho_ambiguo" | "trecho_ausente" | "render_falhou";
}

export type ClassificationWarning =
  | { kind: "tags_congeladas"; detail: string }
  | { kind: "pii_detectada"; detail: string }
  | { kind: "chave_condicional"; detail: string }
  | { kind: "contratos_vinculados"; detail: string }
  | { kind: "grupo_descartado"; detail: string };

export interface ClauseClassificationProposal {
  clauseId: string;
  version: 1;
  title: string;
  fields: {
    esteira?: Proposed<string | null>;
    groupCode?: Proposed<string | null>;
    subcategory?: Proposed<string | null>;
    tags?: Proposed<string[]>;
    agentNotes?: Proposed<string | null>;
    isVariable?: Proposed<boolean>;
    content?: Proposed<string> & {
      mappings: KeyMapping[];
      rejected: RejectedMapping[];
    };
  };
  warnings: ClassificationWarning[];
  /** Uma linha em PT-BR, mostrada no card da revisão. */
  reason: string;
}

/** A cláusula como ela está hoje no banco. */
export interface ClauseSnapshot {
  id: string;
  title: string;
  content: string;
  tags: string[];
  source: string | null;
  esteira: string | null;
  groupCode: string | null;
  subcategory: string | null;
  agentNotes: string | null;
  isVariable: boolean;
  /** Quantos contratos referenciam esta cláusula (`ContractClause`). */
  linkedContracts?: number;
}

/** O que o LLM devolve — cru, ainda não confiável. */
export interface RawClassification {
  esteira?: string | null;
  groupCode?: string | null;
  subcategory?: string | null;
  tags?: string[];
  agentNotes?: string | null;
  mappings?: Array<{ trecho: string; chave: string }>;
  reason?: string;
}

/** Serviços determinísticos injetados (mantém este módulo puro e testável). */
export interface ClassifyDeps {
  validateKey: (path: string, esteira: FormModule) => "validada" | "condicional" | "rejeitada";
  applyMapping: (
    content: string,
    trecho: string,
    chave: string
  ) => { ok: true; content: string } | { ok: false; reason: "nao_encontrado" | "ambiguo" };
  assertRendered: (
    content: string,
    esteira: FormModule
  ) => { ok: true } | { ok: false; error: string };
  /** Trechos com cara de PII no conteúdo atual. Só gera aviso, nunca sanitiza. */
  detectPii?: (content: string) => string[];
}

const SUBCATEGORIES = new Set<string>(CLAUSE_SUBCATEGORY_SUGGESTIONS);
const GROUPS = new Set<string>(CLAUSE_GROUP_CODES);
const ESTEIRAS = new Set<string>(["venda", "locacao", "ambas"]);

/** Esteira "efetiva" pra validar chave e eixo: `ambas` valida como venda + locação. */
function resolvableEsteiras(esteira: string | null): FormModule[] {
  if (esteira === "venda") return ["venda"];
  if (esteira === "locacao") return ["locacao"];
  if (esteira === "ambas") return ["venda", "locacao"];
  return [];
}

function changed<T>(current: T, proposed: T): boolean {
  if (Array.isArray(current) && Array.isArray(proposed)) {
    return JSON.stringify(current) !== JSON.stringify(proposed);
  }
  return current !== proposed;
}

/**
 * Constrói a proposta revisável a partir do que o LLM devolveu.
 *
 * Devolve `null` quando não sobrou nenhuma mudança depois dos guardrails — não
 * adianta mostrar ao revisor um card sem diff.
 */
export function buildProposal(
  clause: ClauseSnapshot,
  raw: RawClassification,
  deps: ClassifyDeps
): ClauseClassificationProposal | null {
  const warnings: ClassificationWarning[] = [];
  const fields: ClauseClassificationProposal["fields"] = {};

  // ---- esteira -----------------------------------------------------------
  const rawEsteira =
    typeof raw.esteira === "string" && ESTEIRAS.has(raw.esteira) ? raw.esteira : null;
  const esteira = rawEsteira ?? clause.esteira;
  if (rawEsteira && changed(clause.esteira, rawEsteira)) {
    fields.esteira = { current: clause.esteira, proposed: rawEsteira };
  }

  // ---- groupCode ---------------------------------------------------------
  // G1..G6 é taxonomia de COMPRA E VENDA. Fora dela, o grupo é sempre erro —
  // descartar em código é mais barato que confiar no prompt.
  let groupCode: string | null = null;
  if (esteira === "venda") {
    groupCode =
      typeof raw.groupCode === "string" && GROUPS.has(raw.groupCode) ? raw.groupCode : null;
  } else if (raw.groupCode) {
    warnings.push({
      kind: "grupo_descartado",
      detail: `O modelo sugeriu ${raw.groupCode}, mas grupos G1–G6 só existem em compra e venda.`,
    });
  }
  if (changed(clause.groupCode, groupCode)) {
    fields.groupCode = { current: clause.groupCode, proposed: groupCode };
  }

  // ---- subcategory -------------------------------------------------------
  // Aceita o eixo da esteira (temas de locação) OU as sugestões canônicas.
  const axisCodes = new Set<string>();
  for (const e of resolvableEsteiras(esteira)) {
    for (const g of ESTEIRA_AXIS[e].groups) axisCodes.add(g.code);
  }
  const rawSub = typeof raw.subcategory === "string" ? raw.subcategory.trim() : "";
  const subcategory =
    rawSub && (SUBCATEGORIES.has(rawSub) || axisCodes.has(rawSub)) ? rawSub : null;
  if (subcategory && changed(clause.subcategory, subcategory)) {
    fields.subcategory = { current: clause.subcategory, proposed: subcategory };
  }

  // ---- tags --------------------------------------------------------------
  // Congelamento por origem: a identidade de `seed_curado` e
  // `consolidacao_modelos` é o CONJUNTO EXATO de tags — mexer (inclusive
  // ACRESCENTAR) faz a próxima reingestão duplicar a cláusula em vez de
  // arquivar a anterior.
  const frozen = areTagsFrozen({ source: clause.source, tags: clause.tags });
  if (frozen && raw.tags?.length) {
    warnings.push({
      kind: "tags_congeladas",
      detail:
        "As tags desta cláusula ligam o formulário ao contrato; alterá-las quebraria a reingestão do pacote.",
    });
  }
  const mergedTags = mergeDescriptiveTags(clause.tags, raw.tags ?? [], { frozen });
  if (mergedTags) {
    fields.tags = { current: clause.tags, proposed: mergedTags };
  }

  // ---- agentNotes --------------------------------------------------------
  const notes = typeof raw.agentNotes === "string" ? raw.agentNotes.trim() : "";
  if (notes && changed(clause.agentNotes ?? "", notes)) {
    fields.agentNotes = { current: clause.agentNotes, proposed: notes };
  }

  // ---- content (tokenização) --------------------------------------------
  const mappings: KeyMapping[] = [];
  const rejected: RejectedMapping[] = [];
  let content = clause.content;

  // Sem esteira resolvível não há catálogo contra o que validar chave — então
  // não se tokeniza. Metadados seguem normalmente.
  const validationEsteiras = resolvableEsteiras(esteira);
  if (raw.mappings?.length && validationEsteiras.length > 0) {
    for (const m of raw.mappings) {
      const trecho = typeof m?.trecho === "string" ? m.trecho : "";
      const chave = typeof m?.chave === "string" ? m.chave.trim().replace(/^\{+|\}+$/g, "") : "";
      if (!trecho || !chave) continue;

      // Melhor tier entre as esteiras aplicáveis ("ambas" passa se resolver em
      // qualquer uma das duas).
      const tiers = validationEsteiras.map((e) => deps.validateKey(chave, e));
      const tier = tiers.includes("validada")
        ? "validada"
        : tiers.includes("condicional")
          ? "condicional"
          : "rejeitada";

      if (tier === "rejeitada") {
        rejected.push({ trecho, chave, motivo: "chave_desconhecida" });
        continue;
      }

      const applied = deps.applyMapping(content, trecho, chave);
      if (!applied.ok) {
        rejected.push({
          trecho,
          chave,
          motivo: applied.reason === "ambiguo" ? "trecho_ambiguo" : "trecho_ausente",
        });
        continue;
      }
      content = applied.content;
      mappings.push({ trecho, chave, tier });
    }
  }

  if (mappings.length > 0 && content !== clause.content) {
    // Segunda rede: o texto final tem que compilar de verdade. Se não compila,
    // a proposta de conteúdo INTEIRA cai — os metadados sobrevivem.
    const renderCheck = validationEsteiras
      .map((e) => deps.assertRendered(content, e))
      .find((r) => !r.ok);

    if (renderCheck && !renderCheck.ok) {
      for (const m of mappings) {
        rejected.push({ trecho: m.trecho, chave: m.chave, motivo: "render_falhou" });
      }
      mappings.length = 0;
      content = clause.content;
    }
  }

  if (mappings.length > 0) {
    fields.content = {
      current: clause.content,
      proposed: content,
      mappings,
      rejected,
    };
    if (mappings.some((m) => m.tier === "condicional")) {
      warnings.push({
        kind: "chave_condicional",
        detail:
          "Alguma chave só resolve em parte das modalidades desta esteira — confira o preview antes de aplicar.",
      });
    }
    if ((clause.linkedContracts ?? 0) > 0) {
      warnings.push({
        kind: "contratos_vinculados",
        detail: `${clause.linkedContracts} contrato(s) referenciam esta cláusula — a alteração de texto alcança todos eles.`,
      });
    }
  }

  // ---- isVariable (derivado, nunca do LLM) -------------------------------
  const finalContent = fields.content?.proposed ?? clause.content;
  const isVariable = deriveIsVariable(finalContent);
  if (changed(clause.isVariable, isVariable)) {
    fields.isVariable = { current: clause.isVariable, proposed: isVariable };
  }

  // ---- PII ---------------------------------------------------------------
  // Só AVISA. Cláusula manual costuma trazer nome/CPF literal, mas o "nome"
  // pode ser o da própria imobiliária — quem decide é o humano.
  const pii = deps.detectPii?.(clause.content) ?? [];
  if (pii.length > 0) {
    warnings.push({
      kind: "pii_detectada",
      detail: `Possível dado pessoal no texto (${pii.slice(0, 3).join(", ")}). Confira antes de deixar no acervo.`,
    });
  }

  if (Object.keys(fields).length === 0) return null;

  return {
    clauseId: clause.id,
    version: 1,
    title: clause.title,
    fields,
    warnings,
    reason: (raw.reason ?? "").trim() || "Classificação sugerida a partir do texto da cláusula.",
  };
}

/** Resumo do que muda, pro chip recolhido do card. */
export function diffSummary(p: ClauseClassificationProposal): string[] {
  const out: string[] = [];
  if (p.fields.esteira) out.push("esteira");
  if (p.fields.groupCode) out.push("grupo");
  if (p.fields.subcategory) out.push("tema");
  if (p.fields.tags) out.push(`+${p.fields.tags.proposed.length - p.fields.tags.current.length} tags`);
  if (p.fields.agentNotes) out.push("notas do agente");
  if (p.fields.content) out.push(`${p.fields.content.mappings.length} chave(s)`);
  return out;
}

/** Vocabulário oferecido ao modelo, já recortado pela esteira. */
export function promptVocabularyFor(
  esteira: ClauseEsteira | null,
  all: readonly TagDef[]
): readonly TagDef[] {
  if (!esteira) return all;
  return all.filter((d) => d.esteiras.includes(esteira) || d.esteiras.includes("ambas"));
}
