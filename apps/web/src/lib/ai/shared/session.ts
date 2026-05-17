/**
 * Helpers de ChatSession compartilhados entre agent.ts legacy e o graph
 * multi-agente. `resolveSession` decide se reusa ou cria uma session;
 * `loadChatHistory` traz os últimos turns pra contexto.
 */

import { prisma } from "@/lib/db/prisma";

/**
 * Resolve a session ativa pra esse turn:
 *  - Se `sessionId` foi passado e a session pertence ao contrato (e não está
 *    arquivada), usa essa.
 *  - Senão, pega a mais recente não-arquivada.
 *  - Senão (primeira conversa), cria uma session vazia.
 */
export async function resolveSession(
  contractId: string,
  userId: string,
  sessionId?: string
): Promise<{ id: string }> {
  if (sessionId) {
    const session = await prisma.chatSession.findUnique({
      where: { id: sessionId },
      select: { id: true, contractId: true, archived: true },
    });
    if (session && session.contractId === contractId && !session.archived) {
      return { id: session.id };
    }
    // sessionId inválido pra esse contrato — cai pro fallback.
  }

  const recent = await prisma.chatSession.findFirst({
    where: { contractId, archived: false },
    orderBy: { updatedAt: "desc" },
    select: { id: true },
  });
  if (recent) return recent;

  const created = await prisma.chatSession.create({
    data: { contractId, userId },
    select: { id: true },
  });
  return created;
}

export async function loadChatHistory(sessionId: string) {
  const messages = await prisma.chatMessage.findMany({
    where: { sessionId },
    orderBy: { createdAt: "asc" },
    take: 20,
    select: { role: true, content: true },
  });
  return messages.map((m) => ({
    role: m.role as "user" | "assistant",
    content: m.content,
  }));
}
