import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { getEffectiveUserId } from "@/lib/auth/impersonation";
import { prisma } from "@/lib/db/prisma";
import { isGoogleDocsConfigured } from "@/lib/google/client";
import { reviewLibrary } from "@/lib/templates/library-review";
import { reviewClauseLibrary } from "@/lib/templates/clause-review";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * POST /api/templates/library-review — o estado da biblioteca INTEIRA.
 *
 * POST, e não GET, porque a revisão dos modelos GRAVA: ela delega à validação
 * individual, que carimba o `draftReport` de cada modelo (o relatório é espelho
 * do Doc — ver `validate-gdoc.ts`). Um GET que escreve seria mentira de verbo, e
 * atrairia prefetch e cache de navegador sobre uma operação que lê o Drive N
 * vezes.
 *
 * `maxDuration` alto pelo mesmo motivo: cada modelo é uma leitura do Google
 * Docs. Com o teto de 60 modelos e concorrência 4 dentro do módulo, o pior caso
 * cabe folgado — mas 60s (o teto das outras rotas de template) não caberia.
 */
const Body = z.object({
  scope: z.enum(["templates", "clauses", "all"]).default("all"),
});

async function requireOwnerAdmin(userId: string, orgId: string) {
  const effUserId = await getEffectiveUserId(userId);
  const m = await prisma.orgMembership.findFirst({
    where: { userId: effUserId, orgId },
    select: { role: true },
  });
  return !!m && ["owner", "admin"].includes(m.role);
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const org = await getUserOrg(session.user.id);
  if (!org) return NextResponse.json({ error: "No organization" }, { status: 400 });
  if (!(await requireOwnerAdmin(session.user.id, org.id))) {
    return NextResponse.json({ error: "Apenas owner/admin." }, { status: 403 });
  }

  const parsed = Body.safeParse((await req.json().catch(() => null)) ?? {});
  if (!parsed.success) {
    return NextResponse.json({ error: "Corpo inválido." }, { status: 400 });
  }
  const { scope } = parsed.data;
  const querModelos = scope !== "clauses";
  const querClausulas = scope !== "templates";

  try {
    // A integração do Google derruba SÓ os modelos. A base de cláusulas é
    // banco e Handlebars puro — recusar as duas por causa de uma seria esconder
    // metade do contrato por um problema que não é dela.
    const googleOk = isGoogleDocsConfigured();
    const [templates, clauses] = await Promise.all([
      querModelos && googleOk ? reviewLibrary({ orgId: org.id }) : Promise.resolve(null),
      querClausulas ? reviewClauseLibrary({ orgId: org.id }) : Promise.resolve(null),
    ]);

    return NextResponse.json({
      templates,
      clauses,
      ...(querModelos && !googleOk
        ? { templatesIndisponivel: "Integração Google Docs não está configurada." }
        : {}),
    });
  } catch (err) {
    console.error("[templates/library-review] Erro:", err);
    return NextResponse.json(
      { error: "Não foi possível revisar a biblioteca agora." },
      { status: 500 }
    );
  }
}
