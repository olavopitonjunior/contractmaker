import type { DocumentCardStatus } from "@/components/forms/DocumentCard";

/**
 * Status do FormAttachment no servidor (coluna `status`).
 * - awaiting_user: doc subido, OCR NÃO disparada — extração é on-demand
 *   ("Extrair com IA"); nem o POST de upload nem o cron enfileiram.
 * - queued/extracting: worker em andamento (só entra via /retry ou cron).
 */
export type AttachmentServerStatus =
  | "awaiting_user"
  | "queued"
  | "extracting"
  | "ready"
  | "failed";

/**
 * Mapeamento canônico servidor → card. Fonte única de verdade usada pelos
 * TRÊS caminhos do DocumentosStep (hidratação, polling e upload fresco) —
 * eles já divergiram uma vez (upload hardcodava "extracting" e o card ficava
 * em "Analisando…" eterno porque a OCR on-demand nunca era disparada).
 */
export function mapAttachmentStatusToCard(
  serverStatus: string | null | undefined,
  hasFields: boolean
): DocumentCardStatus {
  switch (serverStatus) {
    case "ready":
      return "ready";
    case "failed":
      return "failed";
    case "awaiting_user":
      return "awaiting";
    case "queued":
    case "extracting":
      return "extracting";
    default:
      // Status desconhecido/ausente (rows antigas): com fields extraídos
      // trata como pronto; sem, aguarda decisão do usuário.
      return hasFields ? "ready" : "awaiting";
  }
}
