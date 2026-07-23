/**
 * Marcador de "edição PROGRAMÁTICA recente" de um Google Doc, pra atribuição
 * IA×humano no ContractChangeLog.
 *
 * O problema: a IA (e qualquer edição do app via `batchUpdateDoc`) edita o Doc
 * pela Docs API → aciona o watch do Drive → chega um webhook `google_doc_updated`.
 * Um humano editando no iframe TAMBÉM aciona o mesmo webhook. O payload do Drive
 * NÃO traz identidade, então o webhook não distingue os dois.
 *
 * Solução: toda mutação programática (`batchUpdateDoc`) seta este marcador ANTES
 * de tocar o Doc (chave por `docId`, TTL curto). Quando o webhook chega, se o
 * marcador existe o ping é ECO de uma edição do app → não é edição manual. Sem
 * marcador → edição manual (humana) direta no iframe.
 *
 * Redis (Upstash) é o único backend viável — o "set" (na instância que edita) e o
 * "check" (na instância do webhook) são serverless invocations diferentes; um
 * cache em memória não cruza instâncias. Sem Redis → check retorna "unknown" e o
 * webhook NÃO atribui como humano (fail-safe: prefere não atribuir a atribuir
 * errado).
 */

// Janela do eco: cobre a latência do watch do Drive após a última edição
// programática (refrescada a cada batchUpdateDoc, conta da ÚLTIMA edição do app).
// 180s porque o Drive é best-effort e pode atrasar/agrupar pings por mais de um
// minuto — sem diff, um FALSO "manual" (eco atrasado da IA virando "humano") é
// pior que perder um timestamp humano dentro da janela. Erra pro conservador.
const ECHO_TTL_SECONDS = 180;
const REDIS_TIMEOUT_MS = 2000;

let _redis:
  | {
      get: (k: string) => Promise<string | null>;
      set: (k: string, v: string, opts: { ex: number }) => Promise<unknown>;
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

const TIMEOUT = Symbol("redis-timeout");

/** Race com um sentinela DISTINTO de `null` — o get do Redis devolve null quando
 *  a chave não existe, e precisamos separar isso de "timeout/indisponível". */
function raceTimeout<T>(p: Promise<T>): Promise<T | typeof TIMEOUT> {
  return Promise.race([
    p,
    new Promise<typeof TIMEOUT>((resolve) =>
      setTimeout(() => resolve(TIMEOUT), REDIS_TIMEOUT_MS)
    ),
  ]);
}

function key(docId: string): string {
  const prefix = process.env.REDIS_KEY_PREFIX ?? "";
  return `${prefix}prog-doc-edit:${docId}`;
}

/** Só pra teste: reseta o singleton do client. */
export function __resetDocEditMarkerClientForTests() {
  _redis = undefined;
}

/**
 * Marca que o app acabou de editar (ou vai editar) este Doc programaticamente.
 * Fire-and-forget, nunca lança. Chamado por `batchUpdateDoc`.
 */
export async function markProgrammaticDocEdit(docId: string): Promise<void> {
  if (!docId) return;
  try {
    const redis = await getRedis();
    if (!redis) return;
    await raceTimeout(redis.set(key(docId), "1", { ex: ECHO_TTL_SECONDS }));
  } catch {
    // best-effort — no pior caso o webhook trata o ping como manual (a IA já
    // logou a própria edição como source:"ai", então no máximo há uma entry
    // "manual" espúria, não perda de dado).
  }
}

/**
 * O ping do webbook pra este Doc é eco de uma edição programática?
 *  - "echo": marcador presente → edição do app (IA/settings/etc).
 *  - "manual": sem marcador → edição humana direta no iframe.
 *  - "unknown": Redis indisponível → não dá pra saber (fail-safe: não atribuir).
 */
export async function checkDocEcho(
  docId: string
): Promise<"echo" | "manual" | "unknown"> {
  if (!docId) return "unknown";
  try {
    const redis = await getRedis();
    if (!redis) return "unknown";
    const v = await raceTimeout(redis.get(key(docId)));
    if (v === TIMEOUT) return "unknown"; // Redis não respondeu a tempo
    return v ? "echo" : "manual"; // v é string (presente) ou null (ausente)
  } catch {
    return "unknown";
  }
}
