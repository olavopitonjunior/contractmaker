/**
 * Graph multi-agente. Cada node é uma função TS que chama Anthropic SDK
 * direto via runSpecialist; LangGraph cuida só de roteamento, estado
 * compartilhado e checkpointing.
 *
 * Fluxo F1 (informational):
 *   START → loadContext → router → legal → aggregator → END
 *
 * F2 adiciona analyst, editor, curator + Sentinel middleware.
 */

import type { Anthropic } from "@anthropic-ai/sdk";
import { Annotation, StateGraph, START, END } from "@langchain/langgraph";
import { loadContext } from "../shared/context";
import { loadExpertContext } from "../expert-context";
import { resolveSession, loadChatHistory } from "../shared/session";
import { getAnthropicClient, HAIKU_MODEL, SONNET_MODEL } from "../shared/anthropic-client";
import { recordAIUsage } from "../usage";
import { runAnalyst } from "../specialists/analyst";
import { runLegal } from "../specialists/legal";
import { runEditor } from "../specialists/editor";
import { runCurator } from "../specialists/curator";
import { quarantineAttachment } from "../sentinel/middleware";
import { mapToolToAction, buildToolSummary } from "../shared/tool-mapping";
import { resolveIntent } from "./intent-fallback";
import { getCheckpointer } from "./checkpointer";
import { prisma } from "@/lib/db/prisma";
import { loadChatHistory as _loadChatHistory } from "../shared/session";
import { getDealSigningState } from "@/lib/contracts/signing-state";
import type { AgentContext, AgentEvent, AgentMode } from "../types";
import type {
  OrchestratorState,
  SpecialistName,
  SpecialistOutput,
  ToolCallRecord,
  UsageAgg,
} from "./state";

// ============================================================
// State annotation (LangGraph reducers)
// ============================================================

const OrchestratorStateAnnotation = Annotation.Root({
  contractId: Annotation<string>(),
  userId: Annotation<string>(),
  orgId: Annotation<string>(),
  sessionId: Annotation<string>(),
  userMessage: Annotation<string>(),
  mode: Annotation<AgentMode>(),
  attachmentIds: Annotation<string[] | undefined>(),

  intent: Annotation<OrchestratorState["intent"]>(),
  contractContext: Annotation<AgentContext | undefined>(),
  expertContext: Annotation<string | undefined>(),
  attachmentBlock: Annotation<string | undefined>(),
  signingState: Annotation<OrchestratorState["signingState"]>(),

  specialistOutputs: Annotation<Partial<Record<SpecialistName, SpecialistOutput>>>({
    reducer: (prev, next) => ({ ...prev, ...next }),
    default: () => ({}),
  }),

  finalMessage: Annotation<string | undefined>(),

  events: Annotation<AgentEvent[]>({
    reducer: (prev, next) => [...prev, ...next],
    default: () => [],
  }),

  usage: Annotation<UsageAgg>({
    reducer: (prev, next) => ({
      totalTokens: prev.totalTokens + next.totalTokens,
      promptTokens: prev.promptTokens + next.promptTokens,
      completionTokens: prev.completionTokens + next.completionTokens,
      cacheReadTokens: prev.cacheReadTokens + next.cacheReadTokens,
      cacheWriteTokens: prev.cacheWriteTokens + next.cacheWriteTokens,
      latencyMs: prev.latencyMs + next.latencyMs,
      byAgent: { ...prev.byAgent, ...next.byAgent },
    }),
    default: () => ({
      totalTokens: 0,
      promptTokens: 0,
      completionTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      latencyMs: 0,
      byAgent: {},
    }),
  }),
});

type GraphState = typeof OrchestratorStateAnnotation.State;

// ============================================================
// Nodes
// ============================================================

async function loadContextNode(state: GraphState): Promise<Partial<GraphState>> {
  const context = await loadContext(state.contractId, state.orgId);

  let expertContext = "";
  if (state.mode === "plan") {
    try {
      expertContext = await loadExpertContext(context);
    } catch (err) {
      console.error("[graph:loadContext] loadExpertContext falhou:", err);
    }
  }

  // F4 iteração 2026-05-17 — busca signing state do deal pra Editor decidir
  // entre edit-no-draft e create-aditamento. Cross-deal lookup via Contract.dealId.
  let signingState: OrchestratorState["signingState"];
  try {
    const contractRow = await prisma.contract.findUnique({
      where: { id: state.contractId },
      select: { dealId: true },
    });
    if (contractRow?.dealId) {
      signingState = await getDealSigningState(contractRow.dealId);
    }
  } catch (err) {
    console.error("[graph:loadContext] getDealSigningState falhou:", err);
  }

  // Sentinel quarantine de attachments (route.ts passa attachmentIds).
  let attachmentBlock: string | undefined;
  const extraEvents: AgentEvent[] = [];
  if (state.attachmentIds && state.attachmentIds.length > 0) {
    const attachments = await prisma.chatAttachment.findMany({
      where: {
        id: { in: state.attachmentIds },
        sessionId: state.sessionId,
      },
      select: { name: true, source: true, sourceUrl: true, extractedText: true },
    });
    const parts: string[] = [];
    for (const a of attachments) {
      if (!a.extractedText || a.extractedText.trim().length === 0) continue;
      const quarantine = await quarantineAttachment(
        a.extractedText,
        { contractId: state.contractId, orgId: state.orgId, userId: state.userId },
        { fastPathOnly: false }
      );
      if (!quarantine.passed) {
        extraEvents.push({
          type: "tool_result",
          name: "sentinel_quarantine",
          iteration: 0,
          success: false,
          summary: `Anexo "${a.name}" quarantinado: ${quarantine.classification.intent} (score ${quarantine.classification.trustedScore.toFixed(2)})`,
        });
        continue;
      }
      const icon = a.source === "url" ? "🔗" : "📄";
      const label = a.source === "url" && a.sourceUrl ? `${a.name} (${a.sourceUrl})` : a.name;
      parts.push(`${icon} ${label}:\n${a.extractedText}`);
    }
    if (parts.length > 0) {
      attachmentBlock = `ANEXOS DESTE TURN (após filtragem Sentinel):\n\n${parts.join("\n\n---\n\n")}\n\n---\n`;
    }
  }

  return {
    contractContext: context,
    expertContext: expertContext || undefined,
    attachmentBlock,
    signingState,
    events: [
      {
        type: "started",
        mode: state.mode,
        model: state.mode === "fast" ? HAIKU_MODEL : SONNET_MODEL,
        hasExpertContext: !!expertContext,
      },
      ...extraEvents,
    ],
  };
}

async function routerNode(state: GraphState): Promise<Partial<GraphState>> {
  // FU3: heurística + fallback Haiku só pra casos ambíguos (informational
  // não-pergunta). resolveIntent cai na heurística em caso de falha.
  const intent = await resolveIntent(state.userMessage, {
    orgId: state.orgId,
    userId: state.userId,
    contractId: state.contractId,
  });
  return { intent };
}

async function analystNode(state: GraphState): Promise<Partial<GraphState>> {
  const events: AgentEvent[] = [
    { type: "agent_started", agent: "analyst", model: HAIKU_MODEL },
  ];

  let output: SpecialistOutput;
  try {
    output = await runAnalyst(state as OrchestratorState);
    events.push(...toolCallsAsEvents(output.toolCalls));
    events.push({
      type: "agent_completed",
      agent: "analyst",
      success: true,
      summary: `${output.toolCalls.length} tool(s) executada(s)`,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    output = { text: `Analista falhou: ${msg}`, toolCalls: [] };
    events.push({
      type: "agent_completed",
      agent: "analyst",
      success: false,
      summary: msg.slice(0, 200),
    });
  }

  return {
    specialistOutputs: { analyst: output },
    events,
  };
}

async function legalNode(state: GraphState): Promise<Partial<GraphState>> {
  const events: AgentEvent[] = [
    { type: "agent_started", agent: "legal", model: HAIKU_MODEL },
  ];

  let output: SpecialistOutput;
  try {
    output = await runLegal(state as OrchestratorState);
    events.push(...toolCallsAsEvents(output.toolCalls));
    events.push({
      type: "agent_completed",
      agent: "legal",
      success: true,
      summary: `${output.toolCalls.length} tool(s) executada(s)`,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    output = { text: `Jurídico falhou: ${msg}`, toolCalls: [] };
    events.push({
      type: "agent_completed",
      agent: "legal",
      success: false,
      summary: msg.slice(0, 200),
    });
  }

  return {
    specialistOutputs: { legal: output },
    events,
  };
}

async function editorNode(state: GraphState): Promise<Partial<GraphState>> {
  const events: AgentEvent[] = [
    { type: "agent_started", agent: "editor", model: SONNET_MODEL },
  ];

  let output: SpecialistOutput;
  try {
    output = await runEditor(state as OrchestratorState);
    events.push(...toolCallsAsEventsWithVerification(output.toolCalls));
    // F5: propose_plan emite evento dedicado pra UI mostrar PlanCard.
    for (const tc of output.toolCalls) {
      if (tc.name === "propose_plan" && tc.success && tc.rawResult?.planId) {
        events.push({
          type: "plan_proposed",
          planId: String(tc.rawResult.planId),
          steps: (tc.rawResult.steps as never) ?? [],
        });
      }
    }
    events.push({
      type: "agent_completed",
      agent: "editor",
      success: true,
      summary: `${output.toolCalls.length} tool(s) executada(s)`,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    output = { text: `Editor falhou: ${msg}`, toolCalls: [] };
    events.push({
      type: "agent_completed",
      agent: "editor",
      success: false,
      summary: msg.slice(0, 200),
    });
  }

  return {
    specialistOutputs: { editor: output },
    events,
  };
}

async function curatorNode(state: GraphState): Promise<Partial<GraphState>> {
  const events: AgentEvent[] = [
    { type: "agent_started", agent: "curator", model: HAIKU_MODEL },
  ];

  let output: SpecialistOutput;
  try {
    output = await runCurator(state as OrchestratorState);
    events.push(...toolCallsAsEvents(output.toolCalls));
    events.push({
      type: "agent_completed",
      agent: "curator",
      success: true,
      summary: `${output.toolCalls.length} tool(s) executada(s)`,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    output = { text: `Curador falhou: ${msg}`, toolCalls: [] };
    events.push({
      type: "agent_completed",
      agent: "curator",
      success: false,
      summary: msg.slice(0, 200),
    });
  }

  return {
    specialistOutputs: { curator: output },
    events,
  };
}

const AGGREGATOR_SYSTEM_PROMPT = `Você é o **Orquestrador** num time de agentes jurídicos especializados em contratos imobiliários brasileiros. Os especialistas já fizeram suas consultas e retornaram análises — sua tarefa é redigir a resposta final ao usuário em markdown estruturado.

REGRAS:

1. Responda em PT-BR com norma culta impecável.
2. NUNCA exiba JSON cru.
3. Se a pergunta for informativa (lista, explicação, status), responda com markdown organizado (≥100 caracteres). Use cabeçalhos, listas e tabelas quando ajudar.
4. **LEDGER DE ESCRITAS É A FONTE DA VERDADE SOBRE O QUE FOI APLICADO.** Você recebe um bloco "## LEDGER DE ESCRITAS (determinístico)". Ele — e SOMENTE ele — define o que mudou no documento. NUNCA afirme que algo "foi aplicado/alterado/realizado" se não estiver em **APLICADAS** no ledger.
   - Se houver itens em **APLICADAS**: use os 3 cabeçalhos LITERAIS \`## Alterações Realizadas\`, \`## Justificativa\`, \`## Verificação\`, descrevendo APENAS o que está em APLICADAS.
   - Se houver itens em **PENDENTES** (sugestões/planos aguardando aprovação) e nenhuma aplicada: use \`## Proposta (aguardando aprovação)\` e explique que o usuário precisa aprovar via PlanCard/track changes. NÃO diga "realizado".
   - Se houver **FALHAS** ou **NÃO APLICADAS** (edição não confirmada no documento): use \`## Não foi possível aplicar\`, explique o motivo objetivo do ledger e proponha o próximo passo. NÃO finja sucesso.
   - Se o ledger estiver inteiramente vazio e a mensagem era informativa: responda normalmente como consulta (sem cabeçalho de alteração).
5. **PROIBIDO INVENTAR "redação anterior".** Só cite o texto que estava no contrato se ele aparecer literalmente no contexto fornecido. NUNCA construa uma "redação anterior" plausível para depois "substituí-la".
6. Combine as saídas dos especialistas SEM repetir texto literal. Você é o ponto de síntese.
7. Cite legislação ou padrões da organização quando especialistas trouxeram evidência. Não invente.
8. Foque no contrato desta sessão. Não compare com outros contratos sem evidência ancorada.`;

// Variante de locação — mesma disciplina de ledger/síntese, domínio Lei 8.245/91.
const AGGREGATOR_SYSTEM_PROMPT_LOCACAO = AGGREGATOR_SYSTEM_PROMPT.replace(
  "contratos imobiliários brasileiros",
  "contratos de locação de imóveis no Brasil (Lei nº 8.245/91)"
);

async function aggregatorNode(state: GraphState): Promise<Partial<GraphState>> {
  const events: AgentEvent[] = [
    { type: "agent_started", agent: "orchestrator", model: state.mode === "fast" ? HAIKU_MODEL : SONNET_MODEL },
  ];

  const writeLedger = buildWriteLedger(state.specialistOutputs);
  const specialistContext = buildSpecialistContext(state, writeLedger);
  const anthropic = getAnthropicClient();
  const model = state.mode === "fast" ? HAIKU_MODEL : SONNET_MODEL;
  const t0 = Date.now();

  // Cache_control ephemeral via cast — SDK 0.30 ainda não tem o tipo;
  // mesma técnica usada em agent.ts:507-513.
  const isLocacao =
    state.contractContext?.dealKind === "locacao" ||
    (state.contractContext?.templateModalidade ?? "").startsWith("locacao");
  const systemBlocks = [
    {
      type: "text" as const,
      text: isLocacao ? AGGREGATOR_SYSTEM_PROMPT_LOCACAO : AGGREGATOR_SYSTEM_PROMPT,
      cache_control: { type: "ephemeral" as const },
    },
  ] as unknown as Anthropic.TextBlockParam[];

  try {
    const response = await anthropic.messages.create({
      model,
      max_tokens: 2048,
      temperature: 0.3,
      system: systemBlocks,
      messages: [
        {
          role: "user",
          content: `${specialistContext}\n\n---\nMENSAGEM ORIGINAL DO USUÁRIO:\n${state.userMessage}`,
        },
      ],
    });

    recordAIUsage({
      orgId: state.orgId,
      userId: state.userId,
      contractId: state.contractId,
      provider: "anthropic",
      model,
      operation: "chat",
      promptTokens: response.usage?.input_tokens ?? 0,
      completionTokens: response.usage?.output_tokens ?? 0,
      cacheReadTokens:
        (response.usage as { cache_read_input_tokens?: number })?.cache_read_input_tokens ?? 0,
      cacheWriteTokens:
        (response.usage as { cache_creation_input_tokens?: number })?.cache_creation_input_tokens ?? 0,
      latencyMs: Date.now() - t0,
      success: true,
    });

    const textBlock = response.content.find((b) => b.type === "text");
    let finalMessage =
      textBlock && textBlock.type === "text"
        ? textBlock.text
        : "Operação concluída.";

    // B2 — pós-condição anti-confabulação (defensiva): se NADA foi aplicado mas
    // o texto ainda afirma "Alterações Realizadas", anexa um aviso corretivo.
    // Garante que o usuário não seja induzido a erro mesmo se o LLM ignorar o ledger.
    let confabulationBlocked = false;
    if (
      writeLedger.applied.length === 0 &&
      /##\s*Altera[çc][õo]es\s+Realizadas/i.test(finalMessage)
    ) {
      confabulationBlocked = true;
      const banner =
        writeLedger.pending.length > 0
          ? "> ⚠️ **Nenhuma alteração foi aplicada ainda** — há proposta(s) aguardando sua aprovação.\n\n"
          : "> ⚠️ **Nenhuma alteração foi efetivamente aplicada ao documento.** Revise os detalhes abaixo.\n\n";
      finalMessage = banner + finalMessage;
    }

    events.push({
      type: "text_delta",
      text: finalMessage,
    });
    events.push({
      type: "agent_completed",
      agent: "orchestrator",
      success: true,
    });

    // Persiste ChangeLog (todas as tool_calls de editor/curator com snapshots)
    // e ChatMessage (user + assistant). Update contract.htmlContent quando
    // houve edição real.
    let hasEdits = false;
    try {
      const editorHasEdits = await persistChangeLogs(state, state.specialistOutputs.editor, state.sessionId);
      const curatorHasEdits = await persistChangeLogs(state, state.specialistOutputs.curator, state.sessionId);
      hasEdits = editorHasEdits || curatorHasEdits;
    } catch (err) {
      console.error("[aggregator] persistChangeLogs falhou:", err);
    }

    try {
      const sessionRow = await prisma.chatSession.findUnique({
        where: { id: state.sessionId },
        select: { title: true },
      });
      const autoTitle = !sessionRow?.title
        ? state.userMessage.length <= 60
          ? state.userMessage
          : state.userMessage.slice(0, 57).replace(/\s+\S*$/, "") + "…"
        : null;
      await prisma.chatSession.update({
        where: { id: state.sessionId },
        data: {
          updatedAt: new Date(),
          ...(autoTitle ? { title: autoTitle } : {}),
        },
      });
      // events: concatena state.events (acumulado pelos specialists via
      // reducer em graph.ts:65) com os events locais do aggregator. Sem
      // isso o histórico do chat perde tool_use/tool_result no refresh —
      // cliente vê chips em tempo real via SSE mas a rehidratação fica vazia.
      await prisma.chatMessage.createMany({
        data: [
          { sessionId: state.sessionId, role: "user", content: state.userMessage },
          {
            sessionId: state.sessionId,
            role: "assistant",
            content: finalMessage,
            metadata: { mode: state.mode, intent: state.intent } as object,
            events: [...state.events, ...events] as object,
          },
        ],
      });
    } catch (err) {
      console.error("[aggregator] persist chat falhou:", err);
    }

    // D2 — AgentRun: log/observabilidade do turn (ledger determinístico).
    // Fire-and-forget, nunca lança (igual recordAIUsage).
    try {
      const outcome = confabulationBlocked
        ? "confabulation_blocked"
        : ledgerOutcome(writeLedger, state.intent);
      const toolCalls = [
        ...(state.specialistOutputs.editor?.toolCalls ?? []),
        ...(state.specialistOutputs.curator?.toolCalls ?? []),
      ].map((c) => ({
        name: c.name,
        success: c.success,
        ...(c.htmlBefore !== undefined && c.htmlAfter !== undefined
          ? { applied: c.htmlBefore !== c.htmlAfter }
          : {}),
      }));
      const aggUsage = response.usage;
      void prisma.agentRun
        .create({
          data: {
            orgId: state.orgId,
            contractId: state.contractId,
            sessionId: state.sessionId,
            userId: state.userId,
            mode: state.mode,
            intent: state.intent ?? null,
            agentsRun: Object.keys(state.specialistOutputs),
            toolCallsJson: toolCalls as object,
            writesAttempted:
              writeLedger.applied.length +
              writeLedger.pending.length +
              writeLedger.notApplied.length +
              writeLedger.dataOnly.length +
              writeLedger.failed.length,
            writesApplied: writeLedger.applied.length,
            writesPending: writeLedger.pending.length,
            writesFailed: writeLedger.failed.length + writeLedger.notApplied.length,
            outcome,
            finalMessagePreview: finalMessage.slice(0, 2000),
            promptTokens: state.usage.promptTokens + (aggUsage?.input_tokens ?? 0),
            completionTokens: state.usage.completionTokens + (aggUsage?.output_tokens ?? 0),
            totalTokens:
              state.usage.totalTokens +
              (aggUsage?.input_tokens ?? 0) +
              (aggUsage?.output_tokens ?? 0),
            latencyMs: state.usage.latencyMs + (Date.now() - t0),
          },
        })
        .catch((e) => console.error("[aggregator] AgentRun.create falhou:", e));
    } catch (err) {
      console.error("[aggregator] AgentRun prep falhou:", err);
    }

    if (hasEdits && state.contractContext) {
      try {
        await prisma.contract.update({
          where: { id: state.contractId },
          data: {
            htmlContent: state.contractContext.htmlContent,
            dataJson: state.contractContext.dataJson as object,
          },
        });
      } catch (err) {
        console.error("[aggregator] update contract falhou:", err);
      }
    }

    return {
      finalMessage,
      events,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    recordAIUsage({
      orgId: state.orgId,
      userId: state.userId,
      contractId: state.contractId,
      provider: "anthropic",
      model,
      operation: "chat",
      promptTokens: 0,
      latencyMs: Date.now() - t0,
      success: false,
      errorMessage: msg,
    });
    events.push({
      type: "agent_completed",
      agent: "orchestrator",
      success: false,
      summary: msg.slice(0, 200),
    });
    return {
      finalMessage: `Falha no orquestrador: ${msg}`,
      events,
    };
  }
}

// ============================================================
// Helpers
// ============================================================

function toolCallsAsEvents(calls: ToolCallRecord[]): AgentEvent[] {
  const out: AgentEvent[] = [];
  let iter = 1;
  for (const call of calls) {
    out.push({
      type: "tool_use",
      name: call.name,
      input: call.input,
      iteration: iter,
    });
    out.push({
      type: "tool_result",
      name: call.name,
      iteration: iter,
      success: call.success,
      summary: call.summary,
    });
    iter++;
  }
  return out;
}

function toolCallsAsEventsWithVerification(calls: ToolCallRecord[]): AgentEvent[] {
  const out: AgentEvent[] = [];
  let iter = 1;
  for (const call of calls) {
    out.push({
      type: "tool_use",
      name: call.name,
      input: call.input,
      iteration: iter,
    });
    out.push({
      type: "tool_result",
      name: call.name,
      iteration: iter,
      success: call.success,
      summary: call.summary,
    });
    // Quando capturePostSnapshot mostrou que o doc não mudou após uma write
    // tool, emite verification:false pra UI sinalizar.
    if (call.htmlBefore !== undefined && call.htmlAfter !== undefined) {
      const verified = call.htmlBefore !== call.htmlAfter;
      out.push({
        type: "verification",
        tool: call.name,
        verified,
        detail: verified
          ? "Mutação confirmada via releitura do doc"
          : "Releitura não confirmou mudança no doc",
      });
    }
    iter++;
  }
  return out;
}

interface PersistedRecord {
  contractId: string;
  userId: string | null;
  action: string;
  summary: string;
  details: object;
  source: "ai" | "user" | "system";
  htmlBefore: string | null;
  htmlAfter: string | null;
  sessionId: string;
}

async function persistChangeLogs(
  state: GraphState,
  output: SpecialistOutput | undefined,
  sessionId: string
): Promise<boolean> {
  if (!output || output.toolCalls.length === 0) return false;
  const SNAPSHOT_CAP = 50_000;
  const trim = (s: string | undefined): string | null =>
    s && s.length > SNAPSHOT_CAP ? s.slice(0, SNAPSHOT_CAP) : (s ?? null);

  const records: PersistedRecord[] = output.toolCalls.map((call) => ({
    contractId: state.contractId,
    userId: state.userId,
    action: mapToolToAction(call.name),
    summary: buildToolSummary(call.name, call.input),
    details: { tool: call.name, input: call.input, success: call.success } as object,
    source: "ai" as const,
    htmlBefore: trim(call.htmlBefore),
    htmlAfter: trim(call.htmlAfter),
    sessionId,
  }));

  await prisma.contractChangeLog.createMany({ data: records });
  // Retorna true se houve edição (alguma write tool com sucesso)
  return output.toolCalls.some(
    (c) =>
      c.success &&
      [
        "edit_contract_section",
        "update_contract_data",
        "insert_clause",
        "remove_clause",
        "apply_style_preset",
        "insert_image",
      ].includes(c.name)
  );
}

// B2 (2026-05): ledger determinístico de escritas. Define — independentemente
// do que os especialistas NARRARAM — o que realmente mudou no documento. É a
// fonte da verdade que o aggregator usa pra não confabular "Alterações
// Realizadas" sem write confirmada (bug do QA deal 20486).
export interface WriteLedger {
  applied: string[]; // doc text mudou e tool teve sucesso
  pending: string[]; // propose_suggestion / propose_plan (aguardando aprovação)
  notApplied: string[]; // write de mutação com sucesso mas doc NÃO mudou (verified=false)
  dataOnly: string[]; // update_contract_data: muda dataJson, não o texto visível
  failed: string[]; // qualquer write com erro / bloqueada por policy
}

const DOC_MUTATING_TOOLS = new Set([
  "edit_contract_section",
  "insert_clause",
  "remove_clause",
  "apply_style_preset",
  "insert_image",
]);
const PENDING_TOOLS = new Set(["propose_suggestion", "propose_plan"]);

export function buildWriteLedger(
  specialistOutputs: Partial<Record<SpecialistName, SpecialistOutput>>
): WriteLedger {
  const ledger: WriteLedger = { applied: [], pending: [], notApplied: [], dataOnly: [], failed: [] };
  const outputs = [specialistOutputs.editor, specialistOutputs.curator].filter(Boolean);
  for (const out of outputs) {
    for (const call of out!.toolCalls) {
      const label = call.summary || call.name;
      if (DOC_MUTATING_TOOLS.has(call.name)) {
        if (!call.success) {
          ledger.failed.push(`${call.name}: ${label}`);
          continue;
        }
        // Quando há snapshot (GDoc), só conta como aplicada se o texto mudou.
        const hasSnap = call.htmlBefore !== undefined && call.htmlAfter !== undefined;
        const changed = hasSnap ? call.htmlBefore !== call.htmlAfter : true;
        if (changed) ledger.applied.push(label);
        else ledger.notApplied.push(`${call.name}: edição não confirmada no documento (${label})`);
      } else if (call.name === "update_contract_data") {
        if (call.success) ledger.dataOnly.push(`${label} (atualiza dados, não o texto visível)`);
        else ledger.failed.push(`${call.name}: ${label}`);
      } else if (PENDING_TOOLS.has(call.name)) {
        if (call.success) ledger.pending.push(label);
        else ledger.failed.push(`${call.name}: ${label}`);
      }
      // reads (query_*, cross_check_certidoes, add_comment) não entram no ledger.
    }
  }
  return ledger;
}

export function ledgerIsEmpty(l: WriteLedger): boolean {
  return (
    l.applied.length === 0 &&
    l.pending.length === 0 &&
    l.notApplied.length === 0 &&
    l.dataOnly.length === 0 &&
    l.failed.length === 0
  );
}

/** Outcome canônico p/ AgentRun (D) e telemetria. */
export function ledgerOutcome(l: WriteLedger, intent: string | undefined): string {
  if (l.applied.length > 0) return l.failed.length || l.notApplied.length ? "applied_partial" : "applied";
  if (l.pending.length > 0) return "pending_plan";
  if (l.failed.length > 0 || l.notApplied.length > 0) return "failed";
  if (l.dataOnly.length > 0) return "failed"; // dados mudaram mas texto não — não é o que o usuário espera
  return intent === "informational" ? "no_op_informational" : "no_op_informational";
}

function formatLedger(l: WriteLedger): string {
  if (ledgerIsEmpty(l)) return "## LEDGER DE ESCRITAS (determinístico)\n(nenhuma tool de escrita foi executada — não houve alteração no documento)";
  const lines: string[] = ["## LEDGER DE ESCRITAS (determinístico)"];
  const sec = (title: string, items: string[]) => {
    if (items.length) lines.push(`**${title}:**\n${items.map((i) => `- ${i}`).join("\n")}`);
  };
  sec("APLICADAS (confirmadas no documento)", l.applied);
  sec("PENDENTES (aguardando aprovação do usuário)", l.pending);
  sec("NÃO APLICADAS (edição não confirmada no documento)", l.notApplied);
  sec("APENAS DADOS (não alterou o texto visível)", l.dataOnly);
  sec("FALHAS", l.failed);
  return lines.join("\n\n");
}

export function _formatLedgerForTest(l: WriteLedger): string {
  return formatLedger(l);
}

function buildSpecialistContext(state: GraphState, ledger: WriteLedger): string {
  const parts: string[] = [];
  if (state.specialistOutputs.analyst?.text) {
    parts.push(`## Análise do Analista\n${state.specialistOutputs.analyst.text}`);
  }
  if (state.specialistOutputs.legal?.text) {
    parts.push(`## Consulta do Jurídico\n${state.specialistOutputs.legal.text}`);
  }
  if (state.specialistOutputs.editor?.text) {
    parts.push(`## Edição do Editor\n${state.specialistOutputs.editor.text}`);
  }
  if (state.specialistOutputs.curator?.text) {
    parts.push(`## Curadoria do Curador\n${state.specialistOutputs.curator.text}`);
  }
  // Ledger SEMPRE incluído — é o contrato de verdade sobre o que mudou.
  parts.push(formatLedger(ledger));
  return parts.join("\n\n") || "(nenhum especialista executou)";
}

// ============================================================
// Graph builder
// ============================================================

type RouteTarget = "legal" | "analyst" | "editor" | "curator";

function routeAfterRouter(state: GraphState): RouteTarget | RouteTarget[] {
  switch (state.intent) {
    case "edit_simple":
      return "editor";
    case "review":
      // Fanout paralelo — LangGraph executa em concorrência e converge no aggregator
      return ["analyst", "legal", "curator"];
    case "propose":
      // Curator + Legal (Legal traz base legal/precedente; Curator propõe)
      return ["legal", "curator"];
    case "edit_multi":
      // F5: edit_multi vai pro Editor com instrução de usar propose_plan.
      // Editor é forçado a chamar propose_plan (forceToolUse via prompt),
      // que escreve ChatPlan — UI mostra PlanCard pra aprovação.
      return "editor";
    case "informational":
    default:
      return "legal";
  }
}

let compiledGraph: ReturnType<typeof buildGraph> | null = null;

function buildGraph() {
  const graph = new StateGraph(OrchestratorStateAnnotation)
    .addNode("loadContext", loadContextNode)
    .addNode("router", routerNode)
    .addNode("analyst", analystNode)
    .addNode("legal", legalNode)
    .addNode("editor", editorNode)
    .addNode("curator", curatorNode)
    .addNode("aggregator", aggregatorNode)
    .addEdge(START, "loadContext")
    .addEdge("loadContext", "router")
    .addConditionalEdges("router", routeAfterRouter, {
      legal: "legal",
      analyst: "analyst",
      editor: "editor",
      curator: "curator",
    })
    .addEdge("legal", "aggregator")
    .addEdge("analyst", "aggregator")
    .addEdge("editor", "aggregator")
    .addEdge("curator", "aggregator")
    .addEdge("aggregator", END);

  return graph.compile({ checkpointer: getCheckpointer() });
}

export function getOrchestratorGraph() {
  if (!compiledGraph) {
    compiledGraph = buildGraph();
  }
  return compiledGraph;
}

/** Reset pra testes. */
export function __resetGraphForTests(): void {
  compiledGraph = null;
}

// ============================================================
// Entry point chamado pelo route.ts
// ============================================================

export interface RunOrchestratorParams {
  contractId: string;
  userId: string;
  orgId: string;
  sessionId?: string;
  userMessage: string;
  mode: AgentMode;
  attachmentIds?: string[];
}

/**
 * Roda o graph numa session (thread_id = sessionId). Retorna o stream
 * de eventos no formato AgentEvent — compatível com o front-end SSE atual.
 *
 * Fluxo:
 *   1. Resolve session (se não veio explícita, cria/reusa).
 *   2. Invoke graph com thread_id = sessionId.
 *   3. Yield eventos acumulados em state.events na ordem em que aparecem.
 */
export async function* runOrchestrator(
  params: RunOrchestratorParams
): AsyncGenerator<AgentEvent, void, void> {
  const activeSession = await resolveSession(
    params.contractId,
    params.userId,
    params.sessionId
  );
  // History não é usado em F1 (specialists não recebem histórico) — F2 muda.
  void loadChatHistory;

  const graph = getOrchestratorGraph();
  const config = { configurable: { thread_id: activeSession.id } };

  const initialState: Partial<GraphState> = {
    contractId: params.contractId,
    userId: params.userId,
    orgId: params.orgId,
    sessionId: activeSession.id,
    userMessage: params.userMessage,
    mode: params.mode,
    attachmentIds: params.attachmentIds,
  };

  let finalMessage = "";
  const accumulatedEvents: AgentEvent[] = [];

  try {
    // streamMode: "updates" emite só o delta de cada node — evita re-emitir
    // events herdados do checkpoint quando há turns prévios na mesma session.
    for await (const chunk of await graph.stream(initialState, {
      ...config,
      streamMode: "updates",
    })) {
      // chunk shape: { [nodeName]: PartialState }
      for (const update of Object.values(chunk) as Array<Partial<GraphState>>) {
        if (update.events) {
          for (const evt of update.events) {
            accumulatedEvents.push(evt);
            yield evt;
          }
        }
        if (update.finalMessage) {
          finalMessage = update.finalMessage;
        }
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[runOrchestrator] graph stream falhou:", err);
    yield { type: "error", message: msg };
    return;
  }

  yield {
    type: "done",
    result: {
      message: finalMessage || "Operação concluída.",
      htmlContent: null,
      dataJson: null,
      changeLogs: [],
      events: accumulatedEvents,
    },
  };
}
