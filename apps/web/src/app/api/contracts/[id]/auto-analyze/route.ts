import { NextRequest, NextResponse } from "next/server";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { runPassiveAnalysis, type PassiveAnalysisTrigger } from "@/lib/ai/agent";

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
