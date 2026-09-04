/**
 * Aplica, NA CONVERSÃO, o OCR dos anexos da proposta sobre o `dataJson` que
 * vai virar o SalesForm/Deal — sem redigitar CPF, nascimento, endereço.
 *
 * Regras (paridade com o `DocumentosStep` do formulário):
 *   - só anexo `status === "ready"` com `fields`;
 *   - só assignment HUMANO (`assignmentPersisted: true`) — sugestão do OCR não
 *     escreve no dado do negócio;
 *   - ordem de `createdAt` (o mais novo por último);
 *   - `skipIfDirty`: campo já preenchido na proposta não é sobrescrito;
 *   - locação: mover para o fiador definiu a modalidade (`applyFiadorFlip`
 *     dentro de `applyExtractedToDataJson`).
 *
 * Não muta o input. Devolve o merge e quantos campos entraram (para o evento
 * `converted`). Fora de venda/locação, devolve o dado intacto.
 */

import { applyExtractedToDataJson } from "@/lib/forms/apply-extracted-to-datajson";
import { readAttachmentExtracted } from "./attachment-assignment";

export interface ExtractionSource {
  id: string;
  status: string | null;
  extractedData: unknown;
  createdAt: Date | string;
}

export function applyProposalExtractions(
  dataJson: Record<string, unknown>,
  attachments: ExtractionSource[],
  kind: string
): { merged: Record<string, unknown>; filled: number; applied: string[] } {
  const esteira = kind === "locacao" ? "locacao" : kind === "venda" ? "venda" : null;
  if (!esteira) return { merged: dataJson, filled: 0, applied: [] };

  const ordered = [...attachments].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );
  let merged = dataJson;
  let filled = 0;
  const applied: string[] = [];
  for (const att of ordered) {
    if (att.status !== "ready") continue;
    const view = readAttachmentExtracted(att.extractedData);
    if (!view.fields || !view.assignmentPersisted) continue;
    if (view.assignment.kind === "outro") continue;
    const r = applyExtractedToDataJson(
      merged,
      { category: view.category, fields: view.fields },
      view.assignment,
      { skipIfDirty: true, kind: esteira }
    );
    merged = r.merged;
    if (r.filled > 0) {
      filled += r.filled;
      applied.push(att.id);
    }
  }
  return { merged, filled, applied };
}
