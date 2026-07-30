import { NextRequest, NextResponse } from "next/server";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { runPassiveAnalysis, type PassiveAnalysisTrigger } from "@/lib/ai/agent";
import { guardContractScope } from "@/lib/deals/route-helpers";

export const maxDuration = 60;

export async function POST(
  req: NextRequest,
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

  // Contrato aprovado é imutável — análise passiva ainda pode ser disparada
  // pelo poll stale do editor após approve. Em vez de gastar tokens LLM,
  // devolvemos resposta vazia 200 e o frontend para de chamar.
  const contract = await prisma.contract.findUnique({
    where: { id: params.id },
    select: {
      status: true,
      deal: { select: { pipeline: { select: { orgId: true } } } },
    },
  });
  // Cross-org guard: sem isso qualquer sessão dispara análise passiva (custo
  // LLM + leitura de conteúdo) em contrato de outra org.
  if (!contract || contract.deal.pipeline.orgId !== org.id) {
    return NextResponse.json({ error: "Contrato não encontrado" }, { status: 404 });
  }
  // Escopo do gerente (a análise lê o contrato inteiro e cria comentários).
  const denied = await guardContractScope({
    contractId: params.id,
    userId: session.user.id,
    orgId: org.id,
  });
  if (denied) return denied;

  if (contract.status === "aprovado") {
    return NextResponse.json({
      findings: [],
      commentsCreated: 0,
      modelUsed: "approved",
      analyzedAt: new Date().toISOString(),
    });
  }

  const body = await req.json().catch(() => ({}));
  const trigger: PassiveAnalysisTrigger =
    body?.trigger === "open" || body?.trigger === "edit" || body?.trigger === "approve"
      ? body.trigger
      : "open";

  const scope =
    body?.scope && typeof body.scope === "object"
      ? {
          from: typeof body.scope.from === "number" ? body.scope.from : undefined,
          to: typeof body.scope.to === "number" ? body.scope.to : undefined,
          changedText:
            typeof body.scope.changedText === "string" ? body.scope.changedText : undefined,
        }
      : undefined;

  const htmlOverride =
    typeof body?.htmlContent === "string" && body.htmlContent.length > 0
      ? body.htmlContent
      : undefined;

  try {
    const result = await runPassiveAnalysis({
      contractId: params.id,
      orgId: org.id,
      trigger,
      scope,
      htmlOverride,
    });

    return NextResponse.json({
      findings: result.findings,
      commentsCreated: result.commentsCreated,
      modelUsed: result.modelUsed,
      analyzedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[auto-analyze] Error:", err);
    return NextResponse.json(
      { error: "Erro ao executar análise automática" },
      { status: 500 }
    );
  }
}
