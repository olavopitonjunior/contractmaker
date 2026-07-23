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
 *  a chave não existe, e precisamos separar isso de "timeout/indisponível".
 *  clearTimeout no caminho vencedor pra não deixar timers de 2s pendurados
 *  (markProgrammaticDocEdit é chamado dezenas de vezes na geração). */
function raceTimeout<T>(p: Promise<T>): Promise<T | typeof TIMEOUT> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<typeof TIMEOUT>((resolve) => {
    timer = setTimeout(() => resolve(TIMEOUT), REDIS_TIMEOUT_MS);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

// Dedup por instância: durante a geração, expandLoops chama batchUpdateDoc (e o
// mark) dezenas de vezes pro MESMO docId em segundos. Como o TTL (180s) >> esta
// janela, basta setar o Redis uma vez por docId a cada MARK_DEDUP_MS — o resto é
// no-op in-memory. Mantém o `await` (ordem garantida) sem N writes sequenciais.
const MARK_DEDUP_MS = 10_000;
const lastMarkedAt = new Map<string, number>();

function key(docId: string): string {
  const prefix = process.env.REDIS_KEY_PREFIX ?? "";
  return `${prefix}prog-doc-edit:${docId}`;
}

/** Só pra teste: reseta o singleton do client + o dedup in-memory. */
export function __resetDocEditMarkerClientForTests() {
  _redis = undefined;
  lastMarkedAt.clear();
}

/**
 * Marca que o app acabou de editar (ou vai editar) este Doc programaticamente.
 * Fire-and-forget, nunca lança. Chamado por `batchUpdateDoc`.
 */
export async function markProgrammaticDocEdit(docId: string): Promise<void> {
  if (!docId) return;
  const now = Date.now();
  const last = lastMarkedAt.get(docId);
  if (last !== undefined && now - last < MARK_DEDUP_MS) return; // já setei há pouco
  // Poda: entradas mais velhas que a janela de dedup são inúteis (o check acima
  // já as trata como expiradas). Evita crescimento monotônico do Map numa
  // instância longeva. O(n) só quando o Map cresce além do cap.
  if (lastMarkedAt.size > 200) {
    for (const [k, t] of lastMarkedAt) {
      if (now - t >= MARK_DEDUP_MS) lastMarkedAt.delete(k);
    }
  }
  try {
    const redis = await getRedis();
    if (!redis) return;
    const res = await raceTimeout(redis.set(key(docId), "1", { ex: ECHO_TTL_SECONDS }));
    // Só registra o dedup se o SET CONFIRMOU — senão (timeout/erro) o marcador
    // pode não ter sido escrito, e pular os retries por 10s deixaria o eco de uma
    // edição programática sem marcador (phantom "Manual").
    if (res !== TIMEOUT) lastMarkedAt.set(docId, now);
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
