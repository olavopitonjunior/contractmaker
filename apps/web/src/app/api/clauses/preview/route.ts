import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { buildTemplatePreviewHtml } from "@/lib/templates/preview-context";
import { CLAUSE_PREVIEW_MODALIDADE_VALUES } from "@/lib/clauses/schema";

// Handlebars + enrich rodam em node (mesma razão do preview de templates).
export const runtime = "nodejs";

/**
 * POST /api/clauses/preview — renderiza o Handlebars de UMA cláusula contra a
 * amostra determinística de preview (lib/templates/preview-sample-data), pelo
 * MESMO caminho do preview de templates (buildTemplatePreviewHtml): helpers BR
 * registrados uma vez (nunca re-registrar — gotcha do shadowing), noEscape +
 * stripActiveContent, e a UI exibe em <iframe sandbox> sem allow-scripts.
 *
 * O conteúdo é template arbitrário do usuário — o compile fica em try/catch e
 * erro de sintaxe volta 422 com a mensagem (vira um linter de graça no editor).
 * Nada é persistido.
 */
const bodySchema = z.object({
  content: z.string().min(1).max(50_000),
  // Amostra por família: cláusula de venda renderiza contra o contexto de
  // venda; de locação, contra o de locação (tags/uso decidem na UI). Lista
  // canônica compartilhada com o Select da UI (achado: fork dessincronizava).
  modalidade: z.enum(CLAUSE_PREVIEW_MODALIDADE_VALUES).default("a_vista"),
});

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const org = await getUserOrg(session.user.id);
  if (!org) {
    return NextResponse.json({ error: "No organization" }, { status: 400 });
  }

  const raw = await req.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Body inválido", details: parsed.error.format() },
      { status: 400 }
    );
  }

  const { content, modalidade } = parsed.data;
  // O fixture É a modalidade pedida (achado: passar undefined caía no
  // fixtures[0]='a_vista' e "financiamento" renderizava contra a amostra
  // errada — o linter aprovava cláusula quebrada).
  const fixture = modalidade;

  try {
    const html = buildTemplatePreviewHtml({
      handlebarsSource: content,
      modalidade,
      fixture,
    });
    return NextResponse.json({ html, fixture });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `Falha ao renderizar Handlebars: ${msg}` },
      { status: 422 }
    );
  }
}
