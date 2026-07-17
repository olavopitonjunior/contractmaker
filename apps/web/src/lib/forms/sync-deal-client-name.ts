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
 * - Sempre converge pro derivado, inclusive null (comprador removido sai do
 *   card).
 * - SKIP comparando com o clientName GRAVADO no Deal (leitura indexada por
 *   formId @unique): hot path anônimo não ganha um write por keystroke, e a
 *   comparação contra o estado real é AUTO-CURATIVA — um write anterior que
 *   falhou (best-effort) é reparado no próximo autosave. (Comparar
 *   prev×next do dataJson não cura: os dois derivam do que já persistiu.)
 * - Best-effort: nunca lança (autosave não pode falhar por causa do card).
 */
export async function syncDealClientName(opts: {
  formId: string;
  schemaType?: string | null;
  mergedData: Record<string, unknown>;
}): Promise<void> {
  try {
    const derive = opts.schemaType?.startsWith("locacao")
      ? deriveLocacaoDealMetadata
      : deriveDealMetadata;
    const next = derive(opts.mergedData, { fallbackTitle: "" }).clientName;
    const deal = await prisma.deal.findUnique({
      where: { formId: opts.formId },
      select: { id: true, clientName: true },
    });
    if (!deal || deal.clientName === next) return;
    await prisma.deal.update({
      where: { id: deal.id },
      data: { clientName: next },
    });
  } catch (err) {
    console.error("[syncDealClientName] falhou (best-effort):", err);
  }
}
