import { NextRequest, NextResponse } from "next/server";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { Anthropic } from "@anthropic-ai/sdk";
import { recordAIUsage } from "@/lib/ai/usage";
import { createKnowledgeItem } from "@/lib/ai/knowledge";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const org = await getUserOrg(session.user.id);
  if (!org) {
    return NextResponse.json({ error: "No organization" }, { status: 400 });
  }

  const { context, category, description } = await req.json();
  const model = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-20250514";
  const t0 = Date.now();

  let response;
  try {
    response = await anthropic.messages.create({
      model,
      max_tokens: 1024,
      system: `Voce e um especialista juridico em contratos imobiliarios brasileiros.
Gere clausulas contratuais claras e juridicamente validas.
Retorne APENAS um JSON com: { "title": "...", "content": "...", "tags": [...], "subcategory": "..." }
O content deve usar sintaxe Handlebars quando houver campos variaveis (ex: {{moeda valor}}, {{this.nome}}).`,
      messages: [
        {
          role: "user",
          content: `Gere uma clausula contratual para a seguinte situacao:
Categoria: ${category || "customizada"}
Descrição: ${description}
${context ? `Contexto adicional: ${context}` : ""}`,
        },
      ],
    });
  } catch (err) {
    recordAIUsage({
      orgId: org.id,
      userId: session.user.id,
      provider: "anthropic",
      model,
      operation: "clause_generate",
      promptTokens: 0,
      latencyMs: Date.now() - t0,
      success: false,
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }

  recordAIUsage({
    orgId: org.id,
    userId: session.user.id,
    provider: "anthropic",
    model,
    operation: "clause_generate",
    promptTokens: response.usage?.input_tokens ?? 0,
    completionTokens: response.usage?.output_tokens ?? 0,
    latencyMs: Date.now() - t0,
    success: true,
  });

  const text =
    response.content[0].type === "text" ? response.content[0].text : "";

  let parsed;
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : null;
  } catch {
    parsed = null;
  }

  if (!parsed) {
    return NextResponse.json(
      { error: "Failed to parse AI response" },
      { status: 500 }
    );
  }

  // Save as pending clause (KnowledgeItem category="clause" + status=pending)
  const result = await createKnowledgeItem({
    orgId: org.id,
    category: "clause",
    title: parsed.title,
    content: parsed.content,
    tags: Array.isArray(parsed.tags) ? parsed.tags : [],
    source: "ai-generated",
    createdBy: session.user.id,
    subcategory: parsed.subcategory || category || "customizada",
    agentNotes: description ?? null,
    status: "pending",
  });

  const clause = await prisma.knowledgeItem.findUnique({
    where: { id: result.parentId },
  });

  return NextResponse.json(
    clause ? { ...clause, category: clause.subcategory ?? "customizada" } : null,
    { status: 201 }
  );
}
