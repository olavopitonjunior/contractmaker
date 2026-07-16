import { costCentsForMethod } from "@/lib/clicksign/costs";
import type { AuthMethod } from "@/lib/clicksign/types";

/**
 * Custo planejado TOTAL de uma proposta, para reservar no /send.
 *
 * A conta é `custo_por_assinatura × nº de signatários`, com ou sem ocultação:
 * cada pessoa assina exatamente UMA vez — na via única todos assinam o mesmo
 * documento; nas duas vias o proponente assina a completa e o proprietário a
 * reduzida. O total de assinaturas é o mesmo.
 *
 * O que muda com a ocultação é o MOMENTO: o envelope 2 só nasce dias depois, no
 * `close` do envelope 1. Por isso a reserva é feita AGORA, pelo total — senão o
 * envelope 2 estouraria o teto com o proponente já tendo assinado e pago.
 *
 * `authMethod` é o método de assinatura (o que a ClickSign cobra). O canal de
 * notificação (WhatsApp) é eixo à parte; se cobrado, entra via
 * `costOverridesJson` da org.
 */
export function plannedProposalCostCents(input: {
  signerCount: number; // total de signatários (proponente + proprietários + …)
  authMethod?: AuthMethod;
  costOverrides?: Record<string, unknown> | null;
}): number {
  const method: AuthMethod = input.authMethod ?? "email";
  return costCentsForMethod(method, input.costOverrides) * input.signerCount;
}

/**
 * Custo do Aceite via WhatsApp (instrumento "aceite"): R$0,99 por destinatário,
 * cobrado na entrega. Um aceite por signatário notificado.
 */
export const ACCEPTANCE_COST_CENTS = 99;

export function plannedAcceptanceCostCents(signerCount: number): number {
  return ACCEPTANCE_COST_CENTS * signerCount;
}
