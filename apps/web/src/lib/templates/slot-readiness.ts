/**
 * "O acervo já sustenta os espaços de cláusula deste modelo?" — a trava da
 * ATIVAÇÃO.
 *
 * ## O buraco que isto fecha
 *
 * Um template com slot aberto não tem, no próprio corpo, a cláusula que saiu:
 * quem a devolve na geração é `resolveClauseSlots`, e ele só enxerga cláusula
 * `approved`. A ingestão em lote é suggest-only — o modelo nasce `draft` e a
 * cláusula nasce `pending` —, então existe uma sequência em que o operador
 * ativa o modelo ANTES de aprovar a cláusula. Nela, o contrato sai com o texto
 * canônico da plataforma no lugar da redação da imobiliária, em silêncio: o
 * documento fica plausível, assinável e errado.
 *
 * Enquanto o modelo é `draft` o slot aberto é inofensivo (a seleção de template
 * na geração filtra por `status: "active"`). Por isso a checagem mora na
 * ativação, e não na criação.
 *
 * ## Por que só a cláusula DO TENANT conta
 *
 * `resolveClauseSlots` cai para o acervo da PLATAFORMA quando a org não tem
 * cláusula elegível. Isso salva a geração de quebrar, mas não é o que o
 * operador acha que está ativando: o texto que sai é o nosso, não o dele. A
 * trava mede exatamente a promessa que a tela fez — "a redação de vocês entra
 * no lugar do espaço" — e por isso consulta só `orgId` da imobiliária.
 *
 * A saída consciente existe e é legítima: quem não tem redação própria vive
 * bem com o texto padrão. O que não pode é isso acontecer sem ninguém saber.
 */

import {
  CLAUSE_SLOTS,
  detectClauseSlots,
  slotTag,
  slotTagsFor,
  type ClauseSlotKey,
} from "./clause-slots";
import { parseMatchCriteria } from "@/lib/contracts/template-category";

/** Superfície mínima do Prisma consumida aqui (facilita o stub nos testes). */
export type SlotClauseDb = {
  knowledgeItem: {
    /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
    findMany: (args: any) => Promise<unknown>;
  };
};

export interface SlotClauseGap {
  slot: ClauseSlotKey;
  /** Opção do formulário que este modelo fixa, ou null (vale para qualquer). */
  value: string | null;
  /** Tags que a cláusula precisaria ter para atender este modelo. */
  tags: string[];
  /** Rótulo PT-BR do que falta ("Cláusula de garantia · Seguro fiança"). */
  label: string;
}

export interface SlotReadiness {
  slots: ClauseSlotKey[];
  gaps: SlotClauseGap[];
  ready: boolean;
}

/**
 * Qual opção do formulário este modelo vai trazer para o slot.
 *
 * Quando o `matchCriteria` fixa a garantia, o modelo só é eleito para AQUELA
 * opção — então a cláusula que importa é a daquela opção, não "qualquer uma do
 * slot". Sem critério, o modelo pode cair em qualquer garantia e basta existir
 * cláusula do slot.
 */
export function expectedSlotValue(
  slot: ClauseSlotKey,
  matchCriteria: unknown
): string | null {
  if (slot !== "garantia") return null;
  return parseMatchCriteria(matchCriteria)?.garantia ?? null;
}

/** Tags que a cláusula precisa ter para atender este slot neste modelo. */
export function requiredSlotTags(
  slot: ClauseSlotKey,
  value: string | null
): string[] {
  return value ? slotTagsFor(slot, value) : [slotTag(slot)];
}

export function slotGapLabel(slot: ClauseSlotKey, value: string | null): string {
  const def = CLAUSE_SLOTS[slot];
  return value ? `${def.label} · ${def.valueLabel(value)}` : def.label;
}

/**
 * Os espaços de cláusula deste modelo estão cobertos pelo acervo APROVADO da
 * imobiliária?
 *
 * `ready: true` também para modelo sem slot nenhum — é o caminho comum, e ele
 * não paga consulta ao banco.
 */
export async function checkSlotClauseReadiness(input: {
  orgId: string;
  handlebarsSource: string | null | undefined;
  matchCriteria: unknown;
  db?: SlotClauseDb;
}): Promise<SlotReadiness> {
  const slots = detectClauseSlots(input.handlebarsSource);
  if (slots.length === 0) return { slots, gaps: [], ready: true };

  const db =
    input.db ?? ((await import("@/lib/db/prisma")).prisma as unknown as SlotClauseDb);

  const gaps: SlotClauseGap[] = [];
  for (const slot of slots) {
    const value = expectedSlotValue(slot, input.matchCriteria);
    const tags = requiredSlotTags(slot, value);
    const hits = (await db.knowledgeItem.findMany({
      where: {
        orgId: input.orgId,
        category: "clause",
        status: "approved",
        // Só a RAIZ, como em `resolveClauseSlots`: linha-filha de item chunkado
        // herda as tags e faria a trava passar por um pedaço de cláusula.
        parentId: null,
        tags: { hasEvery: tags },
      },
      select: { id: true },
      take: 1,
    })) as Array<{ id: string }> | null;

    if (!hits || hits.length === 0) {
      gaps.push({ slot, value, tags, label: slotGapLabel(slot, value) });
    }
  }

  return { slots, gaps, ready: gaps.length === 0 };
}

/** Mensagem PT-BR da trava — diz o EFEITO, não a regra. */
export function slotClauseGapMessage(gaps: readonly SlotClauseGap[]): string {
  if (gaps.length === 0) return "";
  const lista = gaps.map((g) => g.label.toLowerCase()).join(", ");
  return (
    `Este modelo tem um espaço de cláusula (${lista}) e ainda não há cláusula ` +
    `aprovada no acervo da sua imobiliária para ele — o contrato sairia com o ` +
    `texto padrão da plataforma no lugar da redação de vocês. Aprove a cláusula ` +
    `no acervo e ative de novo, ou ative mesmo assim se o texto padrão serve.`
  );
}
