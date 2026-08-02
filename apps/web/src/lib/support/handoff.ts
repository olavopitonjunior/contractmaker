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

  // Sinal EXPLÍCITO de usuário travado — o alerta mais limpo que existe:
  // volume baixo, zero falso positivo, e cada pergunta nova é genuinamente
  // nova (o dedupe acima já engoliu as repetidas). A pergunta é input não
  // confiável: truncada no payload, escapada no e-mail pelo motor.
  // NOTA: assinatura por id novo = o re-arm de 24h do motor é inerte aqui de
  // propósito; o anti-spam deste caminho é o dedupe de pergunta acima + o
  // teto horário global (review #234).
  import("@/lib/alerts/platform-alerts")
    .then(({ reportPlatformAlert }) =>
      reportPlatformAlert({
        kind: "support_signal",
        signature: `handoff:${created.id}`,
        orgId: input.orgId ?? null,
        severity: "warning",
        title: "Usuário travado no suporte (handoff novo)",
        payload: {
          question: input.question.slice(0, 300),
          screenPath: input.screenPath ?? null,
        },
        notify: "immediate",
      })
    )
    .catch(() => {});

  return { id: created.id, deduped: false };
}
