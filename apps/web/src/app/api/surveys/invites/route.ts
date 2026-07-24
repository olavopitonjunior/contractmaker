import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import {
  requireApiAuth,
  isAuthFailure,
  authFailureResponse,
} from "@/lib/api/require-auth";
import { assertFeatureEnabled, ModuleDisabledError } from "@/lib/modules/guard";
import { surveyFeatureForKind } from "@/lib/modules/catalog";
import { assertAnySurveyFeature } from "@/lib/surveys/guard";
import { SURVEY_RECIPIENT_ROLES } from "@/lib/surveys/types";
import { newSurveyToken } from "@/lib/surveys/token";
import {
  buildDedupeKey,
  normalizeEmail,
  normalizePhone,
} from "@/lib/surveys/recipients";
import { sendSurveyInvite, surveyUrl } from "@/lib/surveys/channels";
import { audit, extractAuditContextFromRequest } from "@/lib/security/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const recipientSchema = z.object({
  role: z.enum(SURVEY_RECIPIENT_ROLES),
  name: z.string().min(1).max(200),
  email: z.string().email().optional().nullable(),
  phone: z.string().max(20).optional().nullable(),
});

const createSchema = z
  .object({
    templateId: z.string().min(1),
    dealId: z.string().min(1).optional(),
    // whatsapp = via Newton, fallback email; exige deal (NewtonRequest é
    // ancorado em Deal).
    channel: z.enum(["email", "manual", "whatsapp"]),
    recipients: z.array(recipientSchema).min(1).max(20),
  })
  .superRefine((data, ctx) => {
    if (data.channel === "whatsapp" && !data.dealId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["dealId"],
        message: "Envio por WhatsApp requer um negócio vinculado",
      });
    }
  });

// GET /api/surveys/invites?dealId= — envios de um deal (aba Pesquisas).
export async function GET(req: NextRequest) {
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

  const dealId = new URL(req.url).searchParams.get("dealId");
  if (!dealId) {
    return NextResponse.json({ error: "dealId obrigatório" }, { status: 400 });
  }

  const invites = await prisma.surveyInvite.findMany({
    where: { orgId: auth.org.id, dealId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      templateId: true,
      recipientRole: true,
      recipientName: true,
      recipientEmail: true,
      channel: true,
      token: true,
      status: true,
      sentAt: true,
      respondedAt: true,
      remindersSent: true,
      createdAt: true,
      template: { select: { name: true, version: true } },
      response: { select: { npsScore: true, csatScore: true } },
    },
  });

  return NextResponse.json({
    invites: invites.map((i) => ({ ...i, url: surveyUrl(i.token) })),
  });
}

// POST /api/surveys/invites — envio manual (email) ou geração de link.
export async function POST(req: NextRequest) {
  const auth = await requireApiAuth(req);
  if (isAuthFailure(auth)) return authFailureResponse(auth);

  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Dados inválidos", issues: parsed.error.issues },
      { status: 400 }
    );
  }

  // Template da própria org (é a versão/lote congelado no invite).
  const template = await prisma.surveyTemplate.findFirst({
    where: { id: parsed.data.templateId, orgId: auth.org.id },
    select: { id: true, name: true, status: true },
  });
  if (!template) {
    return NextResponse.json({ error: "Pesquisa não encontrada" }, { status: 404 });
  }
  if (template.status === "archived") {
    return NextResponse.json(
      { error: "Pesquisa arquivada não recebe novos envios" },
      { status: 400 }
    );
  }

  // Gate por kind quando escopado a deal; senão anyOf.
  let dealId: string | null = null;
  let dealContext: { id: string; kind: string; userId: string } | null = null;
  try {
    if (parsed.data.dealId) {
      const deal = await prisma.deal.findFirst({
        where: { id: parsed.data.dealId, pipeline: { orgId: auth.org.id } },
        select: { id: true, kind: true, userId: true },
      });
      if (!deal) {
        return NextResponse.json({ error: "Negócio não encontrado" }, { status: 404 });
      }
      await assertFeatureEnabled(auth.org.id, surveyFeatureForKind(deal.kind));
      dealId = deal.id;
      dealContext = {
        id: deal.id,
        kind: deal.kind === "locacao" ? "locacao" : "venda",
        userId: deal.userId,
      };
    } else {
      await assertAnySurveyFeature(auth.org.id);
    }
  } catch (e) {
    if (e instanceof ModuleDisabledError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    throw e;
  }

  const results: Array<{
    recipient: string;
    status: "created" | "duplicate" | "failed";
    url?: string;
    inviteId?: string;
    reason?: string;
    fellBack?: boolean;
  }> = [];

  for (const recipient of parsed.data.recipients) {
    const email = normalizeEmail(recipient.email);
    const phone = normalizePhone(recipient.phone);
    if (parsed.data.channel === "email" && !email) {
      results.push({
        recipient: recipient.name,
        status: "failed",
        reason: "sem e-mail",
      });
      continue;
    }
    // WhatsApp precisa de ao menos UM contato viável (telefone, ou email pro
    // fallback automático).
    if (parsed.data.channel === "whatsapp" && !phone && !email) {
      results.push({
        recipient: recipient.name,
        status: "failed",
        reason: "sem telefone nem e-mail",
      });
      continue;
    }

    const { token, exp } = newSurveyToken();
    const contact = email ?? phone ?? token; // manual sem contato: chave única por token
    const dedupeKey = buildDedupeKey({
      dealId,
      templateId: template.id,
      role: recipient.role,
      contact,
    });

    let invite;
    try {
      invite = await prisma.surveyInvite.create({
        data: {
          orgId: auth.org.id,
          templateId: template.id,
          dealId,
          recipientRole: recipient.role,
          recipientName: recipient.name,
          recipientEmail: email,
          recipientPhone: phone,
          channel: parsed.data.channel,
          token,
          tokenExp: exp,
          dedupeKey,
        },
      });
    } catch (e) {
      if ((e as { code?: string })?.code === "P2002") {
        // Já existe envio deste lote pra este destinatário neste deal.
        const existing = await prisma.surveyInvite.findUnique({
          where: { dedupeKey },
          select: { id: true, token: true },
        });
        results.push({
          recipient: recipient.name,
          status: "duplicate",
          inviteId: existing?.id,
          url: existing ? surveyUrl(existing.token) : undefined,
        });
        continue;
      }
      throw e;
    }

    void audit(extractAuditContextFromRequest(req, auth.org.id, auth.actor.effectiveUserId), {
      action: "SURVEY_INVITE_CREATED",
      result: "SUCCESS",
      resource: invite.id,
      resourceType: "SurveyInvite",
      metadata: {
        templateId: template.id,
        dealId,
        role: recipient.role,
        channel: parsed.data.channel,
      },
    });

    const sent = await sendSurveyInvite({
      invite,
      templateName: template.name,
      orgId: auth.org.id,
      deal: dealContext,
    });

    results.push({
      recipient: recipient.name,
      status: sent.ok ? "created" : "failed",
      inviteId: invite.id,
      url: surveyUrl(invite.token),
      reason: sent.ok ? undefined : sent.reason,
      // Sinaliza pro dialog que o WhatsApp caiu pro fallback email.
      fellBack: sent.ok && sent.channel === "email" && sent.fellBack ? true : undefined,
    });
  }

  return NextResponse.json({ results }, { status: 201 });
}
