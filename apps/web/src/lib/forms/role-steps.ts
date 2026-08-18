import type { ParticipantRole } from "./participant-token";
import { DEFAULT_ROLE_STEPS } from "./participant-visibility";

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

// Desde 2026-08 a fonte de verdade dos DEFAULTS é
// lib/forms/participant-visibility.ts (DEFAULT_ROLE_STEPS) — e o valor
// EFETIVO por org vem de resolveParticipantScope (config em
// OrgFormSettings.participantVisibilityJson). Este re-export existe pra os
// consumidores estáticos (testes, docs) não terem uma segunda cópia.
export const ROLE_STEP_INDEXES: Record<ParticipantRole, readonly number[]> =
  DEFAULT_ROLE_STEPS;

/**
 * Mapeia STEP_LABELS indexado por role pra reusar com SalesFormWizard via
 * `stepsOverride` prop. Caller pega cada index e renderiza o step component
 * correspondente.
 */
export function getStepIndexesForRole(role: ParticipantRole): readonly number[] {
  return ROLE_STEP_INDEXES[role];
}

/**
 * Versão tolerante pra QUALQUER role. Nativo → o mesmo array de sempre.
 *
 * Terceiro (`terceiro:<slug>`) não tem step do wizard: a tela dele é um único
 * formulário genérico montado a partir das field defs da categoria
 * (`TerceiroStep`), fora da numeração de `STEP_LABELS`. Devolver `[]` é o
 * sinal de "não é wizard" — e também o fallback seguro pra role desconhecido.
 */
export function resolveRoleSteps(role: string): readonly number[] {
  return ROLE_STEP_INDEXES[role as ParticipantRole] ?? [];
}
