/**
 * Curator autorun — dispara análise automática do Curator pós-aprovação
 * de contrato. Roda fire-and-forget; falha não bloqueia o fluxo de approve.
 *
 * Fluxo:
 *   1. Cria ChatSession sistema (userId do aprovador, title distintivo)
 *   2. Carrega contractContext via loadContext
 *   3. O Curator carrega seu próprio preâmbulo (expertContextFor) já escopado
 *   4. Roda runCurator com prompt sintético + forceToolUse=true já no curator.ts
 *   5. Persiste ChatMessage(s) com events completos
 *
 * Curator vai chamar:
 *   - find_similar_contracts → busca padrões em ContractMemory
 *   - propose_new_clause → cria ClauseProposal pendente se padrão detectado
 *   - propose_template_change → cria TemplateSuggestion se edição manual
 *     recorrente
 *
 * Sentinel já bloqueia propostas sem evidence (rule
 * `no_template_change_without_evidence`), então forceToolUse não cria
 * propostas vazias — só garante que o agente CONSULTE a memória.
 *
 * Sessão fica visível no histórico do chat com title "Curator auto-análise".
 */

import { prisma } from "@/lib/db/prisma";
import { loadContext } from "./shared/context";
import { runCurator } from "./specialists/curator";
import type { OrchestratorState, ToolCallRecord } from "./orchestrator/state";
import type { AgentEvent } from "./types";

const AUTORUN_PROMPT = `Esta é uma análise AUTOMÁTICA disparada após aprovação do contrato. Você é o Curador.

OBJETIVO: detectar padrões recorrentes nos contratos aprovados desta organização que ainda não estão na biblioteca de cláusulas — e propor a inclusão.

PASSOS OBRIGATÓRIOS (nesta ordem):
1. Chame \`find_similar_contracts\` com o foco "padrões emergentes" pra ver os últimos contratos aprovados similares.
2. Se detectar que ≥2 contratos aprovados têm:
   - Mesma cláusula manual fora da biblioteca → chame \`propose_new_clause\` com evidence dos contractMemory ids.
   - Mesma edição manual sobre um template → chame \`propose_template_change\` com hunks (before/after) + evidence.
3. Se nenhum padrão emergente → responda brevemente "Nenhum padrão detectado neste turno." Não force propostas frágeis.

REGRAS:
- Sentinel rejeita \`propose_template_change\` sem evidence.length >= 1.
- Não invente conteúdo — extraia das memórias de contratos aprovados.
- Responda em PT-BR objetivo descrevendo o que propôs (ou nada).`;

/**
 * Dispara o Curator pra contractId fire-and-forget.
 * Resolve quando termina (não bloqueia); erros são logados.
 */
export async function enqueueCuratorAnalysis(contractId: string): Promise<void> {
  try {
    const contract = await prisma.contract.findUnique({
      where: { id: contractId },
      select: {
        id: true,
        userId: true,
        deal: { select: { pipeline: { select: { orgId: true } } } },
      },
    });
    if (!contract) {
      console.error("[curator-autorun] contrato não encontrado:", contractId);
      return;
    }
    const orgId = contract.deal.pipeline.orgId;

    // Sessão sistema distintiva — usuário ainda vê no histórico mas com title
    // claro. authorId = aprovador (system não tem id próprio).
    const session = await prisma.chatSession.create({
      data: {
        contractId,
        userId: contract.userId,
        title: "Curador — análise pós-aprovação",
      },
    });

    // Reusa o mesmo loadContext do graph pra ter activeClauses + googleDoc text.
    const ctx = await loadContext(contractId, orgId);

    // Expert-context (top similares + top cláusulas) pra Curator ter dados de
    // entrada antes de chamar find_similar_contracts.

    const state: OrchestratorState = {
      contractId,
      userId: contract.userId,
      orgId,
      sessionId: session.id,
      userMessage: AUTORUN_PROMPT,
      mode: "plan",
      intent: "propose",
      contractContext: ctx,
      specialistOutputs: {},
      events: [],
      usage: {
        totalTokens: 0,
        promptTokens: 0,
        completionTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        latencyMs: 0,
        byAgent: {},
      },
    };

    const events: AgentEvent[] = [
      { type: "agent_started", agent: "curator", model: "claude-haiku-4-5-20251001" },
    ];

    let toolCalls: ToolCallRecord[] = [];
    let text = "";
    try {
      const output = await runCurator(state);
      toolCalls = output.toolCalls;
      text = output.text;
      for (const tc of toolCalls) {
        events.push({
          type: "tool_use",
          name: tc.name,
          input: tc.input,
          iteration: 1,
        });
        events.push({
          type: "tool_result",
          name: tc.name,
          iteration: 1,
          success: tc.success,
          summary: tc.summary.slice(0, 200),
        });
      }
      events.push({
        type: "agent_completed",
        agent: "curator",
        success: true,
        summary: `${toolCalls.length} tool(s) executada(s)`,
      });
      events.push({ type: "text_delta", text });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[curator-autorun] runCurator falhou:", err);
      text = `Curador falhou: ${msg.slice(0, 200)}`;
      events.push({
        type: "agent_completed",
        agent: "curator",
        success: false,
        summary: msg.slice(0, 200),
      });
    }

    await prisma.chatMessage.createMany({
      data: [
        {
          sessionId: session.id,
          role: "user",
          content: "(análise automática disparada pela aprovação do contrato)",
        },
        {
          sessionId: session.id,
          role: "assistant",
          content: text || "(sem texto)",
          metadata: {
            mode: "plan",
            intent: "propose",
            trigger: "auto-on-approve",
          } as object,
          events: events as object,
        },
      ],
    });
  } catch (err) {
    console.error("[curator-autorun] crash inesperado:", err);
  }
}
