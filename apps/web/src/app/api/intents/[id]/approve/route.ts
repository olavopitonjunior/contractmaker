import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import {
  requireApiAuth,
  isAuthFailure,
  authFailureResponse,
} from "@/lib/api/require-auth";
import { audit, extractAuditContextFromRequest } from "@/lib/security/audit";
import { mergeAuditMetadata } from "@/lib/audit/newton";
import { executeIntent, IntentExecutionError } from "@/lib/api/intents";
import { guardPermission } from "@/lib/security/rbac/guard";
import { PERMISSION } from "@/lib/security/rbac/permissions";

/**
 * POST /api/intents/[id]/approve
 *
 * Aprova uma intent pendente. **session-only** (rejeita Bearer com 403):
 * a aprovação é o ponto humano-no-loop, não pode vir do mesmo agente que
 * criou a intent.
 *
 * Após aprovar, dispara `executeIntent` síncrono (resposta inclui o resultado
 * da execução). Se executor falhar, intent fica como `failed` com errorMessage.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await requireApiAuth(req);
  if (isAuthFailure(auth)) return authFailureResponse(auth);

  if (auth.ident.via !== "session") {
    return NextResponse.json(
      {
        error: "Forbidden",
        reason: "intent approval requires session auth (human-in-the-loop)",
      },
      { status: 403 }
    );
  }

  // Permissão do APROVADOR (2026-09-02). Até aqui esta rota exigia sessão e
  // mesma org — e mais nada: qualquer membro, `viewer` inclusive, aprovava uma
  // intent de alto risco pendente e disparava a execução (criar cobrança,
  // enviar envelope de assinatura, apagar negócio em definitivo).
  //
  // O agravante não era o buraco, era a fachada: `newton.intent.approve` já
  // existia, com rótulo na tela e concedida a `gestor_locacao`/
  // `gestor_financeiro` — e NENHUMA linha do código a lia. Permissão
  // decorativa é pior que permissão ausente: dá garantia onde não há
  // mecanismo.
  //
  // ANTES do fetch da intent, de propósito: senão o código de status ensina a
  // quem não pode aprovar se a intent existe e em que estado está.
  //
  // Ator EFETIVO já resolvido pelo `requireApiAuth` — não re-derivar aqui,
  // para não criar segunda fonte de verdade sobre o ator dentro do gate.
  const denied = await guardPermission({
    userId: auth.actor.effectiveUserId,
    orgId: auth.org.id,
    permission: PERMISSION.NEWTON_INTENT_APPROVE,
    message: "Você não tem permissão para aprovar esta ação.",
  });
  if (denied) return denied;

  const intent = await prisma.actionIntent.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      orgId: true,
      requestedBy: true,
      action: true,
      status: true,
      expiresAt: true,
    },
  });
  if (!intent) {
    return NextResponse.json({ error: "Not Found" }, { status: 404 });
  }
  if (intent.orgId !== auth.org.id) {
    return NextResponse.json({ error: "Not Found" }, { status: 404 });
  }
  if (intent.status !== "pending") {
    return NextResponse.json(
      {
        error: "Conflict",
        reason: `intent status is ${intent.status} (expected pending)`,
      },
      { status: 409 }
    );
  }
  if (intent.expiresAt < new Date()) {
    await prisma.actionIntent.update({
      where: { id: params.id },
      data: { status: "expired" },
    });
    return NextResponse.json(
      { error: "Gone", reason: "intent expired" },
      { status: 410 }
    );
  }

  // Marca approved
  await prisma.actionIntent.update({
    where: { id: params.id },
    data: {
      status: "approved",
      // O mesmo ator que o gate autorizou. Sob impersonação `ident.userId` é o
      // super_admin (sem membership no tenant) e `actor.effectiveUserId` é o
      // dono da org: gravar o primeiro faria a trilha nomear um aprovador
      // diferente daquele cuja permissão permitiu a aprovação. Quem impersonou
      // segue registrado na metadata de auditoria.
      approvedBy: auth.actor.effectiveUserId,
      approvedAt: new Date(),
    },
  });

  await audit(
    extractAuditContextFromRequest(req, auth.org.id, auth.ident.userId),
    {
      action: "INTENT_APPROVED",
      result: "SUCCESS",
      resource: params.id,
      resourceType: "ActionIntent",
      metadata: mergeAuditMetadata(
        { intentAction: intent.action, requestedBy: intent.requestedBy },
        auth.actor
      ),
    }
  );

  // Executa síncrono. Se falha, retorna 500 com detalhe; intent fica failed.
  try {
    const result = await executeIntent(params.id);
    return NextResponse.json(
      { ok: true, intentId: params.id, result },
      { status: 200 }
    );
  } catch (err) {
    if (err instanceof IntentExecutionError) {
      const code = err.code === "no_executor" ? 501 : 500;
      return NextResponse.json(
        { error: "Execution Failed", reason: err.message, code: err.code },
        { status: code }
      );
    }
    throw err;
  }
}
