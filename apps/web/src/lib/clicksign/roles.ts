/**
 * Papéis ("Assinar como" / qualificação) ClickSign v3. Módulo client-safe
 * (sem imports de servidor) pra ser usado tanto pelos dialogs no client
 * quanto pelo executor/envelopes no server. Os valores são enviados verbatim
 * pro ClickSign no requirement `action:"agree"` (`attributes.role`) — todos
 * existem no enum de qualificações da ClickSign v3.
 */
/** Tupla runtime das qualificações — fonte pra z.enum nas rotas. */
export const CLICKSIGN_ROLES = [
  "sign",
  "buyer",
  "seller",
  "intervening",
  "realestate",
  "witness",
  "consenting",
  "attorney",
  "party",
  // Locação (2026-09-02) — qualificações nativas da ClickSign v3, confirmadas
  // na tabela de qualificações da doc oficial: locador, locatário, fiador e
  // cônjuge do fiador. Antes locador/locatário iam como "party" e fiador +
  // cônjuge como "consenting", indistinguíveis no certificado.
  "lessor",
  "lessee",
  "surety",
  "guarantor_spouse",
] as const;

export type ClicksignRole = (typeof CLICKSIGN_ROLES)[number];

/** Opções exibidas no dropdown "Assina como" (ordem amigável pro corretor). */
export const CLICKSIGN_ROLE_OPTIONS: Array<{ value: ClicksignRole; label: string }> = [
  { value: "buyer", label: "Comprador" },
  { value: "seller", label: "Vendedor" },
  { value: "lessor", label: "Locador" },
  { value: "lessee", label: "Locatário" },
  { value: "surety", label: "Fiador" },
  { value: "guarantor_spouse", label: "Cônjuge do fiador" },
  { value: "consenting", label: "Anuente" },
  { value: "party", label: "Interessado" },
  { value: "attorney", label: "Procurador" },
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

/**
 * Papel default de um signatário. Fonte ÚNICA — o executor (server), as duas
 * popups de envio (venda e locação) e o helper de sugestões importam daqui;
 * antes cada um mantinha a sua cópia e elas divergiam.
 *
 * Papéis derivados da parte têm qualificação própria independente do
 * `sourceKind`. O representante (PJ) assina NO LUGAR da parte, então herda o
 * papel dela e cai no switch.
 */
export function defaultRoleForSourceKind(
  sourceKind: string,
  subKind?: "titular" | "conjuge" | "procurador" | "representante" | "avulso"
): ClicksignRole {
  // A ordem importa: o cônjuge decide ANTES do switch por parte. O cônjuge do
  // fiador é o único com qualificação própria na ClickSign (guarantor_spouse —
  // art. 1.647, III CC); os demais cônjuges seguem como anuentes.
  if (subKind === "conjuge") return sourceKind === "fiador" ? "guarantor_spouse" : "consenting";
  if (subKind === "procurador") return "attorney";
  // O representante (PJ) assina NO LUGAR da parte e herda o papel dela.
  switch (sourceKind) {
    case "vendedor":
      return "seller";
    case "comprador":
      return "buyer";
    case "testemunha":
      return "witness";
    case "corretora":
      return "intervening";
    case "imobiliaria":
      return "realestate";
    // Locação — qualificações nativas (ver CLICKSIGN_ROLES). Role fora do
    // enum da ClickSign → 422; estes quatro estão na tabela oficial.
    case "locador":
      return "lessor";
    case "locatario":
      return "lessee";
    case "fiador":
      return "surety";
    default:
      return "sign";
  }
}
