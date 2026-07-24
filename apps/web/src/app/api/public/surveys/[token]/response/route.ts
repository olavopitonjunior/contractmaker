import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { RateLimits } from "@/lib/security/ratelimit";
import { resolveSurveyToken } from "@/lib/surveys/token";
import { parseTemplateQuestions, validateAnswers } from "@/lib/surveys/types";
import { deriveScores, isDetractor } from "@/lib/surveys/scores";
import { emitNotification } from "@/lib/notifications/emit";
import { sendEmail } from "@/lib/email/client";
import { SurveyDetractorAlertEmail } from "@/lib/email/templates/survey-detractor-alert";
import { audit } from "@/lib/security/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/public/surveys/[token]/response — SEM sessão: o token É a auth.
// Idempotente: unique em SurveyResponse.inviteId; segundo POST → 409.
export async function POST(
  req: NextRequest,
  { params }: { params: { token: string } }
) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const rl = await RateLimits.publicPageByIp(ip);
  if (!rl.success) {
    return NextResponse.json({ error: "Muitas tentativas — aguarde" }, { status: 429 });
  }

  const resolved = await resolveSurveyToken(params.token);
  if (!resolved.ok) {
    return NextResponse.json({ error: resolved.error }, { status: 404 });
  }
  const { invite } = resolved;

  if (invite.status === "responded") {
    return NextResponse.json({ error: "Pesquisa já respondida" }, { status: 409 });
  }
  if (invite.status === "optout") {
    return NextResponse.json({ error: "Recebimento cancelado" }, { status: 409 });
  }

  const template = await prisma.surveyTemplate.findUnique({
    where: { id: invite.templateId },
    select: { id: true, name: true, orgId: true, questionsJson: true },
  });
  if (!template) {
    return NextResponse.json({ error: "Pesquisa indisponível" }, { status: 404 });
  }

  const questions = parseTemplateQuestions(template.questionsJson);
  const body = await req.json().catch(() => null);
  const validated = validateAnswers(questions, body?.answers);
  if (!validated.ok) {
    return NextResponse.json({ error: validated.error }, { status: 400 });
  }

  const { npsScore, csatScore } = deriveScores(questions, validated.answers);

  let responseId: string;
  try {
    const [response] = await prisma.$transaction([
      prisma.surveyResponse.create({
        data: {
          orgId: invite.orgId,
          templateId: invite.templateId,
          inviteId: invite.id,
          dealId: invite.dealId,
          respondentRole: invite.recipientRole,
          answersJson: validated.answers as unknown as Prisma.InputJsonValue,
          npsScore,
          csatScore,
        },
      }),
      prisma.surveyInvite.update({
        where: { id: invite.id },
        data: { status: "responded", respondedAt: new Date() },
      }),
    ]);
    responseId = response.id;
  } catch (e) {
    // P2002 em inviteId = corrida de duplo submit — trata como respondido.
    if ((e as { code?: string })?.code === "P2002") {
      return NextResponse.json({ error: "Pesquisa já respondida" }, { status: 409 });
    }
    throw e;
  }

  void audit(
    { orgId: invite.orgId, userId: null },
    {
      action: "SURVEY_RESPONSE_RECEIVED",
      result: "SUCCESS",
      resource: responseId,
      resourceType: "SurveyResponse",
      metadata: {
        templateId: invite.templateId,
        dealId: invite.dealId,
        role: invite.recipientRole,
        npsScore,
        csatScore,
      },
    }
  );

  // Régua pós-resposta (fire-and-forget): sino sempre; detrator ganha alerta
  // dedicado + e-mail pro corretor responsável pelo deal.
  void notifyAfterResponse({
    orgId: invite.orgId,
    dealId: invite.dealId,
    responseId,
    templateName: template.name,
    respondentRole: invite.recipientRole,
    respondentName: invite.recipientName,
    npsScore,
    csatScore,
    comment: firstTextAnswer(validated.answers),
  }).catch((e) => console.error("[surveys] notifyAfterResponse", e));

  return NextResponse.json({ ok: true });
}

function firstTextAnswer(
  answers: Array<{ type: string; value: unknown }>
): string | null {
  const text = answers.find(
    (a) => a.type === "text" && typeof a.value === "string" && a.value.trim()
  );
  return text ? String(text.value).slice(0, 2000) : null;
}

async function notifyAfterResponse(args: {
  orgId: string;
  dealId: string | null;
  responseId: string;
  templateName: string;
  respondentRole: string;
  respondentName: string | null;
  npsScore: number | null;
  csatScore: number | null;
  comment: string | null;
}) {
  const detractor = isDetractor(args.npsScore, args.csatScore);
  const deal = args.dealId
    ? await prisma.deal.findUnique({
        where: { id: args.dealId },
        select: {
          id: true,
          title: true,
          kind: true,
          userId: true,
          user: { select: { email: true } },
        },
      })
    : null;

  const baseUrl = process.env.NEXTAUTH_URL ?? "https://imobpro.ia.br";
  const dealUrl = deal
    ? `${baseUrl}/pipeline${deal.kind === "locacao" ? "/locacao" : ""}?deal=${deal.id}`
    : null;
  const respondent = args.respondentName ?? "Um participante";
  const scoreLabel = [
    args.npsScore !== null ? `NPS ${args.npsScore}/10` : null,
    args.csatScore !== null ? `CSAT ${args.csatScore}/5` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  await emitNotification({
    orgId: args.orgId,
    userId: deal?.userId ?? null,
    type: detractor ? "survey_detractor" : "survey_response",
    title: detractor
      ? `⚠️ Nota baixa: ${args.templateName}`
      : `Nova resposta: ${args.templateName}`,
    body: `${respondent} (${args.respondentRole})${scoreLabel ? ` — ${scoreLabel}` : ""}${
      deal?.title ? ` · ${deal.title}` : ""
    }`,
    linkUrl: dealUrl ?? "/pesquisas/relatorios",
    batchId: args.responseId,
    metadata: { responseId: args.responseId, dealId: args.dealId },
  });

  if (detractor && deal?.user?.email) {
    await sendEmail({
      to: deal.user.email,
      subject: `⚠️ Nota baixa em pesquisa — ${deal.title ?? args.templateName}`,
      react: SurveyDetractorAlertEmail({
        surveyName: args.templateName,
        respondentName: respondent,
        respondentRole: args.respondentRole,
        npsScore: args.npsScore,
        csatScore: args.csatScore,
        comment: args.comment,
        dealUrl,
      }),
      orgId: args.orgId,
    });
  }
}
