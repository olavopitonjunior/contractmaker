import type { ParticipantRole } from "./participant-token";

/**
 * Mapa role → steps que aquele subtoken deve ver no wizard. Os steps do
 * form principal são (`STEP_LABELS` em `validation.ts`, 7 etapas pós
 * merge Posse/Título no Status/Débitos em 2026-05-16):
 *   0 Documentos       1 Vendedor(es)     2 Comprador(es)
 *   3 Imóvel(is)       4 Imóvel — Status, Posse e Débitos
 *   5 Pagamento        6 Comissão e Config
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
 * Demais steps (status/posse, pagamento, comissão) ficam pro admin no
 * token principal. Comprador não negocia comissão; vendedor não decide
 * meio de pagamento sozinho.
 */

export const ROLE_STEP_INDEXES: Record<ParticipantRole, readonly number[]> = {
  vendedor: [0, 1, 3],
  comprador: [0, 2],
  // Locação (LOCACAO_STEP_LABELS, 7 etapas pós etapa-0 Documentos 2026-06-10):
  //   0 Documentos  1 Locador(es)  2 Locatário(s)  3 Imóvel
  //   4 Aluguel e Reajuste  5 Garantia  6 Confirmação
  // Locador vê o imóvel (matrícula/IPTU); fiador vê a Garantia (qualifica-se
  // dentro dela); aluguel/confirmação ficam pro token principal.
  locador: [0, 1, 3],
  locatario: [0, 2],
  fiador: [0, 5],
};

/**
 * Mapeia STEP_LABELS indexado por role pra reusar com SalesFormWizard via
 * `stepsOverride` prop. Caller pega cada index e renderiza o step component
 * correspondente.
 */
export function getStepIndexesForRole(role: ParticipantRole): readonly number[] {
  return ROLE_STEP_INDEXES[role];
}
