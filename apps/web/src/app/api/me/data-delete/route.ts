import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { audit } from "@/lib/security/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/me/data-delete
 *
 * LGPD art. 18, VI — direito de eliminação. Soft-delete da conta com janela
 * de 30 dias para reversal. Após 30 dias, cron de hard-delete remove o
 * registro do User (e cascades).
 *
 * Body: `{ confirmation: "EXCLUIR MINHA CONTA" }` — exige string literal
 * pra confirmar intenção.
 *
 * DELETE /api/me/data-delete — cancela soft-delete pendente (reversal).
 */

const requestSchema = z.object({
  confirmation: z.literal("EXCLUIR MINHA CONTA"),
});

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;
  const ip = req.headers.get("x-forwarded-for") ?? null;
  const userAgent = req.headers.get("user-agent") ?? null;

  const raw = await req.json().catch(() => ({}));
  const parsed = requestSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error:
          "Confirmação ausente — envie `{ confirmation: 'EXCLUIR MINHA CONTA' }`",
      },
      { status: 400 }
    );
  }

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });
  }

  if (user.deletedAt) {
    return NextResponse.json(
      {
        error: "Já existe solicitação de exclusão pendente",
        deletedAt: user.deletedAt,
        deletionScheduledAt: user.deletionScheduledAt,
      },
      { status: 409 }
    );
  }

  const now = new Date();
  const scheduled = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  await prisma.user.update({
    where: { id: userId },
    data: {
      deletedAt: now,
      deletionScheduledAt: scheduled,
    },
  });

  // Auditar
  const org = await getUserOrg(userId);
  await audit(
    {
      orgId: org?.id ?? "",
      userId,
      ipAddress: ip,
      userAgent,
    },
    {
      action: "DATA_DELETE_REQUESTED",
      result: "SUCCESS",
      resourceType: "user",
      resource: `user:${userId}`,
      metadata: {
        deletedAt: now.toISOString(),
        deletionScheduledAt: scheduled.toISOString(),
      },
    }
  );

  return NextResponse.json({
    ok: true,
    message:
      "Solicitação de exclusão registrada. Você tem 30 dias para reverter via DELETE /api/me/data-delete.",
    deletedAt: now,
    deletionScheduledAt: scheduled,
  });
}

/**
 * DELETE /api/me/data-delete — cancela solicitação de exclusão (reversal).
 *
 * Só funciona durante a janela de 30 dias (antes do cron de hard-delete).
 */
export async function DELETE(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;
  const ip = req.headers.get("x-forwarded-for") ?? null;
  const userAgent = req.headers.get("user-agent") ?? null;

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || !user.deletedAt) {
    return NextResponse.json(
      { error: "Não há solicitação de exclusão pendente" },
      { status: 404 }
    );
  }

  await prisma.user.update({
    where: { id: userId },
    data: {
      deletedAt: null,
      deletionScheduledAt: null,
    },
  });

  const org = await getUserOrg(userId);
  await audit(
    {
      orgId: org?.id ?? "",
      userId,
      ipAddress: ip,
      userAgent,
    },
    {
      action: "DATA_DELETION_CANCELLED",
      result: "SUCCESS",
      resourceType: "user",
      resource: `user:${userId}`,
    }
  );

  return NextResponse.json({
    ok: true,
    message: "Solicitação de exclusão cancelada — sua conta continua ativa.",
  });
}
