/**
 * Marcador de "quem está com o editor do contrato aberto", pra ATRIBUIR a edição
 * manual detectada pelo webhook do Drive (ver lib/contracts/human-doc-edit).
 *
 * O problema: o push do Drive não carrega o autor da mudança (ver a memória
 * `project_changelog_attribution_not_via_drive_webhook` — 2 tentativas de ler o
 * autor do payload foram revertidas). O `human_doc_edit` nascia com `userId: null`
 * e o painel mostrava "Sistema" pra uma ação que foi de uma pessoa.
 *
 * Solução best-effort: enquanto o iframe do editor está montado e visível, o
 * cliente pinga `POST /api/contracts/[id]/editing-ping`, que grava aqui
 * `contract-editor:{contractId} = userId` com TTL curto. Quando o webhook conclui
 * "edição manual", consome o marcador. Achou → grava `userId` +
 * `details.attribution: "editor_ping"` (heurística DECLARADA, não prova).
 *
 * Redis (Upstash) é o único backend viável: o ping e o webhook são invocações
 * serverless distintas — cache em memória não cruza instâncias. Sem Redis → tudo
 * vira no-op e a atribuição segue como era (sem userId). Mesmo padrão de client
 * lazy dos módulos irmãos (lib/google/doc-edit-marker, lib/proposals/send-lock).
 *
 * DESAMBIGUAÇÃO: se dois usuários da org abrem o mesmo contrato, o marcador
 * sozinho atribuiria ao último que pingou — chute com cara de fato. Por isso o
 * mark levanta uma flag `amb` (TTL próprio) quando o pinger é DIFERENTE do último
 * conhecido, e a leitura devolve `null` enquanto ela viver: errar pra "não
 * atribuir" é a mesma postura fail-safe do doc-edit-marker. A flag expira sozinha
 * (não é refrescada por pings do mesmo usuário), então volta a atribuir quando o
 * segundo editor sai.
 */

// Janela de presença: > que o intervalo de ping do cliente (5min) pra cobrir uma
// aba que perdeu um ping, e curta o bastante pra não atribuir uma edição feita
// muito depois de alguém fechar o editor.
const PRESENCE_TTL_SECONDS = 10 * 60;
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

/** Race com sentinela DISTINTA de `null` — `null` é "chave ausente", e isso não
 *  pode se confundir com "Redis não respondeu". clearTimeout no caminho vencedor
 *  pra não deixar timers pendurados. */
function raceTimeout<T>(p: Promise<T>): Promise<T | typeof TIMEOUT> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<typeof TIMEOUT>((resolve) => {
    timer = setTimeout(() => resolve(TIMEOUT), REDIS_TIMEOUT_MS);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

function key(contractId: string): string {
  const prefix = process.env.REDIS_KEY_PREFIX ?? "";
  return `${prefix}contract-editor:${contractId}`;
}

function ambiguousKey(contractId: string): string {
  const prefix = process.env.REDIS_KEY_PREFIX ?? "";
  return `${prefix}contract-editor-amb:${contractId}`;
}

/** Só pra teste: reseta o singleton do client. */
export function __resetEditorPresenceClientForTests() {
  _redis = undefined;
}

/**
 * Registra que `userId` está com o editor deste contrato aberto agora.
 * Best-effort, nunca lança — chamado pelo endpoint de ping.
 */
export async function markContractEditorPresence(
  contractId: string,
  userId: string
): Promise<void> {
  if (!contractId || !userId) return;
  try {
    const redis = await getRedis();
    if (!redis) return;
    const prev = await raceTimeout(redis.get(key(contractId)));
    if (prev !== TIMEOUT && prev && prev !== userId) {
      // Outro usuário pingou dentro da janela → editor concorrente. Marca
      // ambíguo pelo TTL da flag; a leitura passa a não atribuir ninguém.
      await raceTimeout(
        redis.set(ambiguousKey(contractId), "1", { ex: PRESENCE_TTL_SECONDS })
      );
    }
    await raceTimeout(
      redis.set(key(contractId), userId, { ex: PRESENCE_TTL_SECONDS })
    );
  } catch {
    // best-effort: sem marcador a edição manual só perde a atribuição.
  }
}

/**
 * Quem estava com o editor aberto há pouco?
 *  - `userId` quando há exatamente um candidato conhecido na janela.
 *  - `null` quando não há marcador, o Redis está indisponível/lento, ou dois
 *    editores concorreram (ambíguo — não chuta).
 */
export async function getRecentContractEditor(
  contractId: string
): Promise<string | null> {
  if (!contractId) return null;
  try {
    const redis = await getRedis();
    if (!redis) return null;
    const res = await raceTimeout(
      Promise.all([
        redis.get(ambiguousKey(contractId)),
        redis.get(key(contractId)),
      ])
    );
    if (res === TIMEOUT) return null;
    const [ambiguous, userId] = res;
    if (ambiguous) return null;
    return userId || null;
  } catch {
    return null;
  }
}
