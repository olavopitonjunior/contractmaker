/**
 * Estado do banner de impersonation a partir do vencimento da sessão. PURO:
 * o componente só decide texto e cor por aqui, e é isto que se testa.
 */
export type ImpersonationBannerState =
  | { kind: "unknown" }
  | { kind: "active"; expiresAtLabel: string; remainingMs: number }
  | { kind: "expired" };

export function impersonationBannerState(
  endsAtIso: string | null | undefined,
  nowMs: number
): ImpersonationBannerState {
  if (!endsAtIso) return { kind: "unknown" };
  const endsAt = Date.parse(endsAtIso);
  if (Number.isNaN(endsAt)) return { kind: "unknown" };
  const remainingMs = endsAt - nowMs;
  if (remainingMs <= 0) return { kind: "expired" };
  const d = new Date(endsAt);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return { kind: "active", expiresAtLabel: `${hh}:${mm}`, remainingMs };
}
