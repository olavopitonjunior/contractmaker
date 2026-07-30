/**
 * Slots de cláusula — o único mecanismo novo na GERAÇÃO.
 *
 * Depois da consolidação (ver `lib/templates/consolidation.ts`), a base comum de
 * N modelos quase idênticos vira UM template e os blocos divergentes viram
 * cláusulas do acervo, cada uma amarrada a uma opção do formulário por TAG. Na
 * geração, o template declara um marcador e nós o substituímos pela cláusula
 * cuja tag casa com a escolha do form.
 *
 * Contrato do mecanismo (deliberadamente ADITIVO):
 *
 *  1. O template DECLARA o slot escrevendo `{{{slot_garantia}}}` no
 *     `handlebarsSource` (engine handlebars) ou `{{slot_garantia}}` no Google Doc
 *     — nesse caso o `handlebarsSource` (que é só um comentário) carrega a
 *     declaração `<!-- slots: {{slot_garantia}} -->`, escrita pela consolidação.
 *     É por isso que `detectClauseSlots` lê SEMPRE do `handlebarsSource`: uma
 *     única fonte de verdade pras duas engines, sem coluna nova no schema.
 *  2. Template SEM marcador → `resolveClauseSlots` devolve `{}` sem tocar o
 *     banco. Os canônicos (que resolvem garantia por `{{#if}}` embutido) seguem
 *     byte-a-byte iguais — é a garantia de não-regressão.
 *  3. Com marcador e COM cláusula no acervo → o slot recebe a cláusula do
 *     tenant, renderizada com os mesmos helpers Handlebars do contrato.
 *  4. Com marcador e SEM cláusula → o slot recebe a CONDICIONAL EMBUTIDA DO
 *     CANÔNICO (o mesmo switch de `composed-blocks`). Nunca sai buraco.
 *
 * Tags no `KnowledgeItem`: `slot:garantia` (qual slot) + `garantia:<tipo>` (qual
 * opção do form). Os tipos são os do `garantiaSchema` — mesma fonte do <select>
 * da triagem, do form e do `matchCriteria`.
 */

import { htmlToPlainText, clausulaGarantiaHtml } from "./composed-blocks";
import { renderContratoHTML } from "@/lib/render/handlebars";
import {
  deriveTemplateFacts,
  GARANTIA_LABELS,
  type GarantiaTipo,
} from "@/lib/contracts/template-category";

/** Slots conhecidos. Slot novo = entrada nova em `CLAUSE_SLOTS`. */
export const CLAUSE_SLOT_KEYS = ["garantia"] as const;
export type ClauseSlotKey = (typeof CLAUSE_SLOT_KEYS)[number];

/** Prefixo da tag que marca a cláusula como conteúdo de um slot. */
export const SLOT_TAG_PREFIX = "slot:";

/** `slot:garantia` — presente em toda cláusula que preenche o slot de garantia. */
export function slotTag(slot: ClauseSlotKey): string {
  return `${SLOT_TAG_PREFIX}${slot}`;
}

/** `garantia:fiador` — a opção do formulário que seleciona esta cláusula. */
export function slotValueTag(slot: ClauseSlotKey, value: string): string {
  return `${slot}:${value}`;
}

/** As duas tags de uma cláusula de slot, na ordem em que são gravadas. */
export function slotTagsFor(slot: ClauseSlotKey, value: string): string[] {
  return [slotTag(slot), slotValueTag(slot, value)];
}

/** Token do slot dentro do template/Doc (`slot_garantia`). */
export function slotToken(slot: ClauseSlotKey): string {
  return `slot_${slot}`;
}

/** Marcador que a consolidação escreve no template Handlebars. */
export function slotMarkerHandlebars(slot: ClauseSlotKey): string {
  return `{{{${slotToken(slot)}}}}`;
}

/**
 * Declaração escrita no `handlebarsSource` de um template engine="google_docs"
 * (cujo "source" é só um comentário — o conteúdo real vive no Drive).
 */
export function slotDeclarationComment(slots: ClauseSlotKey[]): string {
  if (slots.length === 0) return "";
  return `<!-- slots: ${slots.map((s) => `{{${slotToken(s)}}}`).join(" ")} -->`;
}

/**
 * Slots declarados numa fonte de template. Casa `{{slot_x}}` e `{{{slot_x}}}`
 * (inclusive dentro de comentário HTML — é como a engine google_docs declara).
 */
export function detectClauseSlots(source: string | null | undefined): ClauseSlotKey[] {
  if (!source) return [];
  const found = new Set<ClauseSlotKey>();
  for (const slot of CLAUSE_SLOT_KEYS) {
    const re = new RegExp(`\\{\\{\\{?\\s*${slotToken(slot)}\\s*\\}?\\}\\}`);
    if (re.test(source)) found.add(slot);
  }
  return CLAUSE_SLOT_KEYS.filter((s) => found.has(s));
}

// ────────────────────────────────────────────────────────────────────────────
// Definição dos slots
// ────────────────────────────────────────────────────────────────────────────

interface ClauseSlotDef {
  key: ClauseSlotKey;
  /** Rótulo PT-BR do slot (UI da triagem). */
  label: string;
  /** Opção do formulário que seleciona a cláusula, ou null se indeterminada. */
  selectedValue(data: Record<string, unknown>): string | null;
  /** Rótulo humano de uma opção (badge na UI, título da cláusula criada). */
  valueLabel(value: string): string;
  /** Condicional embutida do canônico — o fallback quando o acervo não cobre. */
  fallbackHtml(data: Record<string, unknown>): string;
}

const GARANTIA_SLOT: ClauseSlotDef = {
  key: "garantia",
  label: "Cláusula de garantia",
  // Mesma leitura que escolhe o template por `matchCriteria` — o slot e a
  // seleção de variante NUNCA podem discordar sobre qual é a garantia do form.
  selectedValue: (data) => deriveTemplateFacts(data).garantia,
  valueLabel: (value) => GARANTIA_LABELS[value as GarantiaTipo] ?? value,
  fallbackHtml: (data) => clausulaGarantiaHtml(data),
};

export const CLAUSE_SLOTS: Record<ClauseSlotKey, ClauseSlotDef> = {
  garantia: GARANTIA_SLOT,
};

/** Opções oferecidas na triagem pra rotular uma variante deste slot. */
export function slotLabel(slot: ClauseSlotKey): string {
  return CLAUSE_SLOTS[slot].label;
}

// ────────────────────────────────────────────────────────────────────────────
// Resolução na geração
// ────────────────────────────────────────────────────────────────────────────

/** Superfície mínima do prisma consumida aqui (facilita o stub nos testes). */
export type ClauseSlotDb = {
  knowledgeItem: {
    /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
    findMany: (args: any) => Promise<unknown>;
  };
};

export interface ResolveClauseSlotsInput {
  orgId: string;
  /** `ContractTemplate.handlebarsSource` — onde o slot é declarado. */
  templateSource: string | null | undefined;
  /** dataJson JÁ enriquecido (o mesmo que alimenta o render). */
  data: Record<string, unknown>;
  /**
   * `html` para engine="handlebars" (o valor entra no render como raw HTML);
   * `text` para engine="google_docs" (replaceAllText insere TEXTO — `\n` vira
   * parágrafo herdando o estilo, que é o que preserva o timbrado do modelo).
   */
  format: "html" | "text";
  db?: ClauseSlotDb;
}

export interface ResolvedClauseSlot {
  slot: ClauseSlotKey;
  /** Opção do form lida do dataJson (null = form não informou). */
  value: string | null;
  /** De onde veio o conteúdo. */
  source: "knowledge" | "fallback";
  knowledgeItemId?: string;
}

export interface ResolveClauseSlotsResult {
  /** `{ slot_garantia: "<conteúdo>" }` — pronto pra fundir no dataJson/no mapa. */
  values: Record<string, string>;
  resolved: ResolvedClauseSlot[];
}

const EMPTY: ResolveClauseSlotsResult = { values: {}, resolved: [] };

/**
 * Resolve os slots declarados por um template. Template sem slot NÃO toca o
 * banco e devolve `{}` — a geração segue exatamente como antes.
 *
 * Best-effort por design: qualquer falha na consulta ao acervo cai no fallback
 * canônico. Um contrato com a cláusula genérica é infinitamente melhor que uma
 * geração que morre.
 */
export async function resolveClauseSlots(
  input: ResolveClauseSlotsInput
): Promise<ResolveClauseSlotsResult> {
  const slots = detectClauseSlots(input.templateSource);
  if (slots.length === 0) return EMPTY;

  const db = input.db ?? ((await import("@/lib/db/prisma")).prisma as ClauseSlotDb);
  const values: Record<string, string> = {};
  const resolved: ResolvedClauseSlot[] = [];

  for (const slot of slots) {
    const def = CLAUSE_SLOTS[slot];
    const value = def.selectedValue(input.data);

    let html: string | null = null;
    let knowledgeItemId: string | undefined;

    if (value) {
      try {
        const rows = (await db.knowledgeItem.findMany({
          where: {
            orgId: input.orgId,
            category: "clause",
            status: "approved",
            tags: { hasEvery: slotTagsFor(slot, value) },
          },
          select: { id: true, content: true },
          // Mais recente vence: reingerir o modelo atualiza a cláusula do slot
          // sem obrigar o operador a apagar a antiga.
          orderBy: { updatedAt: "desc" },
          take: 1,
        })) as Array<{ id: string; content: string }>;
        const hit = rows?.[0];
        if (hit?.content) {
          // A cláusula do acervo é Handlebars como qualquer outra (o agente já
          // as insere assim) — renderizar aqui é o que faz `{{aluguel.valor}}`
          // dentro dela virar valor.
          html = renderContratoHTML(hit.content, input.data);
          knowledgeItemId = hit.id;
        }
      } catch (err) {
        console.error("[clause-slots] consulta ao acervo falhou:", err);
      }
    }

    if (html == null) {
      html = def.fallbackHtml(input.data);
    }

    values[slotToken(slot)] = input.format === "text" ? htmlToPlainText(html) : html;
    resolved.push({
      slot,
      value,
      source: knowledgeItemId ? "knowledge" : "fallback",
      knowledgeItemId,
    });
  }

  return { values, resolved };
}
