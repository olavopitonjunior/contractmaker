import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { chatSchema } from "@/lib/validation/schemas";
import { runContractAgent } from "@/lib/ai/agent";
import {
  requireApiAuth,
  isAuthFailure,
  authFailureResponse,
} from "@/lib/api/require-auth";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await requireApiAuth(req, { scope: "contracts:rw" });
  if (isAuthFailure(auth)) return authFailureResponse(auth);

  const body = await req.json();
  const parsed = chatSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const contract = await prisma.contract.findUnique({
    where: { id: params.id },
  });
  if (!contract) {
    return NextResponse.json({ error: "Contract not found" }, { status: 404 });
  }

  // Cross-user guard via Bearer: usuário só conversa com seus próprios contratos.
  if (auth.ident.via === "bearer" && contract.userId !== auth.ident.userId) {
    return NextResponse.json(
      { error: "Forbidden", reason: "not the contract owner" },
      { status: 403 }
    );
  }

  if (contract.status === "aprovado") {
    return NextResponse.json(
      {
        message:
          "Este contrato já foi aprovado e não pode ser alterado via chat.",
        htmlContent: null,
      },
      { status: 403 }
    );
  }

  try {
    const result = await runContractAgent({
      message: parsed.data.message,
      contractId: params.id,
      userId: auth.actor.effectiveUserId,
      orgId: auth.org.id,
    });

    return NextResponse.json({
      message: result.message,
      htmlContent: result.htmlContent,
      dataJson: result.dataJson,
      toolsUsed: result.changeLogs.map((l) => l.action),
    });
  } catch (error: unknown) {
    console.error("Agent error:", error);
    const message =
      error instanceof Error ? error.message : "Erro ao processar mensagem";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
