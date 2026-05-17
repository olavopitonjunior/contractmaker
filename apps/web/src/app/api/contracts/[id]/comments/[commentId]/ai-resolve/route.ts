import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { streamContractAgent } from "@/lib/ai/agent";
import { runOrchestrator } from "@/lib/ai/orchestrator/graph";
import {
  requireApiAuth,
  isAuthFailure,
  authFailureResponse,
} from "@/lib/api/require-auth";
import { audit, extractAuditContextFromRequest } from "@/lib/security/audit";
import type { AgentEvent } from "@/lib/ai/types";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * "Resolver com IA" — roda o agente em modo Fast (Haiku, 1 turn, edição
 * direta em GDoc) com um prompt sintetizado a partir do comentário. Stream
 * SSE com os mesmos AgentEvent que /chat. No final, se o turn teve pelo
 * menos uma tool de edição com `success: true`, marca o comentário como
 * resolvido e dispara AuditLog `CONTRACT_COMMENT_AI_RESOLVED`.
 *
 * F6 (2026-05-16) — migrado pro orchestrator multi-agente. Quando
 * `ENABLE_MULTI_AGENT !== "false"`, usa `runOrchestrator` (graph) com
 * mode=fast + intent forçado a edit_simple via prompt. Fallback legacy
 * preservado pra rollback emergência (set ENABLE_MULTI_AGENT=false).
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string; commentId: string } }
) {
  const auth = await requireApiAuth(req, { scope: "contracts:rw" });
  if (isAuthFailure(auth)) return authFailureResponse(auth);

  const comment = await prisma.contractComment.findUnique({
    where: { id: params.commentId },
    include: {
      contract: {
        include: {
          deal: { include: { pipeline: { select: { orgId: true } } } },
        },
      },
    },
  });

  if (!comment || comment.contractId !== params.id) {
    return NextResponse.json({ error: "Comentário não encontrado" }, { status: 404 });
  }

  // Cross-org guard via Deal.pipeline.orgId (Contract não tem orgId direto).
  const contractOrgId = comment.contract?.deal?.pipeline?.orgId;
  if (!contractOrgId || contractOrgId !== auth.org.id) {
    return NextResponse.json(
      { error: "Forbidden", reason: "comment não pertence à sua org" },
      { status: 403 }
    );
  }

  if (comment.resolved) {
    return NextResponse.json(
      { error: "Comentário já resolvido" },
      { status: 409 }
    );
  }

  if (comment.contract?.status === "aprovado") {
    return NextResponse.json(
      { error: "Contrato aprovado — não pode ser alterado" },
      { status: 403 }
    );
  }

  // Monta prompt sintético. Instrução é severa: aplique direto OU pare
  // dizendo o que falta. Isso evita o loop "vou sugerir" que travaria o
  // comment em pending.
  const severity = comment.severity || "info";
  const suggestedMatch = comment.text.match(/Sugestão:\s*([\s\S]+)$/);
  const problemText = suggestedMatch
    ? comment.text.slice(0, suggestedMatch.index).trim()
    : comment.text;
  const suggestion = suggestedMatch ? suggestedMatch[1].trim() : null;

  const prompt =
    `Aplique direto a correção apontada por este comentário automático (sem sugestão, sem revisão).\n\n` +
    `Severidade: ${severity}\n` +
    `Trecho destacado: "${comment.selectedText}"\n` +
    `Problema: ${problemText}\n` +
    (suggestion ? `Sugestão: ${suggestion}\n` : "") +
    `\nUse edit_contract_section pra substituir o trecho destacado pelo texto corrigido.\n` +
    `Se a correção depender de um dado que NÃO está disponível no contrato (nome, CPF, valor, profissão, etc.), NÃO invente. ` +
    `Em vez disso, responda apenas explicando qual campo precisa ser preenchido manualmente e NÃO chame nenhuma tool de edição.`;

  const encoder = new TextEncoder();
  const collected: AgentEvent[] = [];

  // F6: graph multi-agente por default; fallback legacy via env=false.
  const useMultiAgent = process.env.ENABLE_MULTI_AGENT !== "false";

  const stream = new ReadableStream({
    async start(controller) {
      try {
        const eventStream = useMultiAgent
          ? runOrchestrator({
              contractId: params.id,
              userId: auth.actor.effectiveUserId,
              orgId: auth.org.id,
              userMessage: prompt,
              mode: "fast",
            })
          : streamContractAgent({
              message: prompt,
              contractId: params.id,
              userId: auth.actor.effectiveUserId,
              orgId: auth.org.id,
              mode: "fast",
            });
        for await (const event of eventStream) {
          collected.push(event);
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(event)}\n\n`)
          );

          if (event.type === "done") {
            // Critério de sucesso: pelo menos uma tool de edição rodou com
            // success: true. Senão, o agente "explicou" mas não corrigiu —
            // mantém pending.
            const appliedEdit = collected.some(
              (e) =>
                e.type === "tool_result" &&
                e.success &&
                [
                  "edit_contract_section",
                  "update_contract_data",
                  "insert_clause",
                  "remove_clause",
                ].includes(e.name)
            );

            const failedVerification = collected.some(
              (e) => e.type === "verification" && e.verified === false
            );

            if (appliedEdit && !failedVerification) {
              try {
                await prisma.contractComment.update({
                  where: { id: comment.id },
                  data: { resolved: true },
                });

                // Espelha no Drive Comments se houver
                if (comment.googleCommentId && comment.contract?.googleDocId) {
                  try {
                    const { resolveComment } = await import("@/lib/google/comments");
                    await resolveComment(
                      comment.contract.googleDocId,
                      comment.googleCommentId
                    );
                  } catch (err) {
                    console.error("[ai-resolve] Drive resolveComment falhou:", err);
                  }
                }

                await audit(
                  extractAuditContextFromRequest(req, auth.org.id, auth.actor.effectiveUserId),
                  {
                    action: "CONTRACT_COMMENT_AI_RESOLVED",
                    result: "SUCCESS",
                    resource: comment.id,
                    resourceType: "ContractComment",
                    metadata: {
                      contractId: params.id,
                      severity,
                      toolsUsed: collected
                        .filter((e) => e.type === "tool_result")
                        .map((e) => (e as { name: string }).name),
                    },
                  }
                );

                controller.enqueue(
                  encoder.encode(
                    `data: ${JSON.stringify({
                      type: "tool_result",
                      name: "_resolve_comment",
                      iteration: 99,
                      success: true,
                      summary: "Comentário marcado como resolvido",
                    })}\n\n`
                  )
                );
              } catch (err) {
                console.error("[ai-resolve] update comment falhou:", err);
              }
            } else {
              await audit(
                extractAuditContextFromRequest(req, auth.org.id, auth.actor.effectiveUserId),
                {
                  action: "CONTRACT_COMMENT_AI_RESOLVED",
                  result: "FAILURE",
                  resource: comment.id,
                  resourceType: "ContractComment",
                  metadata: {
                    contractId: params.id,
                    reason: failedVerification
                      ? "verification_failed"
                      : "no_edit_applied",
                  },
                }
              );
            }
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Erro inesperado";
        console.error("[ai-resolve SSE] error:", err);
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
