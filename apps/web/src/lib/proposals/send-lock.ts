/**
 * Lock distribuído (Upstash Redis) pra serializar o envio do 2º envelope do
 * vendedor de uma proposta. Sem ele, gatilhos concorrentes — webhook (waitUntil) +
 * botão /send-vendedor + cron reconcile — passavam todos pela guarda de existência
 * ANTES de qualquer um inserir o draft (TOCTOU), e o `deleteMany(draft)` dentro de
 * runClickSignEnvelope apagava o draft do concorrente, derrotando o
 * @@unique([proposalId, via]) → DOIS envelopes ClickSign criados (cobrança dobrada
 * R$/signer + um envelope remoto órfão).
 *
 * Redis é o único backend que cruza invocações serverless diferentes (webhook,
 * cron e botão rodam em instâncias distintas). Sem Redis → fail-open (roda sem
 * lock, caindo na proteção parcial da guarda de draft recente): mesma postura do
 * doc-edit-marker; não vale travar o envio por falta de Redis.
 */
import { randomUUID } from "node:crypto";

const LOCK_TTL_MS = 120_000; // > tempo de um envio ClickSign completo; bound a holder morto.

let _redis:
  | {
      set: (
        k: string,
        v: string,
        opts: { nx: true; px: number }
      ) => Promise<unknown>;
      eval: (script: string, keys: string[], args: string[]) => Promise<unknown>;
    }
  | null
  | undefined;

async function getRedis() {
  if (_redis !== undefined) return _redis;
  if (
    !process.env.UPSTASH_REDIS_REST_URL ||
    !process.env.UPSTASH_REDIS_REST_TOKEN
  ) {
    _redis = null;
    return null;
  }
  try {
    const { Redis } = await import("@upstash/redis");
    _redis = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN,
    }) as unknown as typeof _redis;
    return _redis;
  } catch {
    _redis = null;
    return null;
  }
}

function key(proposalId: string): string {
  const prefix = process.env.REDIS_KEY_PREFIX ?? "";
  return `${prefix}proposal-vendedor-lock:${proposalId}`;
}

// Release condicional: só apaga se ainda formos o dono (o TTL pode ter expirado e
// outra invocação readquirido a chave). Evita liberar o lock de terceiro.
const RELEASE_LUA =
  "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";

/** Só pra teste: reseta o singleton do client. */
export function __resetSendLockClientForTests() {
  _redis = undefined;
}

/**
 * Roda `fn` com o lock do vendedor da proposta. Se outro processo já detém o lock,
 * NÃO roda `fn` e retorna `onBusy` (o outro processo está enviando). Sem Redis,
 * roda `fn` direto (fail-open).
 */
export async function withVendedorSendLock<T>(
  proposalId: string,
  fn: () => Promise<T>,
  onBusy: T
): Promise<T> {
  const redis = await getRedis();
  if (!redis) return fn(); // fail-open

  const token = randomUUID();
  let acquired = false;
  try {
    const res = await redis.set(key(proposalId), token, {
      nx: true,
      px: LOCK_TTL_MS,
    });
    acquired = res === "OK" || res === true;
  } catch {
    // Redis instável no acquire → fail-open (roda sem lock).
    return fn();
  }
  if (!acquired) return onBusy;

  try {
    return await fn();
  } finally {
    try {
      await redis.eval(RELEASE_LUA, [key(proposalId)], [token]);
    } catch {
      // best-effort — o TTL limpa o lock de qualquer forma.
    }
  }
}
