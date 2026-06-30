import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db/prisma";
import {
  requireApiAuth,
  isAuthFailure,
  authFailureResponse,
} from "@/lib/api/require-auth";
import { audit, extractAuditContextFromRequest } from "@/lib/security/audit";
import { mergeAuditMetadata } from "@/lib/audit/newton";

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await requireApiAuth(req, { scope: "contracts:rw" });
  if (isAuthFailure(auth)) return authFailureResponse(auth);

  // Cross-org guard: antes o GET listava comentários (análise jurídica, notas
  // de negociação) de qualquer contrato por ID, sem checar org.
  const owner = await prisma.contract.findUnique({
    where: { id: params.id },
    select: { deal: { select: { pipeline: { select: { orgId: true } } } } },
  });
  if (!owner || owner.deal.pipeline.orgId !== auth.org.id) {
    return NextResponse.json({ error: "Contrato não encontrado" }, { status: 404 });
  }

  const url = new URL(req.url);
  const includeResolved = url.searchParams.get("includeResolved") === "true";

  const comments = await prisma.contractComment.findMany({
    where: {
      contractId: params.id,
      ...(includeResolved ? {} : { resolved: false }),
      parentId: null,
    },
    include: {
      replies: {
        orderBy: { createdAt: "asc" },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(comments);
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await requireApiAuth(req, { scope: "contracts:rw" });
  if (isAuthFailure(auth)) return authFailureResponse(auth);

  const body = await req.json().catch(() => null);
  if (!body?.text || !body?.selectedText) {
    return NextResponse.json({ error: "text e selectedText são obrigatórios" }, { status: 400 });
  }

  const contract = await prisma.contract.findUnique({
    where: { id: params.id },
    include: { deal: { select: { pipeline: { select: { orgId: true } } } } },
  });
  if (!contract) {
    return NextResponse.json({ error: "Contrato não encontrado" }, { status: 404 });
  }
  // Cross-org guard (session E bearer): antes só bearer checava dono.
  if (contract.deal.pipeline.orgId !== auth.org.id) {
    return NextResponse.json({ error: "Contrato não encontrado" }, { status: 404 });
  }
  // Cross-user guard adicional via Bearer
  if (auth.ident.via === "bearer" && contract.userId !== auth.ident.userId) {
    return NextResponse.json(
      { error: "Forbidden", reason: "not the contract owner" },
      { status: 403 }
    );
  }
  if (contract.status === "aprovado") {
    return NextResponse.json({ error: "Contrato aprovado não pode receber comentários" }, { status: 403 });
  }

  // Quando o contrato é um Google Doc, espelha o comment no Drive Comments API.
  // Se o trecho não for encontrado no doc, falha 422 — sem isso o usuário cria
  // um comentário "fantasma" (existe no app mas sem âncora no doc visível).
  let googleCommentId: string | null = null;
  if (contract.googleDocId) {
    try {
      const { createAnchoredComment } = await import("@/lib/google/comments");
      const res = await createAnchoredComment({
        docId: contract.googleDocId,
        selectedText: body.selectedText,
        content: body.text,
      });
      googleCommentId = res.id;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[comments POST] Falha ao criar Drive comment:", err);
      if (msg.includes("Texto-âncora não encontrado")) {
        return NextResponse.json(
          { error: "Trecho de referência não encontrado no contrato. Copie o texto exato do Google Doc." },
          { status: 422 }
        );
      }
      return NextResponse.json(
        { error: `Falha ao criar comentário no Google Doc: ${msg.slice(0, 200)}` },
        { status: 502 }
      );
    }
  }

  // Author display name: para session usa session.user; para bearer usa
  // userId resolvido (pode ser enriquecido com prisma.user.findUnique se
  // virar friction).
  const authorName =
    auth.ident.via === "session"
      ? auth.ident.email ?? "Usuário"
      : `Newton (em nome do user ${auth.ident.userId.slice(0, 8)})`;

  const comment = await prisma.contractComment.create({
    data: {
      contractId: params.id,
      userId: auth.actor.effectiveUserId,
      authorName,
      authorType: "user",
      text: body.text,
      anchorId: randomUUID(),
      selectedText: body.selectedText,
      severity: body.severity || "info",
      googleCommentId,
    },
  });

  await audit(
    extractAuditContextFromRequest(
      req,
      auth.org.id,
      auth.actor.effectiveUserId
    ),
    {
      action: "CONTRACT_COMMENT_ADD",
      result: "SUCCESS",
      resource: comment.id,
      resourceType: "ContractComment",
      metadata: mergeAuditMetadata(
        { contractId: params.id, severity: comment.severity },
        auth.actor
      ),
    }
  );

  return NextResponse.json(comment, { status: 201 });
}
