import type { ParticipantRole } from "./participant-token";

/**
 * Mapa role → steps que aquele subtoken deve ver no wizard. Os steps do
 * form principal são (`STEP_LABELS` em `validation.ts`):
 *   0 Documentos       1 Vendedor(es)     2 Comprador(es)
 *   3 Imóvel(is)       4 Status/Débitos   5 Pagamento
 *   6 Posse/Título     7 Comissão e Config
 *
 * Vendedor:
 *   - 0 Documentos (filtrado por participantId no upload)
 *   - 1 Vendedor (próprios dados)
 *   - 3 Imóvel (vendedor é quem tem matrícula/IPTU em mãos)
 *
 * Comprador:
 *   - 0 Documentos (filtrado)
 *   - 2 Comprador
 *
 * Demais steps (status, pagamento, posse, comissão) ficam pro admin no
 * token principal. Comprador não negocia comissão; vendedor não decide
 * meio de pagamento sozinho.
 */

export const ROLE_STEP_INDEXES: Record<ParticipantRole, readonly number[]> = {
  vendedor: [0, 1, 3],
  comprador: [0, 2],
};

/**
 * Mapeia STEP_LABELS indexado por role pra reusar com SalesFormWizard via
 * `stepsOverride` prop. Caller pega cada index e renderiza o step component
 * correspondente.
 */
export function getStepIndexesForRole(role: ParticipantRole): readonly number[] {
  return ROLE_STEP_INDEXES[role];
}
