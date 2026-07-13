import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { recordAIUsage } from "@/lib/ai/usage";
import { rateLimit } from "@/lib/security/ratelimit";
import { getOrgModules } from "@/lib/modules/read";
import { ASSISTANT_TOOLS, runAssistantTool } from "@/lib/ai/assistant-tools";
import { getSupportConfig } from "@/lib/support/config";
import { describeScreen } from "@/lib/support/route-map";
import { SUPPORT_TOOLS, isSupportTool, runSupportTool } from "@/lib/support/tools";
import { createOrDedupeHandoff } from "@/lib/support/handoff";
import type { SupportModuleTag } from "@/lib/support/constants";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_ITERATIONS = 4;

const chatSchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().min(1).max(4000),
      })
    )
    .min(1)
    .max(40),
  context: z.string().optional(), // pathname da tela atual (consciência de tela)
});

type SseEvent =
  | { type: "text_delta"; text: string }
  | { type: "tool_use"; name: string }
  | { type: "tool_result"; name: string }
  | { type: "handoff"; handoffId: string }
  | { type: "done"; interactionId: string | null; handoff: boolean }
  | { type: "error"; message: string };

function sse(event: SseEvent): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`);
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const org = await getUserOrg(session.user.id);
  if (!org) return NextResponse.json({ error: "Sem org" }, { status: 404 });

  const rl = await rateLimit({
    identifier: `support-chat:${session.user.id}`,
    limit: 20,
    window: "1 m",
  });
  if (!rl.success) {
    return NextResponse.json(
      { error: "Muitas mensagens. Aguarde um instante e tente de novo." },
      { status: 429 }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = chatSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 422 }
    );
  }

  const userId = session.user.id;
  const orgId = org.id;
  const screenPath = parsed.data.context ?? null;
  const lastUserQuestion =
    [...parsed.data.messages].reverse().find((m) => m.role === "user")?.content ?? "";
  const transcript = parsed.data.messages.slice(-12);

  // Módulos ativos do tenant → filtra tools de dados e tags de conteúdo.
  const modules = await getOrgModules(orgId);
  const locacaoEnabled = modules.enabled.locacao === true;
  const moduleTags: SupportModuleTag[] = [
    ...(modules.enabled.vendas ? (["vendas"] as const) : []),
    ...(locacaoEnabled ? (["locacao"] as const) : []),
  ];

  const config = await getSupportConfig();
  const screen = describeScreen(screenPath);

  const enabledLabel =
    [modules.enabled.vendas ? "Vendas" : null, locacaoEnabled ? "Locação" : null]
      .filter(Boolean)
      .join(" e ") || "nenhum módulo específico";

  const systemPrompt = [
    config.systemPrompt,
    `\nMódulos habilitados neste tenant: ${enabledLabel}.`,
    screen.prompt ? `\n${screen.prompt}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  // Sem chave: devolve um stream mínimo com a mensagem de "não configurado".
  const encoderStreamNotConfigured = () =>
    new ReadableStream({
      start(controller) {
        controller.enqueue(
          sse({
            type: "text_delta",
            text: "Assistente de suporte não está configurado (ANTHROPIC_API_KEY ausente). Peça ao admin pra habilitar.",
          })
        );
        controller.enqueue(sse({ type: "done", interactionId: null, handoff: false }));
        controller.close();
      },
    });

  if (!process.env.ANTHROPIC_API_KEY) {
    return new Response(encoderStreamNotConfigured(), {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  }

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const tools: Anthropic.Tool[] = [
    ...SUPPORT_TOOLS,
    ...(locacaoEnabled ? ASSISTANT_TOOLS : []),
  ];

  const startedAt = Date.now();

  const stream = new ReadableStream({
    async start(controller) {
      const emit = (e: SseEvent) => controller.enqueue(sse(e));
      const toolsUsed: string[] = [];
      const kbHitIds: string[] = [];
      let kbTopSimilarity: number | null = null;
      let kbSearched = false;
      let handoffId: string | null = null;
      let finalReply = "";
      let promptTokens = 0;
      let completionTokens = 0;
      let iterations = 0;

      const messages: Anthropic.MessageParam[] = parsed.data.messages.map((m) => ({
        role: m.role,
        content: m.content,
      }));

      try {
        while (iterations < MAX_ITERATIONS) {
          iterations++;
          const llmStream = client.messages.stream({
            model: config.model,
            max_tokens: config.maxTokens,
            temperature: config.temperature,
            system: systemPrompt,
            tools,
            messages,
          });

          // Encaminha deltas de texto ao vivo.
          for await (const ev of llmStream) {
            if (
              ev.type === "content_block_delta" &&
              ev.delta.type === "text_delta" &&
              ev.delta.text
            ) {
              emit({ type: "text_delta", text: ev.delta.text });
            }
          }

          const msg = await llmStream.finalMessage();
          promptTokens += msg.usage.input_tokens;
          completionTokens += msg.usage.output_tokens;

          const toolUseBlocks = msg.content.filter(
            (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
          );
          const text = msg.content
            .map((b) => (b.type === "text" ? b.text : ""))
            .join("")
            .trim();

          if (toolUseBlocks.length === 0 || msg.stop_reason === "end_turn") {
            finalReply = text || finalReply;
            break;
          }

          messages.push({ role: "assistant", content: msg.content });

          const toolResults: Anthropic.ToolResultBlockParam[] = [];
          for (const tu of toolUseBlocks) {
            toolsUsed.push(tu.name);
            emit({ type: "tool_use", name: tu.name });
            const input = (tu.input ?? {}) as Record<string, unknown>;

            let content: string;
            if (isSupportTool(tu.name)) {
              if (tu.name === "search_support_kb") kbSearched = true;
              const r = await runSupportTool(tu.name, input, {
                orgId,
                userId,
                screenPath,
                moduleTags,
                transcript,
              });
              content = r.content;
              if (typeof r.kbTopSimilarity === "number") {
                kbTopSimilarity =
                  kbTopSimilarity === null
                    ? r.kbTopSimilarity
                    : Math.max(kbTopSimilarity, r.kbTopSimilarity);
              }
              if (r.kbHitIds) kbHitIds.push(...r.kbHitIds);
              if (r.handoffId) {
                handoffId = r.handoffId;
                emit({ type: "handoff", handoffId: r.handoffId });
              }
            } else {
              content = await runAssistantTool(tu.name, input, { orgId });
            }

            emit({ type: "tool_result", name: tu.name });
            toolResults.push({
              type: "tool_result",
              tool_use_id: tu.id,
              content,
            });
          }

          messages.push({ role: "user", content: toolResults });
        }

        if (!finalReply) {
          finalReply = "Não consegui completar a resposta. Tente reformular a pergunta.";
        }

        // Guardrail determinístico: buscou na base, nenhum hit confiável e o modelo
        // NÃO encaminhou → registra handoff pra revisão humana e avisa o usuário.
        // "Sem hit confiável" = nenhum resultado, OU (modo semântico) similaridade
        // abaixo do limiar. Em modo ILIKE (sem Voyage) a similaridade é null — NÃO
        // tratamos isso como baixa-confiança, senão todo turno viraria handoff.
        const noConfidentHit =
          kbHitIds.length === 0 ||
          (typeof kbTopSimilarity === "number" &&
            kbTopSimilarity < config.handoffMinSimilarity);
        if (kbSearched && !handoffId && noConfidentHit && lastUserQuestion) {
          try {
            const { id } = await createOrDedupeHandoff({
              question: lastUserQuestion,
              orgId,
              userId,
              screenPath,
              transcript,
            });
            handoffId = id;
            emit({ type: "handoff", handoffId: id });
            emit({
              type: "text_delta",
              text: "\n\n_Não achei isso com segurança na base — encaminhei sua dúvida ao nosso suporte e você será avisado quando respondermos._",
            });
            finalReply +=
              "\n\n_Encaminhei sua dúvida ao nosso suporte e você será avisado quando respondermos._";
          } catch (e) {
            console.error("[support-chat] guardrail handoff falhou:", e);
          }
        }

        // Persiste a interação (backbone de qualidade + alvo do feedback 👍/👎).
        let interactionId: string | null = null;
        try {
          const interaction = await prisma.supportInteraction.create({
            data: {
              orgId,
              userId,
              question: lastUserQuestion.slice(0, 4000),
              answer: finalReply.slice(0, 8000),
              screenPath,
              kbTopSimilarity,
              kbHitIds: Array.from(new Set(kbHitIds)),
              handoffCreated: !!handoffId,
              handoffId,
            },
            select: { id: true },
          });
          interactionId = interaction.id;
        } catch (e) {
          console.error("[support-chat] persistência de interação falhou:", e);
        }

        emit({ type: "done", interactionId, handoff: !!handoffId });

        recordAIUsage({
          orgId,
          userId,
          provider: "anthropic",
          model: config.model,
          operation: "support_chat",
          promptTokens,
          completionTokens,
          latencyMs: Date.now() - startedAt,
          toolsUsed: [...new Set(toolsUsed)],
          iterations,
          success: true,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error("[support-chat] erro:", message);
        emit({ type: "error", message: "Falha na consulta ao assistente." });
        recordAIUsage({
          orgId,
          userId,
          provider: "anthropic",
          model: config.model,
          operation: "support_chat",
          promptTokens,
          completionTokens,
          latencyMs: Date.now() - startedAt,
          iterations,
          success: false,
          errorMessage: message,
        });
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
