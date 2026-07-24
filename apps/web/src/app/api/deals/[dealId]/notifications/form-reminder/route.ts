import { NextRequest, NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { audit, extractAuditContextFromRequest } from "@/lib/security/audit";
import { notifyDealEvent } from "@/lib/notifications/deal-events";

export const runtime = "nodejs";

/**
 * Disparo MANUAL do lembrete de preenchimento (botão na aba Notificações).
 * dedupeKey por minuto — anti double-click sem impedir um novo lembrete
 * deliberado mais tarde no dia.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { dealId: string } }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const org = await getUserOrg(session.user.id);
  if (!org) {
    return NextResponse.json({ error: "No organization" }, { status: 400 });
  }

  const deal = await prisma.deal.findUnique({
    where: { id: params.dealId },
    select: {
      id: true,
      pipeline: { select: { orgId: true } },
      form: { select: { id: true, token: true, completedAt: true } },
    },
  });
  if (!deal || deal.pipeline.orgId !== org.id) {
    return NextResponse.json({ error: "Deal not found" }, { status: 404 });
  }
  if (!deal.form) {
    return NextResponse.json(
      { error: "Este negócio não tem formulário vinculado" },
      { status: 422 }
    );
  }
  if (deal.form.completedAt) {
    return NextResponse.json(
      { error: "O formulário já foi concluído — nada a lembrar" },
      { status: 422 }
    );
  }

  const baseUrl = process.env.NEXTAUTH_URL ?? "https://imobpro.ia.br";
  const stamp = new Date()
    .toISOString()
    .slice(0, 16) // yyyy-mm-ddThh:mm
    .replace(/\D/g, "");

  await notifyDealEvent({
    dealId: deal.id,
    orgId: org.id,
    event: "form_reminder",
    dedupeKey: `manual-${stamp}`,
    context: {
      formId: deal.form.id,
      formPublicUrl: `${baseUrl}/f/${deal.form.token}`,
      extra: { manual: true, by: session.user.id },
    },
  });

  waitUntil(
    audit(extractAuditContextFromRequest(req, org.id, session.user.id), {
      action: "FORM_REMINDER_SENT",
      result: "SUCCESS",
      resource: deal.id,
      resourceType: "Deal",
      metadata: { formId: deal.form.id, manual: true },
    })
  );

  return NextResponse.json({ ok: true });
}
