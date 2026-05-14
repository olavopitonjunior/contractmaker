import { signToken, verifyToken, type VerifyTokenResult } from "@/lib/jwt-hmac";

/**
 * Subtoken por parte (vendedor/comprador) pro form público.
 *
 * Cada SalesFormParticipant tem seu token JWT-HMAC com AUTH_SECRET, exp 7d.
 * Server filtra `dataJson` por `ROLE_PATHS[role]` na leitura e enforça
 * allowlist via `deepMergeAtPaths` no PATCH.
 *
 * Decisão de design: token é stateless (assinatura suficiente pra autenticar),
 * MAS persistimos `SalesFormParticipant.token` no DB pra suportar "regenerar
 * link" (admin clica → JWT antigo perde a referência → vira 401 mesmo com
 * assinatura válida). Sem isso, regenerar exigia invalidar uma window de 7d.
 */

export type ParticipantRole = "vendedor" | "comprador";

export interface ParticipantTokenPayload {
  participantId: string;
  formId: string;
  role: ParticipantRole;
  partyIndex: number;
  exp: number; // epoch seconds
}

const TTL_SECONDS = 7 * 24 * 60 * 60;

export function signParticipantToken(
  payload: Omit<ParticipantTokenPayload, "exp">,
  secret: string,
): { token: string; exp: Date } {
  const exp = new Date(Date.now() + TTL_SECONDS * 1000);
  const fullPayload: ParticipantTokenPayload = {
    ...payload,
    exp: Math.floor(exp.getTime() / 1000),
  };
  return { token: signToken(fullPayload, secret), exp };
}

export function verifyParticipantToken(
  token: string,
  secret: string,
): VerifyTokenResult<ParticipantTokenPayload> {
  const result = verifyToken<ParticipantTokenPayload>(token, secret);
  if (!result.ok) return result;
  const p = result.payload;
  if (
    typeof p.participantId !== "string" ||
    typeof p.formId !== "string" ||
    (p.role !== "vendedor" && p.role !== "comprador") ||
    typeof p.partyIndex !== "number"
  ) {
    return { ok: false, error: "Payload de participant incompleto" };
  }
  return { ok: true, payload: p };
}
