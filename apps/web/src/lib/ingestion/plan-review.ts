/**
 * Revisão humana do `LibraryPlan` — o núcleo PURO entre o planner e o executor.
 *
 * Módulo sem prisma, sem rede e sem fs (client-safe): a tela de revisão e o
 * executor leem exatamente as MESMAS funções. É isso que impede a divergência
 * clássica deste fluxo — a tela mostrar "3 modelos aprovados" e o executor
 * aplicar outra conta.
 *
 * ## Fail-closed é a regra da casa
 *
 * {@link selectApproved} só devolve o item do plano que tem uma entrada
 * `approved: true` no {@link ReviewedLibraryPlan}. Entrada ausente NÃO é
 * "aprovado por omissão": um plano revisado incompleto (versão antiga da tela,
 * payload truncado) aplicaria escrita que ninguém autorizou — e escrita aqui é
 * Doc no Drive e cláusula com embedding, as duas caras de desfazer.
 *
 * ## Por que o recusado não some
 *
 * O que o operador desmarcou fica no plano revisado com `approved: false`. O
 * relatório final precisa conseguir dizer o que FOI recusado: sem isso, "o
 * modelo de locação comercial não apareceu na biblioteca" é indistinguível de
 * "o pipeline perdeu o arquivo".
 */

import {
  LIBRARY_PLAN_VERSION,
  type LibraryPlan,
  type PlanDiscardReason,
  type PlanIssueKind,
  type PlannedClause,
  type PlannedTemplate,
  type ReviewedLibraryPlan,
} from "./library-plan";

// ────────────────────────────────────────────────────────────────────────────
// Identidade dos itens do plano
// ────────────────────────────────────────────────────────────────────────────

/**
 * Forma canônica de um conjunto de tags. Cópia deliberada de `canonicalTagSet`
 * (lib/templates/ingest-clauses.ts) em vez de import: aquele módulo carrega o
 * prisma junto e este roda no browser, dentro da tela de revisão.
 */
function canonicalTags(tags: readonly string[] | null | undefined): string[] {
  const set = new Set<string>();
  for (const tag of tags ?? []) {
    const norm = String(tag).trim().toLowerCase();
    if (norm) set.add(norm);
  }
  return Array.from(set).sort();
}

/** Identidade de um template proposto — o item de origem, como no contrato. */
export function templateKey(template: { sourceItemId: string }): string {
  return template.sourceItemId;
}

/**
 * Identidade de uma cláusula proposta: item de origem + conjunto EXATO de tags.
 *
 * O mesmo arquivo pode render duas cláusulas (a genérica e a da seguradora), e
 * é o conjunto de tags — não o título, que o operador pode reescrever — que as
 * separa no acervo. Mesma chave que `ReviewedLibraryPlan.clauses` carrega.
 */
/**
 * Separador das chaves compostas: U+001F (unit separator), não U+0000 (NUL).
 *
 * NUL é o separador idiomático em memória justamente porque nunca aparece em
 * texto real — mas o Postgres RECUSA NUL em `text`/`jsonb` (erro 22P05), e
 * esta chave viaja dentro do relatório do run. Um separador que quebra a
 * gravação não serve como separador. U+001F tem a mesma propriedade e passa.
 */
export const KEY_SEP = String.fromCharCode(31);

export function clauseKey(clause: {
  sourceItemId: string;
  tags: readonly string[];
}): string {
  return `${clause.sourceItemId}${KEY_SEP}${canonicalTags(clause.tags).join("|")}`;
}

// ────────────────────────────────────────────────────────────────────────────
// Leitura defensiva do que veio do banco / da rede
// ────────────────────────────────────────────────────────────────────────────

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

/**
 * Lê o plano gravado em `IngestionRun.libraryPlan`.
 *
 * Devolve `null` — nunca um plano parcial — quando a versão é desconhecida ou
 * a forma não bate. Executar meio plano é pior que não executar: o operador
 * aprovaria uma biblioteca que não foi a que ele viu.
 */
export function parseLibraryPlan(raw: unknown): LibraryPlan | null {
  if (!isRecord(raw)) return null;
  if (raw.version !== LIBRARY_PLAN_VERSION) return null;

  const templates = Array.isArray(raw.templates) ? raw.templates : [];
  const clauses = Array.isArray(raw.clauses) ? raw.clauses : [];
  const discards = Array.isArray(raw.discards) ? raw.discards : [];
  const issues = Array.isArray(raw.issues) ? raw.issues : [];

  const parsedTemplates = templates.filter(
    (t): t is PlannedTemplate =>
      isRecord(t) &&
      typeof t.sourceItemId === "string" &&
      typeof t.name === "string" &&
      typeof t.modalidade === "string"
  );
  const parsedClauses = clauses.filter(
    (c): c is PlannedClause =>
      isRecord(c) &&
      typeof c.sourceItemId === "string" &&
      typeof c.slot === "string" &&
      typeof c.value === "string" &&
      typeof c.content === "string" &&
      Array.isArray(c.tags)
  );

  return {
    version: LIBRARY_PLAN_VERSION,
    templates: parsedTemplates,
    clauses: parsedClauses,
    discards: discards.filter(
      (d): d is LibraryPlan["discards"][number] =>
        isRecord(d) && typeof d.itemId === "string" && typeof d.reason === "string"
    ),
    issues: issues.filter(
      (i): i is LibraryPlan["issues"][number] =>
        isRecord(i) && typeof i.kind === "string"
    ),
    confidence: typeof raw.confidence === "number" ? raw.confidence : 0,
  };
}

/** Lê o plano revisado (corpo do `/execute` ou `IngestionRun.planReviewed`). */
export function parseReviewedPlan(raw: unknown): ReviewedLibraryPlan | null {
  if (!isRecord(raw)) return null;
  if (typeof raw.reviewedBy !== "string" || typeof raw.reviewedAt !== "string") {
    return null;
  }
  const templates = Array.isArray(raw.templates) ? raw.templates : [];
  const clauses = Array.isArray(raw.clauses) ? raw.clauses : [];
  const discards = Array.isArray(raw.discards) ? raw.discards : [];

  return {
    reviewedBy: raw.reviewedBy,
    reviewedAt: raw.reviewedAt,
    templates: templates
      .filter(isRecord)
      .filter((t) => typeof t.sourceItemId === "string")
      .map((t) => ({
        sourceItemId: t.sourceItemId as string,
        approved: t.approved === true,
      })),
    clauses: clauses
      .filter(isRecord)
      .filter((c) => typeof c.sourceItemId === "string")
      .map((c) => ({
        sourceItemId: c.sourceItemId as string,
        tags: asStringArray(c.tags),
        approved: c.approved === true,
      })),
    discards: discards
      .filter(isRecord)
      .filter((d) => typeof d.itemId === "string")
      .map((d) => ({
        itemId: d.itemId as string,
        approved: d.approved === true,
      })),
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Decisões da tela → plano revisado
// ────────────────────────────────────────────────────────────────────────────

/**
 * O que o operador marcou, por chave. `true` = aplicar (nos descartes, `true` =
 * concordo em descartar).
 */
export interface PlanDecisions {
  templates: Record<string, boolean>;
  clauses: Record<string, boolean>;
  discards: Record<string, boolean>;
}

/**
 * Estado inicial da tela: tudo que o planner propôs vem marcado.
 *
 * A revisão é para VETAR o que está errado, não para reconstruir o plano item a
 * item — um acervo de 60 arquivos com tudo desmarcado é uma tela que o operador
 * abandona.
 */
export function defaultDecisions(plan: LibraryPlan): PlanDecisions {
  return {
    templates: Object.fromEntries(plan.templates.map((t) => [templateKey(t), true])),
    clauses: Object.fromEntries(plan.clauses.map((c) => [clauseKey(c), true])),
    discards: Object.fromEntries(plan.discards.map((d) => [d.itemId, true])),
  };
}

/** Todas as decisões marcadas com o mesmo valor ("aprovar tudo"/"limpar"). */
export function setAllDecisions(plan: LibraryPlan, approved: boolean): PlanDecisions {
  const all = defaultDecisions(plan);
  return {
    templates: Object.fromEntries(
      Object.keys(all.templates).map((k) => [k, approved])
    ),
    clauses: Object.fromEntries(Object.keys(all.clauses).map((k) => [k, approved])),
    // O descarte não é escrita: mantê-lo marcado ao "limpar" evitaria ressuscitar
    // arquivo ilegível sem o operador pedir.
    discards: all.discards,
  };
}

/** Quanto está marcado agora — o número do botão "aplicar". */
export function countApproved(decisions: PlanDecisions): {
  templates: number;
  clauses: number;
  total: number;
} {
  const templates = Object.values(decisions.templates).filter(Boolean).length;
  const clauses = Object.values(decisions.clauses).filter(Boolean).length;
  return { templates, clauses, total: templates + clauses };
}

/** Monta o `ReviewedLibraryPlan` — inclusive o que foi recusado. */
export function buildReviewedPlan(
  plan: LibraryPlan,
  decisions: PlanDecisions,
  meta: { reviewedBy: string; reviewedAt: string }
): ReviewedLibraryPlan {
  return {
    reviewedBy: meta.reviewedBy,
    reviewedAt: meta.reviewedAt,
    templates: plan.templates.map((t) => ({
      sourceItemId: t.sourceItemId,
      approved: decisions.templates[templateKey(t)] === true,
    })),
    clauses: plan.clauses.map((c) => ({
      sourceItemId: c.sourceItemId,
      tags: canonicalTags(c.tags),
      approved: decisions.clauses[clauseKey(c)] === true,
    })),
    discards: plan.discards.map((d) => ({
      itemId: d.itemId,
      approved: decisions.discards[d.itemId] !== false,
    })),
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Seleção do que o executor aplica
// ────────────────────────────────────────────────────────────────────────────

export interface ApprovedSelection {
  templates: PlannedTemplate[];
  clauses: PlannedClause[];
  /** O que o operador recusou — vai íntegro pro relatório final. */
  rejectedTemplates: PlannedTemplate[];
  rejectedClauses: PlannedClause[];
}

/**
 * Cruza o plano com a revisão. Só o que tem `approved: true` explícito entra —
 * ver "fail-closed" no cabeçalho do módulo.
 */
export function selectApproved(
  plan: LibraryPlan,
  reviewed: ReviewedLibraryPlan
): ApprovedSelection {
  const templateApproved = new Set(
    reviewed.templates.filter((t) => t.approved).map((t) => t.sourceItemId)
  );
  const clauseApproved = new Set(
    reviewed.clauses.filter((c) => c.approved).map((c) => clauseKey(c))
  );

  const templates: PlannedTemplate[] = [];
  const rejectedTemplates: PlannedTemplate[] = [];
  for (const t of plan.templates) {
    (templateApproved.has(t.sourceItemId) ? templates : rejectedTemplates).push(t);
  }

  const clauses: PlannedClause[] = [];
  const rejectedClauses: PlannedClause[] = [];
  for (const c of plan.clauses) {
    (clauseApproved.has(clauseKey(c)) ? clauses : rejectedClauses).push(c);
  }

  return { templates, clauses, rejectedTemplates, rejectedClauses };
}

// ────────────────────────────────────────────────────────────────────────────
// Rótulos PT-BR (tela de revisão e relatório)
// ────────────────────────────────────────────────────────────────────────────

export const DISCARD_REASON_LABELS: Record<PlanDiscardReason, string> = {
  duplicate: "Arquivo repetido",
  filled_instance: "Contrato preenchido (não é modelo)",
  unreadable: "Não deu para ler o arquivo",
  out_of_scope: "Fora do escopo da biblioteca",
  pii_unrecoverable: "Dados pessoais que não dá para limpar",
  already_covered: "A biblioteca já cobre este papel",
};

export const ISSUE_KIND_LABELS: Record<PlanIssueKind, string> = {
  classification_conflict: "Conflito de classificação",
  provider_in_template: "Fornecedor dentro do modelo",
  pii_leftover: "Sobrou dado pessoal",
  slot_not_applicable: "Espaço de cláusula não se aplica",
  // Distinto de `low_confidence` de propósito: aqui não é hesitação, é recusa.
  // O motivo concreto vem no `detail` da issue.
  plan_invalid: "Recusado pela verificação automática",
  low_confidence: "Sugestão pouco confiável",
  grouping_ambiguous: "Agrupamento ambíguo",
  // Lacunas de lados opostos, e por isso rótulos que não se confundem: aqui
  // faltou ao PLANNER (o material veio e não coube no índice); ali faltou ao
  // ACERVO (o cliente não mandou o modelo).
  index_truncated: "Decidido sobre parte do material",
  acervo_incompleto: "Acervo incompleto",
};

/**
 * Issues que a tela destaca em vermelho. O critério não é gravidade, é ORDEM: o
 * operador precisa saber disto ANTES de aprovar, e ele continua podendo aprovar
 * mesmo assim.
 *
 * As quatro travam regra de PRODUTO, não de forma: `pii_leftover` é dado de
 * cliente prestes a ganhar embedding, `provider_in_template` é a seguradora
 * grudada no corpo do modelo — o modelo que deveria servir a todas passa a
 * servir a uma —, `plan_invalid` é o plano que os guardrails RECUSARAM e
 * `index_truncated` diz que o plano foi decidido sobre uma AMOSTRA do acervo.
 * Este último entra porque muda o que a aprovação significa: aprovar sabendo
 * que famílias inteiras foram planejadas sem o material completo é uma decisão;
 * aprovar sem saber é um acidente. Os dois últimos precisam ser vermelhos
 * justamente porque o operador tem o poder de aprovar assim mesmo — a tela não
 * pode deixar a ressalva parecer um detalhe.
 */
export const BLOCKING_ISSUE_KINDS: readonly PlanIssueKind[] = [
  "pii_leftover",
  "provider_in_template",
  "plan_invalid",
  "index_truncated",
];

export function isBlockingIssue(kind: PlanIssueKind): boolean {
  return BLOCKING_ISSUE_KINDS.includes(kind);
}
