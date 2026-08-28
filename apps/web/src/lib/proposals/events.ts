// Registro de eventos de timeline da proposta.
//
// Vivia como função privada de send-execute.ts; virou módulo próprio no 3º
// ciclo do revisor pós-geração (os achados da revisão entram na timeline).
// Contrato preservado: source "system", NUNCA lança — evento de timeline é
// rastro, não pode derrubar o fluxo que o grava (há teste amarrando isso em
// __tests__/release-claim-never-rejects.test.ts).
import { prisma } from "@/lib/db/prisma";

export async function logProposalEvent(
  proposalId: string,
  eventName: string,
  payload?: Record<string, unknown>
): Promise<void> {
  await prisma.proposalEvent
    .create({
      data: {
        proposalId,
        eventName,
        source: "system",
        ...(payload ? { payload: payload as never } : {}),
      },
    })
    .catch(() => {});
}
