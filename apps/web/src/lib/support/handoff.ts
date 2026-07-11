/**
 * Criação/dedupe de pendências de suporte (SupportHandoff).
 *
 * Quando o assistente não sabe responder, registra uma pendência. Perguntas
 * idênticas (mesma forma normalizada) ainda em aberto NÃO viram linhas novas —
 * incrementam `count`, pra o painel mostrar "N pessoas perguntaram isso".
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";

export function normalizeQuestion(q: string): string {
  return q
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .slice(0, 300);
}

export interface HandoffInput {
  question: string;
  orgId?: string | null;
  userId?: string | null;
  screenPath?: string | null;
  transcript?: unknown;
}

export async function createOrDedupeHandoff(
  input: HandoffInput
): Promise<{ id: string; deduped: boolean }> {
  const normalizedQuestion = normalizeQuestion(input.question);

  if (normalizedQuestion) {
    const existing = await prisma.supportHandoff.findFirst({
      where: { status: "pending", normalizedQuestion },
      select: { id: true },
    });
    if (existing) {
      await prisma.supportHandoff.update({
        where: { id: existing.id },
        data: { count: { increment: 1 } },
      });
      return { id: existing.id, deduped: true };
    }
  }

  const created = await prisma.supportHandoff.create({
    data: {
      question: input.question.slice(0, 4000),
      normalizedQuestion,
      orgId: input.orgId ?? null,
      userId: input.userId ?? null,
      screenPath: input.screenPath ?? null,
      transcriptJson:
        input.transcript == null
          ? undefined
          : (input.transcript as Prisma.InputJsonValue),
      status: "pending",
    },
    select: { id: true },
  });
  return { id: created.id, deduped: false };
}
