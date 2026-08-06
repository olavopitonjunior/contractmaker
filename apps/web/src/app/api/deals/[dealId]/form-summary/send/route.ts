import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { sendFormSummary } from "@/lib/forms/form-summary-mailer";
import { guardDealScope } from "@/lib/deals/route-helpers";
import { PERMISSION } from "@/lib/security/rbac/permissions";
import { audit, extractAuditContextFromRequest } from "@/lib/security/audit";

export const runtime = "nodejs";
export const maxDuration = 120;

const bodySchema = z.object({
  to: z.string().email("E-mail inválido"),
  includeAttachments: z.boolean().optional().default(true),
});

/**
 * Envia o resumo consolidado do formulário do deal por e-mail (com o PDF e,
 * opcionalmente, os documentos anexados). Autenticado — `to` restrito a
 * membros da org: o resumo é dossiê interno e não pode chegar às partes
 * (comprador/vendedor). Só venda.
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

  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Body inválido" },
      { status: 400 }
    );
  }

  const deal = await prisma.deal.findUnique({
    where: { id: params.dealId },
    select: {
      id: true,
      kind: true,
      formId: true,
      pipeline: { select: { orgId: true } },
    },
  });
  if (!deal) return NextResponse.json({ error: "Deal not found" }, { status: 404 });
  if (deal.pipeline.orgId !== org.id) {
    return NextResponse.json({ error: "Deal not found" }, { status: 404 });
  }
  // Escopo do gerente + DEAL_EDIT (dispara e-mail com o dossiê).
  const denied = await guardDealScope({
    dealId: params.dealId,
    userId: session.user.id,
    orgId: org.id,
    permission: PERMISSION.DEAL_EDIT,
  });
  if (denied) return denied;

  if (deal.kind !== "venda" && deal.kind !== "locacao") {
    return NextResponse.json(
      { error: "Resumo consolidado disponível apenas para negócios de venda e locação" },
      { status: 400 }
    );
  }
  if (!deal.formId) {
    return NextResponse.json({ error: "Negócio sem formulário vinculado" }, { status: 400 });
  }

  // O destino precisa ser usuário do sistema (membro da org) — o resumo carrega
  // dados de todas as partes e não pode ser entregue a comprador/vendedor.
  const memberRecipient = await prisma.orgMembership.findFirst({
    where: {
      orgId: org.id,
      user: { email: { equals: parsed.data.to, mode: "insensitive" } },
    },
    select: { id: true },
  });
  if (!memberRecipient) {
    return NextResponse.json(
      { error: "O resumo só pode ser enviado para usuários do sistema" },
      { status: 403 }
    );
  }

  const result = await sendFormSummary({
    formId: deal.formId,
    to: parsed.data.to,
    includeAttachments: parsed.data.includeAttachments,
    persist: true,
  });

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error ?? "Falha ao enviar e-mail", ...result },
      { status: 502 }
    );
  }

  await audit(extractAuditContextFromRequest(req, org.id, session.user.id), {
    action: "FORM_SUMMARY_SENT",
    result: "SUCCESS",
    resource: deal.formId,
    resourceType: "SalesForm",
    metadata: {
      dealId: deal.id,
      to: parsed.data.to,
      includeAttachments: parsed.data.includeAttachments,
    },
  });

  return NextResponse.json(result);
}
