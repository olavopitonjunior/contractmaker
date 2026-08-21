import { NextRequest, NextResponse } from "next/server";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { Anthropic } from "@anthropic-ai/sdk";
import { recordAIUsage } from "@/lib/ai/usage";
import { createKnowledgeItem } from "@/lib/ai/knowledge";
import { resolveModel, SONNET_MODEL } from "@/lib/ai/shared/models";
import { searchKnowledgeBase } from "@/lib/ai/knowledge-search";
import { clauseWriteSchema } from "@/lib/clauses/schema";

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

  const reqBody = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const { context, category, description, force } = reqBody ?? {};
  if (!description || typeof description !== "string") {
    return NextResponse.json({ error: "description é obrigatória" }, { status: 400 });
  }

  // Consulta o acervo ANTES de gerar (o endpoint gerava às cegas e produzia
  // duplicatas). Similaridade alta → devolve as existentes SEM gerar; a UI
  // oferece "usar existente" e só re-chama com force:true se o usuário
  // insistir. Abaixo do corte, as parecidas entram no prompt como "não
  // duplique". Sem Voyage o shim cai em ILIKE (sem similarity) — segue direto.
  const SIMILAR_CUTOFF = 0.75;
  let nearMisses: Array<{ id: string; title: string; similarity: number }> = [];
  try {
    const search = await searchKnowledgeBase({
      orgId: org.id,
      userId: session.user.id,
      query: description,
      category: "clause",
      topK: 5,
    });
    const results = Array.isArray(search?.results)
      ? (search.results as Array<Record<string, unknown>>)
      : [];
    let scored = results
      .filter((r) => typeof r.similarity === "number")
      .map((r) => ({
        id: String(r.id ?? ""),
        title: String(r.title ?? ""),
        similarity: r.similarity as number,
      }))
      .filter((r) => r.id && r.title);
    // O RAG não filtra status nem chunks (achado): cláusula ARQUIVADA mantém
    // embedding e bloquearia a geração apontando pra algo que a página nem
    // lista; fragmentos "(parte N/M)" viram falsos similares. Pós-filtra pra
    // linhas-pai vivas.
    if (scored.length > 0) {
      const alive = await prisma.knowledgeItem.findMany({
        where: {
          id: { in: scored.map((r) => r.id) },
          status: { in: ["approved", "pending"] },
          parentId: null,
        },
        select: { id: true },
      });
      const aliveIds = new Set(alive.map((a) => a.id));
      scored = scored.filter((r) => aliveIds.has(r.id));
    }
    const similar = scored.filter((r) => r.similarity >= SIMILAR_CUTOFF);
    if (similar.length > 0 && !force) {
      return NextResponse.json({ similar }, { status: 200 });
    }
    nearMisses = scored.slice(0, 3);
  } catch {
    // Busca é best-effort: falha não bloqueia a geração.
  }

  const model = resolveModel(process.env.ANTHROPIC_MODEL, SONNET_MODEL);
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
${context ? `Contexto adicional: ${context}` : ""}
${
  nearMisses.length > 0
    ? `\nJá existem no acervo as cláusulas abaixo — NÃO duplique o escopo delas; gere algo distinto ou complementar:\n${nearMisses
        .map((r) => `- ${r.title}`)
        .join("\n")}`
    : ""
}`,
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

  // O JSON do modelo passa pelo MESMO schema da escrita manual (achado: sem
  // isto nasciam linhas que o editor depois recusava salvar — título >200,
  // >20 tags, subcategory >60 vinda crua do body).
  const validated = clauseWriteSchema.safeParse({
    title: parsed.title,
    content: parsed.content,
    subcategory:
      (typeof parsed.subcategory === "string" && parsed.subcategory.trim()) ||
      (typeof category === "string" && category.trim()) ||
      "customizada",
    tags: Array.isArray(parsed.tags) ? parsed.tags.slice(0, 20) : [],
    agentNotes: typeof description === "string" ? description : null,
  });
  if (!validated.success) {
    return NextResponse.json(
      { error: "IA retornou cláusula fora do formato aceito — tente reformular a descrição" },
      { status: 422 }
    );
  }
  const gen = validated.data;

  // Save as pending clause (KnowledgeItem category="clause" + status=pending)
  const result = await createKnowledgeItem({
    orgId: org.id,
    category: "clause",
    title: gen.title,
    content: gen.content,
    tags: gen.tags ?? [],
    source: "ai-generated",
    createdBy: session.user.id,
    subcategory: gen.subcategory,
    agentNotes: gen.agentNotes ?? null,
    status: "pending",
  });

  const clause = await prisma.knowledgeItem.findUnique({
    where: { id: result.parentId },
  });
  if (!clause) {
    // 201 com body null estourava TypeError no client (achado) — erro real.
    return NextResponse.json(
      { error: "Cláusula criada mas não recuperada — recarregue a página" },
      { status: 500 }
    );
  }

  return NextResponse.json(
    { ...clause, category: clause.subcategory ?? "customizada" },
    { status: 201 }
  );
}
