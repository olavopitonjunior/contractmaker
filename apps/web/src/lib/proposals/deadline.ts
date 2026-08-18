import { deadlineBR, type DeadlineInfo } from "@/lib/format/datetime";
import { SIGNED_OR_LATER_STATUSES } from "./status-sets";

/**
 * Prazo da proposta CIENTE do status — o contador só corre enquanto a proposta
 * espera manifestação (pré-assinatura). O banco sempre respeitou isso (o cron
 * só expira EXPIRABLE_STATUSES); a UI usava `deadlineBR(validUntil)` cru e
 * carimbava "vencida" em proposta assinada com data no passado.
 *
 * Regras:
 *  - assinada (parcial ou completa) ou convertida → "já assinada", tom neutro;
 *  - `expirada` → "vencida" (o carimbo terminal, mesmo sem validUntil);
 *  - demais terminais (cancelada/recusadas) → "—" (prazo é irrelevante);
 *  - resto (rascunho, aguardando_aprovacao, falha_envio, enviada, entregue,
 *    visualizada) → contagem normal por data via `deadlineBR`.
 *
 * Mesmo shape de retorno do `deadlineBR` — drop-in nos call-sites. Como lá,
 * é relativo a `now`: chamar SEMPRE no server component (hydration mismatch).
 */
export function proposalDeadline(
  validUntil: string | number | Date | null | undefined,
  status: string,
  now?: number
): DeadlineInfo {
  if (SIGNED_OR_LATER_STATUSES.has(status)) {
    // "já assinada" em prosa — só "assinada" na coluna Prazo lia como enum
    // vazado (achado de QA 2026-08-18).
    return { days: null, tone: "none", label: "já assinada", shortLabel: "já assinada" };
  }
  if (status === "expirada") {
    return { days: null, tone: "danger", label: "vencida", shortLabel: "vencida" };
  }
  if (
    status === "cancelada" ||
    status === "recusada_proponente" ||
    status === "recusada_vendedor"
  ) {
    return { days: null, tone: "none", label: "—", shortLabel: "—" };
  }
  return deadlineBR(validUntil, now);
}
