import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { recordAIUsage } from "@/lib/ai/usage";
import { ASSISTANT_TOOLS, runAssistantTool } from "@/lib/ai/assistant-tools";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const HAIKU = "claude-haiku-4-5-20251001";
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
  context: z.string().optional(), // ex: "/locacao/contratos/cm123" — só pra system prompt
});

const SYSTEM_PROMPT = `Você é o assistente IA do imobpro.ai, especialista em gestão de locação imobiliária no Brasil (Lei 8.245).

Sua função é ajudar gestores de imobiliária a:
- Tirar dúvidas sobre contratos, cobranças, repasses, reajustes, garantias
- Sugerir ações concretas (ex.: disparar régua Newton, propor reajuste)
- Explicar status de fluxo de caixa, inadimplência, vencimentos

Diretrizes:
- Use as tools disponíveis pra puxar dados reais antes de responder.
- Respostas DIRETAS e ACIONÁVEIS em PT-BR. Sem floreio.
- Cite valores em R$ formatados (R$ 2.500,00).
- Quando sugerir ação, mencione o endpoint/botão correspondente.
- Se faltar contexto, peça o ID do contrato/proprietário (1 pergunta direta, sem rodeios).
- Nunca invente dados. Se a tool retornar erro, diga isso ao usuário.`;

interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const org = await getUserOrg(session.user.id);
  if (!org) return NextResponse.json({ error: "Sem org" }, { status: 404 });

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

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({
      reply:
        "Assistente IA não está configurado (ANTHROPIC_API_KEY ausente). Pergunte ao admin pra habilitar.",
    });
  }

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const startedAt = Date.now();
  const toolsUsed: string[] = [];
  let totalPromptTokens = 0;
  let totalCompletionTokens = 0;
  let iterations = 0;

  // Loop de tool-use estilo Anthropic (max 4 iterações).
  // Mantemos as messages em formato Anthropic (com content array quando tem tool_use/result).
  type AnthropicMessage =
    | { role: "user" | "assistant"; content: string }
    | { role: "user" | "assistant"; content: Anthropic.MessageParam["content"] };

  const messages: AnthropicMessage[] = parsed.data.messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  const systemPrompt =
    SYSTEM_PROMPT +
    (parsed.data.context ? `\n\nContexto da sessão (URL atual): ${parsed.data.context}` : "");

  try {
    let finalReply = "";
    while (iterations < MAX_ITERATIONS) {
      iterations++;
      const resp = await client.messages.create({
        model: HAIKU,
        max_tokens: 1024,
        system: systemPrompt,
        tools: ASSISTANT_TOOLS,
        messages: messages as Anthropic.MessageParam[],
      });
      totalPromptTokens += resp.usage.input_tokens;
      totalCompletionTokens += resp.usage.output_tokens;

      const toolUseBlocks = resp.content.filter((b) => b.type === "tool_use");
      const textBlocks = resp.content.filter((b) => b.type === "text");

      if (toolUseBlocks.length === 0 || resp.stop_reason === "end_turn") {
        // Resposta final.
        finalReply = textBlocks.map((b) => (b.type === "text" ? b.text : "")).join("\n").trim();
        break;
      }

      // Executa todas as tools chamadas e injeta resultados.
      messages.push({
        role: "assistant",
        content: resp.content as Anthropic.MessageParam["content"],
      });

      const toolResults = await Promise.all(
        toolUseBlocks.map(async (tu) => {
          if (tu.type !== "tool_use") return null;
          toolsUsed.push(tu.name);
          const result = await runAssistantTool(
            tu.name,
            tu.input as Record<string, unknown>,
            { orgId: org.id }
          );
          return {
            type: "tool_result" as const,
            tool_use_id: tu.id,
            content: result,
          };
        })
      );

      messages.push({
        role: "user",
        content: toolResults.filter(Boolean) as Anthropic.MessageParam["content"],
      });
    }

    if (!finalReply) {
      finalReply = "Não consegui completar a resposta. Tente reformular a pergunta.";
    }

    recordAIUsage({
      orgId: org.id,
      userId: session.user.id,
      provider: "anthropic",
      model: HAIKU,
      operation: "assistant_chat",
      promptTokens: totalPromptTokens,
      completionTokens: totalCompletionTokens,
      latencyMs: Date.now() - startedAt,
      toolsUsed: [...new Set(toolsUsed)],
      iterations,
      success: true,
    });

    return NextResponse.json({ reply: finalReply, toolsUsed, iterations });
  } catch (err) {
    recordAIUsage({
      orgId: org.id,
      userId: session.user.id,
      provider: "anthropic",
      model: HAIKU,
      operation: "assistant_chat",
      promptTokens: totalPromptTokens,
      completionTokens: totalCompletionTokens,
      latencyMs: Date.now() - startedAt,
      toolsUsed: [...new Set(toolsUsed)],
      iterations,
      success: false,
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json(
      {
        error: "Falha na consulta ao assistente",
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    );
  }
}
