import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import {
  requireApiAuth,
  isAuthFailure,
  authFailureResponse,
} from "@/lib/api/require-auth";

/**
 * GET /api/intents/[id]
 *
 * Polling de status pelo dono da intent. Aceita Bearer (qualquer scope) ou
 * session. 404 se não pertence ao caller (mesmo userId+orgId).
 *
 * Resposta inclui o `resultJson` se status=executed (cliente externo replays
 * o que o servidor executou).
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await requireApiAuth(req);
  if (isAuthFailure(auth)) return authFailureResponse(auth);

  const intent = await prisma.actionIntent.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      orgId: true,
      requestedBy: true,
      action: true,
      status: true,
      preview: true,
      approvedAt: true,
      executedAt: true,
      expiresAt: true,
      rejectionReason: true,
      resultJson: true,
      errorMessage: true,
      createdAt: true,
    },
  });
  if (!intent) {
    return NextResponse.json({ error: "Not Found" }, { status: 404 });
  }
  if (intent.orgId !== auth.org.id || intent.requestedBy !== auth.ident.userId) {
    return NextResponse.json({ error: "Not Found" }, { status: 404 });
  }

  return NextResponse.json({
    id: intent.id,
    action: intent.action,
    status: intent.status,
    preview: intent.preview,
    approvedAt: intent.approvedAt?.toISOString() ?? null,
    executedAt: intent.executedAt?.toISOString() ?? null,
    expiresAt: intent.expiresAt.toISOString(),
    rejectionReason: intent.rejectionReason,
    result: intent.resultJson,
    errorMessage: intent.errorMessage,
    createdAt: intent.createdAt.toISOString(),
  });
}
