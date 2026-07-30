/**
 * Audit/time-travel — lê histórico de checkpoints do PostgresSaver pra
 * uma session específica. Permite reconstruir cada turn que o
 * orchestrator executou (qual intent, quais agents, tools, latência).
 *
 * Auth: requer session válida + contrato pertencente à org do user.
 *
 * Query params:
 *   sessionId — opcional. Default: ChatSession mais recente do contrato.
 *
 * Response shape:
 *   {
 *     sessionId,
 *     checkpoints: Array<{
 *       checkpointId,
 *       createdAt,
 *       step,
 *       nextNodes,
 *       intent,
 *       userMessage,
 *       finalMessage,
 *       agentsUsed,
 *       toolCalls: { name, success }[]
 *     }>
 *   }
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { getOrchestratorGraph } from "@/lib/ai/orchestrator/graph";
import type { ToolCallRecord } from "@/lib/ai/orchestrator/state";
import { resolveUserOrgId } from "@/lib/security/org-scope";
import { guardContractScope } from "@/lib/deals/route-helpers";

export const runtime = "nodejs";

interface CheckpointSummary {
  checkpointId: string;
  createdAt: string | null;
  step: number | null;
  nextNodes: string[];
  intent: string | null;
  userMessage: string | null;
  finalMessage: string | null;
  agentsUsed: string[];
  toolCalls: Array<{ name: string; success: boolean; agent: string }>;
}

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Cross-org guard via deal.pipeline.orgId — compara com a org do usuário
  // (antes só carregava o orgId sem comparar; qualquer sessão lia checkpoints
  // de qualquer contrato).
  const contract = await prisma.contract.findUnique({
    where: { id: params.id },
    include: {
      deal: {
        include: {
          pipeline: { select: { orgId: true } },
        },
      },
    },
  });
  const userOrgId = await resolveUserOrgId(session.user.id);
  if (!contract || !userOrgId || contract.deal.pipeline.orgId !== userOrgId) {
    return NextResponse.json({ error: "Contract not found" }, { status: 404 });
  }

  // Escopo do gerente.
  const denied = await guardContractScope({
    contractId: params.id,
    userId: session.user.id,
    orgId: userOrgId,
  });
  if (denied) return denied;

  // Resolve session
  const url = new URL(req.url);
  let sessionId = url.searchParams.get("sessionId");
  if (!sessionId) {
    const recent = await prisma.chatSession.findFirst({
      where: { contractId: params.id, archived: false },
      orderBy: { updatedAt: "desc" },
      select: { id: true },
    });
    if (!recent) {
      return NextResponse.json({
        sessionId: null,
        checkpoints: [],
        message: "Nenhuma session encontrada pra este contrato",
      });
    }
    sessionId = recent.id;
  } else {
    // Confirma que a session pertence ao contrato
    const sessionRow = await prisma.chatSession.findUnique({
      where: { id: sessionId },
      select: { contractId: true },
    });
    if (!sessionRow || sessionRow.contractId !== params.id) {
      return NextResponse.json(
        { error: "Session not found or wrong contract" },
        { status: 404 }
      );
    }
  }

  // Lê histórico do PostgresSaver
  const graph = getOrchestratorGraph();
  const checkpoints: CheckpointSummary[] = [];

  try {
    for await (const snapshot of graph.getStateHistory({
      configurable: { thread_id: sessionId },
    })) {
      const values = snapshot.values as Record<string, unknown>;
      const config = snapshot.config as { configurable?: { checkpoint_id?: string } };
      const metadata = (snapshot as { metadata?: { step?: number } }).metadata;

      const specialistOutputs =
        (values.specialistOutputs as Record<string, { toolCalls?: ToolCallRecord[] }>) ?? {};
      const agentsUsed = Object.keys(specialistOutputs);
      const toolCalls: CheckpointSummary["toolCalls"] = [];
      for (const [agent, out] of Object.entries(specialistOutputs)) {
        for (const tc of out.toolCalls ?? []) {
          toolCalls.push({ name: tc.name, success: tc.success, agent });
        }
      }

      checkpoints.push({
        checkpointId: config.configurable?.checkpoint_id ?? "",
        createdAt: (snapshot as { createdAt?: string }).createdAt ?? null,
        step: metadata?.step ?? null,
        nextNodes: Array.isArray(snapshot.next) ? (snapshot.next as string[]) : [],
        intent: (values.intent as string) ?? null,
        userMessage: (values.userMessage as string) ?? null,
        finalMessage: (values.finalMessage as string) ?? null,
        agentsUsed,
        toolCalls,
      });
    }
  } catch (err) {
    console.error("[audit] getStateHistory falhou:", err);
    return NextResponse.json(
      { error: "Falha ao ler checkpoints", detail: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }

  return NextResponse.json({
    sessionId,
    checkpointCount: checkpoints.length,
    checkpoints,
  });
}
