import { prisma } from "@/lib/db/prisma";
import { generateSecureToken, sha256Hex, timingSafeEqualStr } from "@/lib/security/crypto";

const IDENTIFIER_PREFIX = "pwd:";
const WELCOME_PREFIX = "pwd-welcome:";

export type PasswordResetReason = "reset" | "welcome";

// `reset` é reativo (a pessoa acabou de pedir) → janela curta.
// `welcome` é o primeiro acesso de um convite/provisionamento: chega por e-mail e
// costuma ser aberto horas ou dias depois. Com 1h, o link morria antes do uso.
const TTL_BY_REASON: Record<PasswordResetReason, number> = {
  reset: 60 * 60 * 1000, // 1h
  welcome: 7 * 24 * 60 * 60 * 1000, // 7 dias
};

function identifierFor(email: string, reason: PasswordResetReason): string {
  const prefix = reason === "welcome" ? WELCOME_PREFIX : IDENTIFIER_PREFIX;
  return `${prefix}${email.toLowerCase()}`;
}

/**
 * Cria token de reset de senha. Retorna o token em CLARO (para enviar por email).
 * O DB armazena apenas o hash SHA-256 do token + expiração.
 *
 * `reason: "welcome"` é usado em convite de membro — same shape, identifier
 * diferente para a UI exibir mensagem distinta.
 */
export async function createPasswordResetToken(
  email: string,
  reason: PasswordResetReason = "reset"
): Promise<{ token: string; expiresAt: Date }> {
  const normalizedEmail = email.toLowerCase().trim();
  const token = generateSecureToken(32);
  const tokenHash = sha256Hex(token);
  const expiresAt = new Date(Date.now() + TTL_BY_REASON[reason]);
  const identifier = identifierFor(normalizedEmail, reason);

  // Apaga tokens anteriores do mesmo email/reason (single active token)
  await prisma.verificationToken.deleteMany({ where: { identifier } });

  await prisma.verificationToken.create({
    data: { identifier, token: tokenHash, expires: expiresAt },
  });

  return { token, expiresAt };
}

export interface ConsumedToken {
  email: string;
  reason: PasswordResetReason;
}

/**
 * Valida token, consome (deleta) e retorna email associado. Retorna null se
 * token inválido, expirado ou já usado.
 */
export async function consumePasswordResetToken(
  token: string
): Promise<ConsumedToken | null> {
  if (!token || token.length < 16) return null;
  const tokenHash = sha256Hex(token);
  const record = await prisma.verificationToken.findUnique({
    where: { token: tokenHash },
  });
  if (!record) return null;
  if (record.expires.getTime() < Date.now()) {
    await prisma.verificationToken.delete({ where: { token: tokenHash } }).catch(() => {});
    return null;
  }

  let email: string;
  let reason: PasswordResetReason;
  if (record.identifier.startsWith(WELCOME_PREFIX)) {
    email = record.identifier.slice(WELCOME_PREFIX.length);
    reason = "welcome";
  } else if (record.identifier.startsWith(IDENTIFIER_PREFIX)) {
    email = record.identifier.slice(IDENTIFIER_PREFIX.length);
    reason = "reset";
  } else {
    return null;
  }

  // Verificação extra: timing-safe contra o hash armazenado
  if (!timingSafeEqualStr(tokenHash, record.token)) return null;

  await prisma.verificationToken.delete({ where: { token: tokenHash } });
  return { email, reason };
}

/**
 * Inspeciona token sem consumir — usado para mostrar se welcome ou reset
 * antes do user submeter a nova senha.
 */
export async function peekPasswordResetToken(
  token: string
): Promise<ConsumedToken | null> {
  if (!token || token.length < 16) return null;
  const tokenHash = sha256Hex(token);
  const record = await prisma.verificationToken.findUnique({
    where: { token: tokenHash },
  });
  if (!record || record.expires.getTime() < Date.now()) return null;

  if (record.identifier.startsWith(WELCOME_PREFIX)) {
    return { email: record.identifier.slice(WELCOME_PREFIX.length), reason: "welcome" };
  }
  if (record.identifier.startsWith(IDENTIFIER_PREFIX)) {
    return { email: record.identifier.slice(IDENTIFIER_PREFIX.length), reason: "reset" };
  }
  return null;
}
