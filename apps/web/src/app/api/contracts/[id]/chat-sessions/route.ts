import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import {
  requireApiAuth,
  isAuthFailure,
  authFailureResponse,
} from "@/lib/api/require-auth";
import { guardContractScope } from "@/lib/deals/route-helpers";

export const runtime = "nodejs";

/**
 * GET /api/contracts/[id]/chat-sessions
 * Lista sessions não-arquivadas do contrato pra montar a sidebar.
 * Retorna `[{ id, title, updatedAt, msgCount }]` ordenado por updatedAt desc.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await requireApiAuth(req, { scope: "contracts:rw" });
  if (isAuthFailure(auth)) return authFailureResponse(auth);

  const contract = await prisma.contract.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      userId: true,
      deal: { select: { pipeline: { select: { orgId: true } } } },
    },
  });
  // Cross-org check pra session E bearer — 404 pra não vazar existência.
  if (!contract || contract.deal.pipeline.orgId !== auth.org.id) {
    return NextResponse.json({ error: "Contract not found" }, { status: 404 });
  }
  if (auth.ident.via === "bearer" && contract.userId !== auth.ident.userId) {
    return NextResponse.json(
      { error: "Forbidden", reason: "not the contract owner" },
      { status: 403 }
    );
  }

  // Escopo do gerente.
  const denied = await guardContractScope({
    contractId: params.id,
    userId: auth.actor.effectiveUserId,
    orgId: auth.org.id,
    via: auth.ident.via,
  });
  if (denied) return denied;

  const sessions = await prisma.chatSession.findMany({
    where: { contractId: params.id, archived: false },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      title: true,
      updatedAt: true,
      createdAt: true,
      _count: { select: { messages: true } },
    },
  });

  return NextResponse.json(
    sessions.map((s) => ({
      id: s.id,
      title: s.title,
      updatedAt: s.updatedAt.toISOString(),
      createdAt: s.createdAt.toISOString(),
      msgCount: s._count.messages,
    }))
  );
}

/**
 * POST /api/contracts/[id]/chat-sessions
 * Cria uma nova session vazia (sem mensagens). UI vai chamar isso quando
 * usuário clicar "+ Nova sessão" na sidebar.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await requireApiAuth(req, { scope: "contracts:rw" });
  if (isAuthFailure(auth)) return authFailureResponse(auth);

  const contract = await prisma.contract.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      userId: true,
      deal: { select: { pipeline: { select: { orgId: true } } } },
    },
  });
  // Cross-org check pra session E bearer — 404 pra não vazar existência.
  if (!contract || contract.deal.pipeline.orgId !== auth.org.id) {
    return NextResponse.json({ error: "Contract not found" }, { status: 404 });
  }
  if (auth.ident.via === "bearer" && contract.userId !== auth.ident.userId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Escopo do gerente.
  const denied = await guardContractScope({
    contractId: params.id,
    userId: auth.actor.effectiveUserId,
    orgId: auth.org.id,
    via: auth.ident.via,
  });
  if (denied) return denied;

  const session = await prisma.chatSession.create({
    data: {
      contractId: params.id,
      userId: auth.actor.effectiveUserId,
    },
    select: {
      id: true,
      title: true,
      updatedAt: true,
      createdAt: true,
    },
  });

  return NextResponse.json(
    {
      id: session.id,
      title: session.title,
      updatedAt: session.updatedAt.toISOString(),
      createdAt: session.createdAt.toISOString(),
      msgCount: 0,
    },
    { status: 201 }
  );
}
