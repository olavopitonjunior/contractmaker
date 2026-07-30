/**
 * Texto único do tooltip de CTA bloqueado por RBAC (feature Gerente, 2026-07).
 * Fica separado de permissions.ts porque é copy de UI, não parte do contrato de
 * permissões — e é consumido por client components de vendas e locação.
 */
export const NO_PERMISSION_HINT = "Sem permissão — fale com o admin";
