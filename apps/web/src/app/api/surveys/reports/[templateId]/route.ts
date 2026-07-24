import { NextRequest, NextResponse } from "next/server";
import {
  requireApiAuth,
  isAuthFailure,
  authFailureResponse,
} from "@/lib/api/require-auth";
import { ModuleDisabledError } from "@/lib/modules/guard";
import { assertAnySurveyFeature } from "@/lib/surveys/guard";
import { buildSurveyReport } from "@/lib/surveys/report";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/surveys/reports/[templateId] — relatório de UM lote (versão).
export async function GET(
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

  const report = await buildSurveyReport(auth.org.id, params.templateId);
  if (!report) {
    return NextResponse.json({ error: "Pesquisa não encontrada" }, { status: 404 });
  }
  return NextResponse.json({ report });
}
