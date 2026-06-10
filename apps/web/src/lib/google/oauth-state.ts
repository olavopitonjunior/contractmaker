import crypto from "node:crypto";

// State assinado (HMAC-SHA256) pro fluxo OAuth de conexão do Google por org.
// Protege o callback contra CSRF: só aceitamos `state` que nós mesmos
// emitimos, dentro da janela de validade.

const STATE_TTL_MS = 10 * 60 * 1000;

interface StatePayload {
  orgId: string;
  userId: string;
  exp: number;
}

function secret(): string {
  const s = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;
  if (!s) throw new Error("AUTH_SECRET ausente — necessário pro state OAuth.");
  return s;
}

function hmac(data: string): string {
  return crypto.createHmac("sha256", secret()).update(data).digest("base64url");
}

export function signOAuthState(input: { orgId: string; userId: string }): string {
  const payload: StatePayload = {
    orgId: input.orgId,
    userId: input.userId,
    exp: Date.now() + STATE_TTL_MS,
  };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${hmac(body)}`;
}

export function verifyOAuthState(state: string): StatePayload | null {
  const [body, sig] = state.split(".");
  if (!body || !sig) return null;
  const expected = hmac(body);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(
      Buffer.from(body, "base64url").toString("utf8")
    ) as StatePayload;
    if (!payload.orgId || !payload.userId || Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}
