/**
 * Papéis ("Assinar como" / qualificação) ClickSign v3. Módulo client-safe
 * (sem imports de servidor) pra ser usado tanto pelos dialogs no client
 * quanto pelo executor/envelopes no server. Os valores são enviados verbatim
 * pro ClickSign no requirement `action:"agree"` (`attributes.role`) — todos
 * existem no enum de qualificações da ClickSign v3.
 */
export type ClicksignRole =
  | "sign"
  | "buyer"
  | "seller"
  | "intervening"
  | "realestate"
  | "witness"
  | "consenting"
  | "attorney"
  | "party";

/** Opções exibidas no dropdown "Assina como" (ordem amigável pro corretor). */
export const CLICKSIGN_ROLE_OPTIONS: Array<{ value: ClicksignRole; label: string }> = [
  { value: "buyer", label: "Comprador" },
  { value: "seller", label: "Vendedor" },
  { value: "consenting", label: "Anuente" },
  { value: "party", label: "Interessado" },
  { value: "attorney", label: "Advogado" },
  { value: "intervening", label: "Intermediador" },
  { value: "witness", label: "Testemunha" },
  { value: "sign", label: "Assinante" },
  { value: "realestate", label: "Imobiliária" },
];

const ROLE_LABEL = new Map(CLICKSIGN_ROLE_OPTIONS.map((o) => [o.value, o.label]));

/** Label PT-BR de um role (fallback pro próprio valor se desconhecido). */
export function clicksignRoleLabel(role: string | null | undefined): string | null {
  if (!role) return null;
  return ROLE_LABEL.get(role as ClicksignRole) ?? role;
}
