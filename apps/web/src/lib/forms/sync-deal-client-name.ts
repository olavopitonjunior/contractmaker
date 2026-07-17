import { prisma } from "@/lib/db/prisma";
import {
  deriveDealMetadata,
  deriveLocacaoDealMetadata,
} from "@/lib/contracts/derive-deal-metadata";

/**
 * Sincroniza `Deal.clientName` (nome denormalizado do card do kanban) a partir
 * do dataJson do form. Ponto ÚNICO usado pelos 3 PATCHes públicos que mutam o
 * dataJson (token principal de vendas, locação e subtoken por parte) — o
 * kanban não lê mais `form.dataJson` ao vivo, então todo caminho de escrita
 * precisa passar por aqui.
 *
 * - Deriva por schemaType (locacao_* → variante de locação).
 * - Sempre grava o derivado, inclusive null (comprador removido sai do card).
 * - SKIP quando o nome não mudou: é hot path anônimo (autosave por etapa) —
 *   comparar prev×next é CPU puro e evita um write de Deal por keystroke.
 * - Best-effort: nunca lança (autosave não pode falhar por causa do card).
 */
export async function syncDealClientName(opts: {
  formId: string;
  schemaType?: string | null;
  previousData: Record<string, unknown>;
  mergedData: Record<string, unknown>;
}): Promise<void> {
  try {
    const derive = opts.schemaType?.startsWith("locacao")
      ? deriveLocacaoDealMetadata
      : deriveDealMetadata;
    const next = derive(opts.mergedData, { fallbackTitle: "" }).clientName;
    const prev = derive(opts.previousData, { fallbackTitle: "" }).clientName;
    if (next === prev) return;
    await prisma.deal.updateMany({
      where: { formId: opts.formId },
      data: { clientName: next },
    });
  } catch (err) {
    console.error("[syncDealClientName] falhou (best-effort):", err);
  }
}
