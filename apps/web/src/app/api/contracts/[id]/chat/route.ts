import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { chatSchema } from "@/lib/validation/schemas";
import { streamContractAgent } from "@/lib/ai/agent";
import { runOrchestrator } from "@/lib/ai/orchestrator/graph";
import { classifyIntent } from "@/lib/ai/orchestrator/routing";
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
    include: { deal: { include: { pipeline: { select: { orgId: true } } } } },
  });
  if (!contract) {
    return NextResponse.json({ error: "Contract not found" }, { status: 404 });
  }

  // Cross-org guard (vale pra session E bearer): o agente IA lê PII e muta o
  // doc — antes só bearer era checado, então sessão de outra org tinha IDOR.
  if (contract.deal.pipeline.orgId !== auth.org.id) {
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
    sessionId: parsed.data.sessionId,
    attachmentIds: parsed.data.attachmentIds,
  };

  // Feature flag F2: ENABLE_MULTI_AGENT=true roteia informational/edit_simple/
  // review pro orquestrador multi-agente (Analyst+Legal+Editor+Curator com
  // Sentinel). edit_multi continua no legacy (Plan-and-approve via
  // streamContractAgent que escreve ChatPlan).
  // F5: multi-agent é DEFAULT. Pra desligar (rollback), set ENABLE_MULTI_AGENT=false.
  // Todos os intents (informational, edit_simple, edit_multi, review, propose)
  // são roteados via graph — edit_multi força propose_plan no Editor.
  void classifyIntent; // mantido pra debug/log futuro
  const useMultiAgent = process.env.ENABLE_MULTI_AGENT !== "false";

  const stream = new ReadableStream({
    async start(controller) {
      try {
        const eventStream = useMultiAgent
          ? runOrchestrator({
              contractId: agentParams.contractId,
              userId: agentParams.userId,
              orgId: agentParams.orgId,
              sessionId: agentParams.sessionId,
              userMessage: agentParams.message,
              mode: agentParams.mode ?? "plan",
              attachmentIds: agentParams.attachmentIds,
            })
          : streamContractAgent(agentParams);
        for await (const event of eventStream) {
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
