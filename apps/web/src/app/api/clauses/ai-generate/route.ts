import { NextRequest, NextResponse } from "next/server";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { Anthropic } from "@anthropic-ai/sdk";

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

  const response = await anthropic.messages.create({
    model: process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-20250514",
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
Descricao: ${description}
${context ? `Contexto adicional: ${context}` : ""}`,
      },
    ],
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

  // Save as pending clause
  const clause = await prisma.clause.create({
    data: {
      orgId: org.id,
      authorId: session.user.id,
      category: category || "customizada",
      subcategory: parsed.subcategory || null,
      title: parsed.title,
      content: parsed.content,
      description,
      tags: parsed.tags || [],
      source: "ai-generated",
      status: "pending",
    },
  });

  return NextResponse.json(clause, { status: 201 });
}
