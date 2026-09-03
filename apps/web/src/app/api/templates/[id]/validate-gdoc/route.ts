import { NextResponse } from "next/server";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { isGoogleDocsConfigured } from "@/lib/google/client";
import { googleErrorMessage } from "@/lib/google/auth-error";
import { validateGoogleDocTemplate } from "@/lib/templates/validate-gdoc";
import { persistableSemanticReport } from "@/lib/templates/semantic-checks";

/**
 * POST /api/templates/[id]/validate-gdoc — revalida os placeholders do
 * Doc-modelo de um template engine="google_docs" contra o catálogo da
 * modalidade, reconcilia slots e PII, e roda as checagens semânticas. Usado
 * pela página de revisão (botão "Revalidar") e antes da ativação.
 *
 * A lógica mora em `lib/templates/validate-gdoc.ts` — quem edita o Doc precisa
 * reconferir no mesmo passo, sem passar por HTTP.
 */
export async function POST(
  _req: Request,
  { params }: { params: { id: string } }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const org = await getUserOrg(session.user.id);
  if (!org) {
    return NextResponse.json({ error: "No organization" }, { status: 400 });
  }
  if (!isGoogleDocsConfigured()) {
    return NextResponse.json(
      { error: "Integração Google Docs não está configurada." },
      { status: 503 }
    );
  }

  const template = await prisma.contractTemplate.findUnique({
    where: { id: params.id },
  });
  if (!template || template.orgId !== org.id) {
    return NextResponse.json({ error: "Template não encontrado" }, { status: 404 });
  }
  if (template.engine !== "google_docs" || !template.googleTemplateDocId) {
    return NextResponse.json(
      { error: "Template não é engine google_docs com doc associado." },
      { status: 400 }
    );
  }

  try {
    const result = await validateGoogleDocTemplate({ template, orgId: org.id });
    // Pela rede vai a forma REDUZIDA do relatório semântico: o conserto vira só
    // o verbo (`{op}`). A frase crua existe para quem aplica a edição no Doc, e
    // hoje ninguém aplica — o aplicador chamará `validateGoogleDocTemplate` em
    // processo e terá o texto ali. Enviar agora seria expor trecho do contrato
    // original num payload que nada consome.
    return NextResponse.json({
      ok: true,
      ...result,
      semantic: persistableSemanticReport(result.semantic),
    });
  } catch (err) {
    console.error("[templates/validate-gdoc/id] Erro:", err);
    // `invalid_grant` cru não diz nada pra quem está na tela — e é o erro mais
    // comum aqui (refresh token da org expira em 7 dias no modo Testing).
    return NextResponse.json({ error: googleErrorMessage(err) }, { status: 502 });
  }
}
