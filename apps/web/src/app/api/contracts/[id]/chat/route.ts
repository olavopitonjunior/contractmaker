import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { chatSchema } from "@/lib/validation/schemas";
import { streamContractAgent } from "@/lib/ai/agent";
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

  // SSE response — cada AgentEvent vira uma frame `data: <json>\n\n`.
  // O cliente parseia em ChatPanel via ReadableStreamReader e renderiza
  // chips ao vivo conforme tool_use/tool_result chegam.
  const encoder = new TextEncoder();
  const agentParams = {
    message: parsed.data.message,
    contractId: params.id,
    userId: auth.actor.effectiveUserId,
    orgId: auth.org.id,
    mode: parsed.data.mode,
  };

  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const event of streamContractAgent(agentParams)) {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(event)}\n\n`)
          );
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Erro ao processar mensagem";
        console.error("[chat SSE] error:", err);
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ type: "error", message })}\n\n`)
        );
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
