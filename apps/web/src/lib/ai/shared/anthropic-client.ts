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

/** Modelos default usados em todo o sistema multi-agente. */
export const HAIKU_MODEL = "claude-haiku-4-5-20251001";
export const SONNET_MODEL = "claude-sonnet-4-6";

/** Reset pra testes (forçar re-instanciar com env mockada). */
export function __resetAnthropicClientForTests(): void {
  cachedClient = null;
}
