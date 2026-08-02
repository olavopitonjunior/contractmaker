import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const schema = z.object({
  interactionId: z.string().min(1),
  rating: z.union([z.literal(1), z.literal(-1)]),
});

// Feedback 👍/👎 do usuário sobre uma resposta do assistente de suporte.
// Só o autor da interação pode avaliá-la.
export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Validation failed" }, { status: 422 });
  }

  const interaction = await prisma.supportInteraction.findUnique({
    where: { id: parsed.data.interactionId },
    select: { id: true, userId: true },
  });
  if (!interaction || interaction.userId !== session.user.id) {
    return NextResponse.json({ error: "Não encontrado" }, { status: 404 });
  }

  await prisma.supportInteraction.update({
    where: { id: interaction.id },
    data: { rating: parsed.data.rating },
  });

  // 👎 é sinal explícito de resposta ruim — digest, não imediato: um único
  // negativo é dado; o padrão de vários é que merece atenção, e o digest
  // soma. Assinatura por interação: re-votar a mesma não duplica.
  if (parsed.data.rating === -1) {
    import("@/lib/alerts/platform-alerts")
      .then(({ reportPlatformAlert }) =>
        reportPlatformAlert({
          kind: "support_signal",
          signature: `rating-down:${interaction.id}`,
          severity: "info",
          title: "Resposta do suporte avaliada com 👎",
          notify: "digest",
        })
      )
      .catch(() => {});
  }

  return NextResponse.json({ ok: true });
}
