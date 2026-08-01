import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import {
  requireApiAuth,
  isAuthFailure,
  authFailureResponse,
} from "@/lib/api/require-auth";
import { executeToolHandler } from "@/lib/ai/tool-handlers";
import { assertContractBudget, ContractBudgetExceededError } from "@/lib/ai/budget";
import type { AgentContext, AgentEvent, PlanStep } from "@/lib/ai/types";
import { unmetDependencies } from "@/lib/ai/plan-deps";
import { getDocPlainText } from "@/lib/google/docs";
import { guardContractScope } from "@/lib/deals/route-helpers";
import { PERMISSION } from "@/lib/security/rbac/permissions";

export const runtime = "nodejs";
export const maxDuration = 300;

const schema = z.object({
  planId: z.string().cuid(),
  approvedStepIds: z.array(z.string()).default([]),
  /** Sobreescreve o `input` de um step antes de executar. Usado quando o
   *  usuário edita um write via dialog do PlanCard antes de aprovar.
   *  Shape: { [stepId]: { ...novoInput } } */
  stepInputOverrides: z.record(z.string(), z.record(z.string(), z.unknown())).optional(),
});

/**
 * POST /api/contracts/[id]/chat/execute-plan
 * Body: { planId, approvedStepIds: string[] }
 *
 * Executa os write steps de um ChatPlan que o usuario aprovou via PlanCard.
 * Steps nao listados em approvedStepIds viram "rejected" (e podem ser
 * editados/aprovados em chamada subsequente — futuro). Streama SSE com
 * tool_use/tool_result/plan_step_result/done eventos, igual /chat.
 *
 * Ao final, persiste uma nova ChatMessage role=assistant resumindo
 * "Executei X de Y steps". O ChatPlan.status vira "completed".
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await requireApiAuth(req, { scope: "contracts:rw" });
  if (isAuthFailure(auth)) return authFailureResponse(auth);

  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }
  const { planId, approvedStepIds, stepInputOverrides } = parsed.data;

  const plan = await prisma.chatPlan.findUnique({
    where: { id: planId },
    include: {
      session: {
        include: {
          contract: {
            include: {
              template: true,
              clauses: {
                where: { isActive: true },
                include: {
                  knowledgeItem: {
                    select: { id: true, title: true, subcategory: true, category: true },
                  },
                },
                orderBy: { position: "asc" },
              },
              deal: { select: { pipeline: { select: { orgId: true } } } },
            },
          },
        },
      },
    },
  });
  // Cross-org check pra session E bearer — 404 pra não vazar existência.
  if (
    !plan ||
    plan.session.contractId !== params.id ||
    plan.session.contract.deal.pipeline.orgId !== auth.org.id
  ) {
    return NextResponse.json({ error: "Plan not found" }, { status: 404 });
  }
  if (
    auth.ident.via === "bearer" &&
    plan.session.contract.userId !== auth.ident.userId
  ) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Escopo do gerente + CONTRACT_EDIT (o plano aplica edições no documento).
  const denied = await guardContractScope({
    contractId: params.id,
    userId: auth.actor.effectiveUserId,
    orgId: auth.org.id,
    via: auth.ident.via,
    permission: PERMISSION.CONTRACT_EDIT,
  });
  if (denied) return denied;
  if (plan.status !== "proposed") {
    return NextResponse.json(
      { error: `Plan já está em status '${plan.status}', não pode ser executado novamente.` },
      { status: 409 }
    );
  }
  if (plan.session.contract.status === "aprovado") {
    return NextResponse.json(
      { error: "Contrato aprovado — alterações bloqueadas." },
      { status: 403 }
    );
  }

  try {
    await assertContractBudget(params.id);
  } catch (err) {
    if (err instanceof ContractBudgetExceededError) {
      return NextResponse.json({ error: err.message }, { status: 429 });
    }
    throw err;
  }

  const contract = plan.session.contract;
  const orgId = contract.deal.pipeline.orgId;
  // Autor das entries de ChangeLog = quem APROVOU o plano (ator da request,
  // já resolvido pra identidade efetiva sob impersonation), não o dono do
  // contrato — `contract.userId` fazia o histórico creditar sempre o mesmo
  // usuário, independente de quem clicou.
  const actorUserId = auth.actor.effectiveUserId;

  // Reconstroi AgentContext (mesma logica de loadContext em agent.ts).
  let htmlContent = contract.htmlContent || "";
  if (contract.googleDocId) {
    try {
      htmlContent = await getDocPlainText(contract.googleDocId);
    } catch {
      // fallback ao snapshot
    }
  }
  const context: AgentContext = {
    contractId: contract.id,
    userId: contract.userId,
    orgId,
    htmlContent,
    dataJson: contract.dataJson as Record<string, unknown>,
    templateModalidade: contract.template?.modalidade || "a_vista",
    templateName: contract.template?.name ?? "Contrato importado",
    activeClauses: contract.clauses.map((cc) => ({
      id: cc.id,
      clauseId: cc.knowledgeItem.id,
      title: cc.knowledgeItem.title,
      category: cc.knowledgeItem.subcategory ?? cc.knowledgeItem.category,
      position: cc.position,
      isActive: cc.isActive,
    })),
    googleDocId: contract.googleDocId,
    sessionId: plan.sessionId,
  };

  const steps = plan.stepsJson as unknown as PlanStep[];
  const approvedSet = new Set(approvedStepIds);

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const events: AgentEvent[] = [];
      const send = (event: AgentEvent) => {
        events.push(event);
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };

      // Snapshots htmlBefore/htmlAfter por write step pra alimentar o
      // ChangesPanel. Mesma logica do streamContractAgent em agent.ts —
      // sem isso writes via Plan-execute nao aparecem no painel.
      type ChangeLogEntry = {
        action: string;
        summary: string;
        details: object;
        htmlBefore?: string;
        htmlAfter?: string;
      };
      const changeLogs: ChangeLogEntry[] = [];

      try {
        let iteration = 0;
        let executedCount = 0;
        let failedCount = 0;
        let rejectedCount = 0;
        let skippedCount = 0;

        for (const step of steps) {
          if (step.type !== "write") continue;
          if (step.status !== "pending") continue;

          if (!approvedSet.has(step.id)) {
            step.status = "rejected";
            rejectedCount++;
            send({
              type: "plan_step_result",
              planId,
              stepId: step.id,
              status: "rejected",
            });
            continue;
          }

          // Guarda de dependência: se este step pressupõe o sucesso de outro
          // (dependsOn) e a dependência NÃO foi executada com sucesso, pula em
          // vez de rodar com premissa falsa (ex.: add_comment afirmando que uma
          // cláusula foi inserida quando o insert_clause falhou).
          {
            const unmet = unmetDependencies(step, steps);
            if (unmet.length > 0) {
              const why = unmet
                .map((dep) => `"${dep.description}" (${dep.status})`)
                .join("; ");
              step.status = "skipped";
              step.result = {
                success: false,
                summary: `Pulado: depende de ${why} que não foi concluído com sucesso.`,
              };
              skippedCount++;
              send({
                type: "plan_step_result",
                planId,
                stepId: step.id,
                status: "skipped",
                summary: step.result.summary,
              });
              continue;
            }
          }

          // Aplica override de input se o usuario editou o step antes de
          // aprovar. Persiste no step pra que stepsJson final reflita o
          // que foi de fato executado (auditoria + UI rehydrate).
          const override = stepInputOverrides?.[step.id];
          if (override && typeof override === "object") {
            step.input = override as Record<string, unknown>;
          }

          iteration++;
          send({
            type: "tool_use",
            name: step.tool,
            input: step.input,
            iteration,
          });

          // Snapshot ANTES — so vale a pena pra writes contra GDoc.
          let htmlBefore: string | undefined;
          if (context.googleDocId) {
            try {
              htmlBefore = await getDocPlainText(context.googleDocId);
            } catch {
              // Falha de Drive nao bloqueia execucao.
            }
          }

          let result: { error?: string; success?: boolean; [k: string]: unknown };
          try {
            result = (await executeToolHandler(step.tool, step.input, context)) as {
              error?: string;
              success?: boolean;
            };
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            result = { error: `Tool ${step.tool} falhou: ${msg.slice(0, 200)}` };
          }

          // Snapshot DEPOIS — so se before foi capturado e nao houve erro.
          let htmlAfter: string | undefined;
          if (htmlBefore !== undefined && context.googleDocId && !result.error) {
            try {
              htmlAfter = await getDocPlainText(context.googleDocId);
            } catch {
              htmlAfter = htmlBefore;
            }
          }

          const success = !result.error;
          step.status = success ? "executed" : "failed";
          step.result = {
            success,
            summary: success ? "OK" : String(result.error).slice(0, 200),
          };

          // Push ChangeLog entry pra persistir no final do turn (mesmo
          // formato que agent.ts gera, action=ai_edit).
          changeLogs.push({
            action: "ai_edit",
            summary: step.description || `Executou ${step.tool}`,
            details: { tool: step.tool, input: step.input, output: result, planId },
            htmlBefore,
            htmlAfter,
          });

          send({
            type: "tool_result",
            name: step.tool,
            iteration,
            success,
            summary: step.result.summary,
          });
          send({
            type: "plan_step_result",
            planId,
            stepId: step.id,
            status: step.status,
            summary: step.result.summary,
          });

          if (success) executedCount++;
          else failedCount++;
        }

        // Persiste change logs com snapshots (cap 50kb cada). Sem isso, o
        // painel Mudanças nao mostra os writes do plan-and-approve.
        if (changeLogs.length > 0) {
          const SNAPSHOT_CAP = 50_000;
          const trim = (s: string | undefined) =>
            s && s.length > SNAPSHOT_CAP ? s.slice(0, SNAPSHOT_CAP) : s ?? null;
          await prisma.contractChangeLog.createMany({
            data: changeLogs.map((log) => ({
              contractId: params.id,
              userId: actorUserId,
              action: log.action,
              summary: log.summary,
              details: log.details,
              source: "ai",
              htmlBefore: trim(log.htmlBefore),
              htmlAfter: trim(log.htmlAfter),
              sessionId: plan.sessionId,
            })),
          });
        }

        // Persiste steps atualizados + status final do plan
        await prisma.chatPlan.update({
          where: { id: planId },
          data: {
            stepsJson: steps as object,
            status: "completed",
          },
        });

        // Mensagem assistant de fechamento. Y = aprovados tentados (executed +
        // failed). Rejected aparecem em linha separada porque NAO foram parte
        // do conjunto aprovado.
        const approvedAttempted = executedCount + failedCount;
        const parts: string[] = [];
        if (approvedAttempted > 0) {
          parts.push(
            `Executei **${executedCount}** de ${approvedAttempted} alteraç${approvedAttempted === 1 ? "ão aprovada" : "ões aprovadas"}.`
          );
        }
        if (failedCount > 0) {
          parts.push(`⚠️ ${failedCount} falh${failedCount === 1 ? "ou" : "aram"}.`);
        }
        if (skippedCount > 0) {
          parts.push(
            `↷ ${skippedCount} ${skippedCount === 1 ? "pulada" : "puladas"} por dependência não concluída.`
          );
        }
        if (rejectedCount > 0) {
          parts.push(
            `${rejectedCount} ${rejectedCount === 1 ? "rejeitada (não selecionada)" : "rejeitadas (não selecionadas)"}.`
          );
        }
        const summary = parts.join("\n\n") || "Nenhuma alteração foi executada.";

        await prisma.chatMessage.create({
          data: {
            sessionId: plan.sessionId,
            role: "assistant",
            content: summary,
            metadata: { kind: "plan_execution", planId } as object,
            events: events as object,
          },
        });

        await prisma.chatSession.update({
          where: { id: plan.sessionId },
          data: { updatedAt: new Date() },
        });

        send({
          type: "done",
          result: {
            message: summary,
            htmlContent: null,
            dataJson: null,
            changeLogs: [],
            events,
          },
        });
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Erro ao executar plano";
        console.error("[execute-plan]", err);
        send({ type: "error", message });
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
