import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { RateLimits } from "@/lib/security/ratelimit";
import { resolveSurveyToken } from "@/lib/surveys/token";
import { audit } from "@/lib/security/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/public/surveys/[token]/optout — link "não quero receber pesquisas"
// do rodapé do e-mail. Marca o invite como optout (suprime reminders; o
// dispatch automático também pula e-mails com optout anterior na org) e
// redireciona pra página do token, que mostra a confirmação.
export async function GET(
  req: NextRequest,
  { params }: { params: { token: string } }
) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const rl = await RateLimits.publicPageByIp(ip);
  if (!rl.success) {
    return NextResponse.json({ error: "Muitas tentativas — aguarde" }, { status: 429 });
  }

  const resolved = await resolveSurveyToken(params.token);
  const base = process.env.NEXTAUTH_URL ?? "https://imobpro.ia.br";

  if (resolved.ok && resolved.invite.status !== "responded") {
    await prisma.surveyInvite.update({
      where: { id: resolved.invite.id },
      data: { status: "optout" },
    });
    void audit(
      { orgId: resolved.invite.orgId, userId: null },
      {
        action: "SURVEY_OPTOUT",
        result: "SUCCESS",
        resource: resolved.invite.id,
        resourceType: "SurveyInvite",
        metadata: { templateId: resolved.invite.templateId },
      }
    );
  }

  return NextResponse.redirect(`${base.replace(/\/$/, "")}/s/${params.token}`);
}
