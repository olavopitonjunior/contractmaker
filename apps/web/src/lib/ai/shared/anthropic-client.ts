import { Anthropic } from "@anthropic-ai/sdk";

/** Singleton client. Lazy-init pra erro de env só lançar quando alguém chama. */
let cachedClient: Anthropic | null = null;

export function getAnthropicClient(): Anthropic {
  if (!cachedClient) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error("ANTHROPIC_API_KEY não configurada. Adicione a chave no .env");
    }
    cachedClient = new Anthropic({ apiKey });
  }
  return cachedClient;
}

/** Modelos default usados em todo o sistema multi-agente (re-export — a
 *  fonte é lib/ai/shared/models.ts, módulo puro sem SDK pra uso no client). */
export {
  HAIKU_MODEL,
  SONNET_MODEL,
  OPUS_MODEL,
  resolveModel,
} from "./models";

/** Reset pra testes (forçar re-instanciar com env mockada). */
export function __resetAnthropicClientForTests(): void {
  cachedClient = null;
}

/**
 * Sobrecarga transitória da Anthropic é a falha mais comum e a mais boba de
 * deixar passar: `429` (rate limit) e `529` (overloaded) não significam que o
 * pedido era inválido, só que aquele modelo está congestionado agora. Até aqui
 * o cliente era um singleton sem retry nenhum — o turn morria e o usuário via
 * erro.
 *
 * `fallbackModel` vem do `AgentProfile`, é gravado e resolvido desde o console
 * de agentes, e **nunca foi consumido por ninguém**. Este wrapper é quem passa
 * a consumi-lo.
 *
 * Regras:
 *  - UMA tentativa no fallback, não uma cadeia. Se o segundo modelo também está
 *    sobrecarregado, insistir só aumenta a espera de quem está olhando a tela.
 *  - Sem fallback configurado, o erro sobe como antes.
 *  - As DUAS tentativas viram registro em `AIUsage` — a primeira com
 *    `success: false`. Sem isso, o custo do fallback aparece do nada no painel
 *    e ninguém entende por que aquele agente rodou num modelo diferente.
 */
export function isOverloadedError(err: unknown): boolean {
  const status = (err as { status?: number })?.status;
  if (status === 429 || status === 529) return true;
  const t = (err as { type?: string })?.type ?? "";
  return t === "overloaded_error" || t === "rate_limit_error";
}
