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
import { getEffectivePermissions, can } from "@/lib/security/rbac/check";
import { PERMISSION } from "@/lib/security/rbac/permissions";
import { getEffectiveUserId } from "@/lib/auth/impersonation";

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
  // existia, com rótulo na tela ("Aprovar ActionIntent do Newton (HITL)") e
  // concedida a `gestor_locacao`/`gestor_financeiro` — mas NENHUMA linha do
  // código a lia. O admin concedia ou negava e o sistema ignorava a decisão
  // nos dois sentidos. Permissão decorativa é pior que permissão ausente: dá
  // garantia onde não há mecanismo.
  //
  // Ator EFETIVO pelo mesmo motivo do `guardDealScope`: sob impersonação o id
  // da sessão é o do super_admin, que não tem membership no tenant.
  const effUserId = await getEffectiveUserId(auth.ident.userId);
  const approverPerms = await getEffectivePermissions(effUserId, auth.org.id);
  if (!approverPerms || !can(approverPerms, PERMISSION.NEWTON_INTENT_APPROVE)) {
    return NextResponse.json(
      {
        error: "PERMISSION_DENIED",
        permission: PERMISSION.NEWTON_INTENT_APPROVE,
      },
      { status: 403 }
    );
  }

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
      approvedBy: auth.ident.userId,
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
