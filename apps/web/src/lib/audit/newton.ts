import type { ResolvedAuth } from "@/lib/auth/auth-or-bearer";

/**
 * Newton (e qualquer cliente bearer no futuro) deve enviar `X-Newton-Actor`
 * com o `userId` que está sendo representado. Para session-based auth o
 * header é ignorado (UI já age como o user logado).
 *
 * Para bearer-based: header DEVE bater com `tokenId.userId` — caso contrário
 * é tentativa de spoofing e a request é rejeitada.
 *
 * Saída: campo `metadata.via = "newton"` para enriquecer AuditLog.
 */
export interface NewtonActorContext {
  /** Vai em metadata.via no AuditLog. "newton" se header presente e válido, undefined caso contrário. */
  via?: "newton";
  /** O userId final a usar como ator do AuditLog. */
  effectiveUserId: string;
}

export interface NewtonActorRejection {
  rejected: true;
  reason: "header_user_mismatch" | "header_without_bearer";
}

export type NewtonActorResult = NewtonActorContext | NewtonActorRejection;

export function isRejection(r: NewtonActorResult): r is NewtonActorRejection {
  return "rejected" in r && r.rejected;
}

/**
 * Resolve o ator efetivo da request.
 *
 * Regras:
 *  - Bearer auth + sem header X-Newton-Actor → ator é o userId do token.
 *  - Bearer auth + header igual ao userId do token → via="newton", ator é esse userId.
 *  - Bearer auth + header diferente do userId do token → REJEITA (spoofing).
 *  - Session auth + header presente → REJEITA (UI não deveria mandar esse header).
 *  - Session auth + sem header → ator é o session.userId.
 */
export function resolveNewtonActor(
  req: Request,
  ident: ResolvedAuth
): NewtonActorResult {
  const headerActor = req.headers.get("x-newton-actor");

  if (ident.via === "bearer") {
    if (!headerActor) {
      // Bearer sem header: ainda assim consideramos via=newton porque a
      // origem é externa. O ator é o dono do token.
      return { via: "newton", effectiveUserId: ident.userId };
    }
    if (headerActor === ident.userId) {
      return { via: "newton", effectiveUserId: ident.userId };
    }
    return { rejected: true, reason: "header_user_mismatch" };
  }

  // Session auth
  if (headerActor) {
    return { rejected: true, reason: "header_without_bearer" };
  }
  return { effectiveUserId: ident.userId };
}

/**
 * Helper para inserir `via` em metadata de AuditLog.
 * Uso:
 *   const meta = mergeAuditMetadata({ chargeId }, actor);
 *   await audit(ctx, { action: "CHARGE_CREATE", result: "SUCCESS", metadata: meta });
 */
export function mergeAuditMetadata(
  base: Record<string, unknown>,
  actor: NewtonActorContext
): Record<string, unknown> {
  if (actor.via) {
    return { ...base, via: actor.via };
  }
  return base;
}
