/**
 * Guardrails determinísticos do `LibraryPlan`.
 *
 * Rodam SOBRE o plano, antes de qualquer escrita, e são a razão de o planner
 * poder ser um LLM: nada do que ele decide chega ao banco sem passar por
 * verificações que não dependem de julgamento.
 *
 * ## Rejeitar, nunca consertar
 *
 * Toda violação REJEITA o plano com motivo. A tentação de "arrumar" (marcar a
 * garantia que falta, desmarcar o segundo `isDefaultSuggested`, cortar o
 * parágrafo que não existe no doc) é exatamente o que não pode acontecer: o
 * conserto seria uma decisão de produto tomada por um `if`, invisível na tela
 * de revisão, e o operador aprovaria uma biblioteca que ninguém desenhou. Um
 * plano recusado custa uma nova tentativa (e, se persistir, revisão humana);
 * um plano consertado em silêncio custa contratos errados.
 *
 * ## O que é verificado aqui e o que não é
 *
 * Aqui: integridade referencial (o item existe? não é descarte?), valores
 * canônicos, as duas regras de produto na forma que o plano consegue carregar
 * (garantia obrigatória em locação; tag de cláusula exata e única) e os gates
 * que protegem escrita irreversível (PII em cláusula, bloco de slot que existe
 * mesmo no documento).
 *
 * Não aqui: se o parágrafo do slot é ÚNICO no Google Doc — quem verifica é
 * `applyClauseSlotToDoc`, contra a estrutura real do documento, e ele é
 * tudo-ou-nada. Duplicar a regra em cima do texto plano só produziria dois
 * veredictos que divergem no primeiro DOCX com formatação picotada.
 *
 * Módulo puro: sem prisma, sem rede, sem LLM.
 */

import {
  GARANTIA_TIPOS,
  isKnownModalidade,
  normalizeGarantiaTipo,
} from "@/lib/contracts/template-category";
import {
  CLAUSE_SLOT_KEYS,
  providerTag,
  slotTagsFor,
  type ClauseSlotKey,
} from "@/lib/templates/clause-slots";
import { toParagraphs } from "@/lib/templates/consolidation";
import { MIN_SLOT_PARAGRAPH_CHARS } from "@/lib/templates/ingestion-triage";
import type { CriteriaField } from "@/lib/templates/ingestion-types";
import { detectPii, hasBlockingPii } from "@/lib/ingestion/pii";
import {
  LIBRARY_PLAN_VERSION,
  type LibraryPlan,
  type PlannedClause,
  type PlannedTemplate,
} from "@/lib/ingestion/library-plan";
import {
  playbookFamilyForModalidade,
  playbookFor,
  type IngestionPlaybook,
} from "@/lib/ingestion/playbooks";

/**
 * Espelho client-safe de `MIN_SLOT_BLOCK_CHARS` (apply-clause-slot.ts, que
 * importa o cliente do Google Docs e não pode ser puxado para um módulo puro).
 * `lib/templates/__tests__/ingestion-triage.test.ts` trava a igualdade dos dois.
 */
export const MIN_SLOT_BLOCK_CHARS = MIN_SLOT_PARAGRAPH_CHARS;

export type PlanViolationKind =
  /** Formato do plano que este código não sabe executar. */
  | "version_mismatch"
  /** `sourceItemId`/`itemId` que não existe no run. */
  | "unknown_source_item"
  /** O plano usa como fonte um item que ele mesmo (ou o run) descartou. */
  | "discarded_source_item"
  /** Locação sem `matchCriteria.garantia` — quebra a regra 1 de produto. */
  | "missing_garantia_criteria"
  | "invalid_modalidade"
  | "invalid_garantia"
  /** Eixo de `matchCriteria` que não existe nesta família. */
  | "criteria_axis_not_applicable"
  /** Mais de um "principal da modalidade" sugerido. */
  | "multiple_defaults"
  /** Slot fora dos slots conhecidos ou dos permitidos pela família. */
  | "slot_not_applicable"
  /** Parágrafo de `slotBlocks` que não existe no documento fonte. */
  | "slot_block_not_found"
  | "slot_block_too_short"
  /** Conjunto de tags que não é exatamente o derivado de slot/valor/provider. */
  | "clause_tags_mismatch"
  /** Duas cláusulas com o MESMO conjunto de tags — o acervo não as distingue. */
  | "duplicate_clause_tags"
  /** Cláusula com PII bloqueante: virar embedding é irreversível. */
  | "clause_pii"
  | "empty_clause_content";

export interface PlanViolation {
  kind: PlanViolationKind;
  /** Item envolvido, quando há um. */
  itemId: string | null;
  /** Frase em PT-BR — vira `PlanIssue.detail` quando o run cai para revisão. */
  detail: string;
}

/** O mínimo que o guardrail precisa saber de cada item do run. */
export interface PlanGuardItem {
  id: string;
  filename?: string;
  /** Texto extraído. Sem ele, `slotBlocks` daquele item não é verificável. */
  text?: string | null;
  /** `IngestionItem.status` — `discarded` desqualifica o item como fonte. */
  status?: string;
  /** Modalidade classificada; resolve qual playbook rege a cláusula do item. */
  modalidade?: string | null;
}

export interface PlanValidationInput {
  plan: LibraryPlan;
  items: readonly PlanGuardItem[];
}

export interface PlanValidationResult {
  ok: boolean;
  violations: PlanViolation[];
}

function violation(
  kind: PlanViolationKind,
  itemId: string | null,
  detail: string
): PlanViolation {
  return { kind, itemId, detail };
}

/** Conjunto de tags como chave comparável — ordem não importa, repetição sim. */
function tagSetKey(tags: readonly string[]): string {
  return Array.from(new Set(tags.map((t) => t.trim()).filter(Boolean)))
    .sort()
    .join("\u0000");
}

function playbookForItemModalidade(
  modalidade: string | null | undefined
): IngestionPlaybook | null {
  const family = playbookFamilyForModalidade(modalidade);
  return family ? playbookFor(family) : null;
}

const CRITERIA_AXES: readonly CriteriaField[] = [
  "garantia",
  "fiadorPessoa",
  "pessoa",
  "admImobiliaria",
];

function checkTemplate(
  template: PlannedTemplate,
  index: number,
  items: Map<string, PlanGuardItem>,
  discarded: ReadonlySet<string>,
  out: PlanViolation[]
): void {
  const label = template.name?.trim() || `modelo #${index + 1}`;
  const item = items.get(template.sourceItemId);

  if (!item) {
    out.push(
      violation(
        "unknown_source_item",
        template.sourceItemId,
        `O modelo "${label}" aponta para um arquivo que não está neste lote.`
      )
    );
    return;
  }
  if (discarded.has(template.sourceItemId) || item.status === "discarded") {
    out.push(
      violation(
        "discarded_source_item",
        template.sourceItemId,
        `O modelo "${label}" seria criado a partir de um arquivo descartado.`
      )
    );
  }

  if (!isKnownModalidade(template.modalidade)) {
    out.push(
      violation(
        "invalid_modalidade",
        template.sourceItemId,
        `O modelo "${label}" tem modalidade desconhecida: "${template.modalidade}".`
      )
    );
    return;
  }

  const playbook = playbookForItemModalidade(template.modalidade);
  const criteria = (template.matchCriteria ?? {}) as Record<string, unknown>;

  if (criteria.garantia != null && !normalizeGarantiaTipo(criteria.garantia)) {
    out.push(
      violation(
        "invalid_garantia",
        template.sourceItemId,
        `O modelo "${label}" declara uma garantia fora da lista: "${String(criteria.garantia)}".`
      )
    );
  } else if (playbook?.requiresGarantia && criteria.garantia == null) {
    out.push(
      violation(
        "missing_garantia_criteria",
        template.sourceItemId,
        `O modelo "${label}" é de locação e não diz para qual garantia ele serve. ` +
          `Sem isso o formulário nunca o escolhe.`
      )
    );
  }

  if (playbook) {
    for (const axis of CRITERIA_AXES) {
      if (criteria[axis] == null) continue;
      if (!playbook.criteriaAxes.includes(axis)) {
        out.push(
          violation(
            "criteria_axis_not_applicable",
            template.sourceItemId,
            `O modelo "${label}" marca o critério "${axis}", que não existe em ${playbook.family}.`
          )
        );
      }
    }
  }

  const blocks = template.slotBlocks ?? {};
  const paragraphs = new Set(toParagraphs(item.text ?? ""));
  for (const [slot, list] of Object.entries(blocks)) {
    if (!(CLAUSE_SLOT_KEYS as readonly string[]).includes(slot)) {
      out.push(
        violation(
          "slot_not_applicable",
          template.sourceItemId,
          `O modelo "${label}" abre um espaço desconhecido: "${slot}".`
        )
      );
      continue;
    }
    if (playbook && !playbook.allowedSlots.includes(slot as ClauseSlotKey)) {
      out.push(
        violation(
          "slot_not_applicable",
          template.sourceItemId,
          `O modelo "${label}" abre o espaço "${slot}", que não se aplica a ${playbook.family}.`
        )
      );
      continue;
    }
    for (const block of list ?? []) {
      if (block.length < MIN_SLOT_BLOCK_CHARS) {
        out.push(
          violation(
            "slot_block_too_short",
            template.sourceItemId,
            `Um trecho do espaço "${slot}" do modelo "${label}" é curto demais ` +
              `(${block.length} caracteres; mínimo ${MIN_SLOT_BLOCK_CHARS}).`
          )
        );
        continue;
      }
      if (!paragraphs.has(block)) {
        out.push(
          violation(
            "slot_block_not_found",
            template.sourceItemId,
            `Um trecho do espaço "${slot}" do modelo "${label}" não existe, ` +
              `literalmente, no documento de origem.`
          )
        );
      }
    }
  }
}

function checkClause(
  clause: PlannedClause,
  index: number,
  items: Map<string, PlanGuardItem>,
  seenTagSets: Map<string, number>,
  out: PlanViolation[]
): void {
  const label = clause.title?.trim() || `cláusula #${index + 1}`;
  const item = items.get(clause.sourceItemId);
  if (!item) {
    out.push(
      violation(
        "unknown_source_item",
        clause.sourceItemId,
        `A cláusula "${label}" aponta para um arquivo que não está neste lote.`
      )
    );
  }

  if (!(CLAUSE_SLOT_KEYS as readonly string[]).includes(clause.slot)) {
    out.push(
      violation(
        "slot_not_applicable",
        clause.sourceItemId,
        `A cláusula "${label}" preenche um espaço desconhecido: "${clause.slot}".`
      )
    );
    return;
  }

  const playbook = playbookForItemModalidade(item?.modalidade);
  if (playbook && !playbook.allowedSlots.includes(clause.slot)) {
    out.push(
      violation(
        "slot_not_applicable",
        clause.sourceItemId,
        `A cláusula "${label}" preenche o espaço "${clause.slot}", que não se ` +
          `aplica a ${playbook.family}.`
      )
    );
  }

  if (clause.slot === "garantia" && !normalizeGarantiaTipo(clause.value)) {
    out.push(
      violation(
        "invalid_garantia",
        clause.sourceItemId,
        `A cláusula "${label}" atende uma garantia fora da lista: "${clause.value}". ` +
          `Valores válidos: ${GARANTIA_TIPOS.join(", ")}.`
      )
    );
  }

  // O conjunto EXATO: as duas tags do slot mais, quando há fornecedor, a tag de
  // provider. É por igualdade deste conjunto que `ingestSlotClauses` decide o
  // que arquivar — uma tag a mais ou a menos e a reingestão duplica o acervo.
  const expected = [
    ...slotTagsFor(clause.slot, clause.value),
    ...(clause.provider ? [providerTag(clause.provider)] : []),
  ];
  const actualKey = tagSetKey(clause.tags ?? []);
  if (actualKey !== tagSetKey(expected)) {
    out.push(
      violation(
        "clause_tags_mismatch",
        clause.sourceItemId,
        `As etiquetas da cláusula "${label}" não batem com o que ela declara. ` +
          `Esperado: ${expected.join(", ")}. Recebido: ${(clause.tags ?? []).join(", ") || "nenhuma"}.`
      )
    );
  }

  const previous = seenTagSets.get(actualKey);
  if (previous !== undefined) {
    out.push(
      violation(
        "duplicate_clause_tags",
        clause.sourceItemId,
        `A cláusula "${label}" tem exatamente as mesmas etiquetas da cláusula ` +
          `#${previous + 1}. O acervo não conseguiria distinguir as duas.`
      )
    );
  } else {
    seenTagSets.set(actualKey, index);
  }

  const content = (clause.content ?? "").trim();
  if (!content) {
    out.push(
      violation(
        "empty_clause_content",
        clause.sourceItemId,
        `A cláusula "${label}" está sem texto.`
      )
    );
    return;
  }
  if (hasBlockingPii(detectPii(content))) {
    out.push(
      violation(
        "clause_pii",
        clause.sourceItemId,
        `A cláusula "${label}" ainda contém dado pessoal. Cláusula vira embedding ` +
          `e isso é irreversível.`
      )
    );
  }
}

/**
 * Valida o plano. `ok: false` ⇒ o plano NÃO pode ser gravado nem oferecido à
 * revisão como está — quem chama tenta de novo (com as violações no prompt) ou
 * escala de modelo.
 */
export function validateLibraryPlan(
  input: PlanValidationInput
): PlanValidationResult {
  const violations: PlanViolation[] = [];
  const { plan } = input;

  if (plan.version !== LIBRARY_PLAN_VERSION) {
    violations.push(
      violation(
        "version_mismatch",
        null,
        `O plano veio na versão ${String(plan.version)}; esta ingestão executa a ` +
          `versão ${LIBRARY_PLAN_VERSION}.`
      )
    );
    return { ok: false, violations };
  }

  const items = new Map(input.items.map((i) => [i.id, i]));
  const discarded = new Set((plan.discards ?? []).map((d) => d.itemId));

  for (const d of plan.discards ?? []) {
    if (!items.has(d.itemId)) {
      violations.push(
        violation(
          "unknown_source_item",
          d.itemId,
          `O plano descarta um arquivo que não está neste lote.`
        )
      );
    }
  }

  const defaultsByModalidade = new Map<string, number>();
  const templates = plan.templates ?? [];
  templates.forEach((template, index) => {
    checkTemplate(template, index, items, discarded, violations);
    if (template.isDefaultSuggested) {
      const n = (defaultsByModalidade.get(template.modalidade) ?? 0) + 1;
      defaultsByModalidade.set(template.modalidade, n);
    }
  });
  for (const [modalidade, count] of defaultsByModalidade) {
    if (count > 1) {
      violations.push(
        violation(
          "multiple_defaults",
          null,
          `O plano sugere ${count} modelos principais para a modalidade ` +
            `"${modalidade}". Só pode haver um.`
        )
      );
    }
  }

  const seenTagSets = new Map<string, number>();
  (plan.clauses ?? []).forEach((clause, index) => {
    checkClause(clause, index, items, seenTagSets, violations);
  });

  return { ok: violations.length === 0, violations };
}
