import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";

let saverInstance: PostgresSaver | null = null;

/**
 * Singleton PostgresSaver pra todo o graph compartilhar. Conecta no mesmo
 * Neon DATABASE_URL — tabelas `langgraph_*` ficam num schema separado do
 * Prisma (não aparecem em `prisma migrate`). Setup inicial via
 * `apps/web/scripts/setup-langgraph-tables.ts`.
 *
 * `thread_id` = `ChatSession.id` (1 sessão = 1 thread). Permite
 * `getStateHistory(threadId)` pra time-travel em F3.
 */
export function getCheckpointer(): PostgresSaver {
  if (!saverInstance) {
    const url = process.env.DATABASE_URL;
    if (!url) {
      throw new Error("DATABASE_URL não está definido — checkpointer LangGraph não pode iniciar");
    }
    saverInstance = PostgresSaver.fromConnString(url);
  }
  return saverInstance;
}

/** Útil em testes pra resetar o singleton entre suítes. */
export function __resetCheckpointerForTests(): void {
  saverInstance = null;
}
