import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import {
  requireApiAuth,
  isAuthFailure,
  authFailureResponse,
} from "@/lib/api/require-auth";

export const runtime = "nodejs";

const patchSchema = z.object({
  title: z.string().min(1).max(120).optional(),
  archived: z.boolean().optional(),
});

async function loadOwnedSession(
  contractId: string,
  sessionId: string,
  orgId: string,
  authUserId: string,
  isBearer: boolean
) {
  const session = await prisma.chatSession.findUnique({
    where: { id: sessionId },
    include: {
      contract: {
        select: {
          id: true,
          userId: true,
          deal: { select: { pipeline: { select: { orgId: true } } } },
        },
      },
    },
  });
  // Cross-org check pra session E bearer — 404 pra não vazar existência.
  if (
    !session ||
    session.contractId !== contractId ||
    session.contract.deal.pipeline.orgId !== orgId
  ) {
    return { error: "Session not found", status: 404 as const };
  }
  if (isBearer && session.contract.userId !== authUserId) {
    return { error: "Forbidden", status: 403 as const };
  }
  return { session };
}

/**
 * GET /api/contracts/[id]/chat-sessions/[sessionId]
 * Retorna a session com mensagens — usado pela UI ao trocar de session.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string; sessionId: string } }
) {
  const auth = await requireApiAuth(req, { scope: "contracts:rw" });
  if (isAuthFailure(auth)) return authFailureResponse(auth);

  const result = await loadOwnedSession(
    params.id,
    params.sessionId,
    auth.org.id,
    auth.ident.via === "bearer" ? auth.ident.userId : "",
    auth.ident.via === "bearer"
  );
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  const messages = await prisma.chatMessage.findMany({
    where: { sessionId: params.sessionId },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      role: true,
      content: true,
      events: true,
      createdAt: true,
    },
  });

  return NextResponse.json({
    id: result.session.id,
    title: result.session.title,
    archived: result.session.archived,
    updatedAt: result.session.updatedAt.toISOString(),
    createdAt: result.session.createdAt.toISOString(),
    messages: messages.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      events: m.events,
      createdAt: m.createdAt.toISOString(),
    })),
  });
}

/**
 * PATCH /api/contracts/[id]/chat-sessions/[sessionId]
 * Renomeia ou arquiva session. UI usa isso pro menu "Renomear / Arquivar".
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string; sessionId: string } }
) {
  const auth = await requireApiAuth(req, { scope: "contracts:rw" });
  if (isAuthFailure(auth)) return authFailureResponse(auth);

  const body = await req.json().catch(() => ({}));
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const result = await loadOwnedSession(
    params.id,
    params.sessionId,
    auth.org.id,
    auth.ident.via === "bearer" ? auth.ident.userId : "",
    auth.ident.via === "bearer"
  );
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  const updated = await prisma.chatSession.update({
    where: { id: params.sessionId },
    data: {
      ...(parsed.data.title !== undefined ? { title: parsed.data.title } : {}),
      ...(parsed.data.archived !== undefined
        ? { archived: parsed.data.archived }
        : {}),
    },
    select: { id: true, title: true, archived: true, updatedAt: true },
  });

  return NextResponse.json({
    id: updated.id,
    title: updated.title,
    archived: updated.archived,
    updatedAt: updated.updatedAt.toISOString(),
  });
}

/**
 * DELETE /api/contracts/[id]/chat-sessions/[sessionId]
 * Hard delete — cascade do Prisma apaga ChatMessages junto.
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string; sessionId: string } }
) {
  const auth = await requireApiAuth(req, { scope: "contracts:rw" });
  if (isAuthFailure(auth)) return authFailureResponse(auth);

  const result = await loadOwnedSession(
    params.id,
    params.sessionId,
    auth.org.id,
    auth.ident.via === "bearer" ? auth.ident.userId : "",
    auth.ident.via === "bearer"
  );
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  await prisma.chatSession.delete({ where: { id: params.sessionId } });
  return NextResponse.json({ ok: true });
}
