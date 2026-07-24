import { NextRequest, NextResponse } from "next/server";
import {
  requireApiAuth,
  isAuthFailure,
  authFailureResponse,
} from "@/lib/api/require-auth";
import { ModuleDisabledError } from "@/lib/modules/guard";
import { assertAnySurveyFeature } from "@/lib/surveys/guard";
import { generateSurveySummary } from "@/lib/surveys/summary";
import { OrgAiBudgetExceededError } from "@/lib/ai/budget";
import { audit, extractAuditContextFromRequest } from "@/lib/security/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// POST /api/surveys/reports/[templateId]/summary — resumo Haiku das respostas
// abertas do LOTE. Cacheado por hash em settingsJson.aiSummary: sem resposta
// nova, devolve o cache sem custo.
export async function POST(
  req: NextRequest,
  { params }: { params: { templateId: string } }
) {
  const auth = await requireApiAuth(req);
  if (isAuthFailure(auth)) return authFailureResponse(auth);
  try {
    await assertAnySurveyFeature(auth.org.id);
  } catch (e) {
    if (e instanceof ModuleDisabledError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    throw e;
  }

  let result;
  try {
    result = await generateSurveySummary({
      orgId: auth.org.id,
      templateId: params.templateId,
      userId: auth.actor.effectiveUserId,
    });
  } catch (e) {
    if (e instanceof OrgAiBudgetExceededError) {
      return NextResponse.json(
        { error: "Orçamento mensal de IA da organização esgotado" },
        { status: 402 }
      );
    }
    throw e;
  }

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  if (!result.cached) {
    void audit(
      extractAuditContextFromRequest(req, auth.org.id, auth.actor.effectiveUserId),
      {
        action: "SURVEY_SUMMARY_GENERATED",
        result: "SUCCESS",
        resource: params.templateId,
        resourceType: "SurveyTemplate",
        metadata: { responseCount: result.summary.responseCount },
      }
    );
  }

  return NextResponse.json({ summary: result.summary, cached: result.cached });
}
