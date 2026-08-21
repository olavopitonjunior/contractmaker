import { NextRequest, NextResponse } from "next/server";
import { createHmac } from "node:crypto";
import { requireAuth } from "@/lib/auth/context";
import { prisma } from "@/lib/db/prisma";
import {
  requirePermission,
  PermissionDeniedError,
  MembershipRequiredError,
} from "@/lib/security/rbac/guard";
import { PERMISSION } from "@/lib/security/rbac/permissions";
import { audit } from "@/lib/security/audit";
import { z } from "zod";
import { sendEmail } from "@/lib/email/client";
import { SplitRecipientCompletionEmail } from "@/lib/email/templates/split-recipient-completion";
import { resolveWhatsappAgent, dispatchWhatsappNotify } from "@/lib/agents/whatsapp-router";
import { isWithinWhatsappWindow } from "@/lib/newton/whatsapp-window";
import { getOrgBrand } from "@/lib/tenant/branding";

export const runtime = "nodejs";

/**
 * POST /api/financeiro/split-recipients/[id]/request-completion
 *
 * Gera JWT-like token (HMAC-SHA256 com AUTH_SECRET) válido por 7 dias e envia
 * email pro destinatário completar dados via /financeiro/completar-cadastro?token=.
 *
 * Token format: base64url(json).base64url(hmac). Stateless, mas persistimos
 * em SplitRecipient.completionToken/Exp pra invalidar após uso.
 *
 * Canais (2026-08): body opcional `{ channels?: ("email"|"whatsapp")[] }`.
 * Default = todos os canais VIÁVEIS (email cadastrado; WhatsApp = flag
 * notifyByWhatsapp + telefone). 422 só quando nenhum canal pedido é viável.
 * WhatsApp via agente do tenant (Newton/Max) — mesmo caminho best-effort das
 * notificações de deal; Newton respeita a janela 7h–22h (fora dela reporta
 * `skipped` e o email, se viável, segue).
 */

const bodySchema = z.object({
  channels: z.array(z.enum(["email", "whatsapp"])).min(1).max(2).optional(),
});

function b64url(s: string): string {
  return Buffer.from(s).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function signToken(payload: object, secret: string): string {
  const head = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64url(JSON.stringify(payload));
  const sig = createHmac("sha256", secret)
    .update(`${head}.${body}`)
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return `${head}.${body}.${sig}`;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAuth(req);
  if (!authResult.ok) return authResult.response;
  const { ctx } = authResult;
  const { id } = await params;

  try {
    await requirePermission({
      userId: ctx.userId,
      orgId: ctx.orgId,
      permission: PERMISSION.SPLIT_CONFIGURE,
    });
  } catch (err) {
    if (err instanceof PermissionDeniedError || err instanceof MembershipRequiredError) {
      return NextResponse.json({ error: err.code }, { status: err.status });
    }
    throw err;
  }

  const recipient = await prisma.splitRecipient.findFirst({
    where: { id, orgId: ctx.orgId },
  });
  if (!recipient) {
    return NextResponse.json({ error: "Destinatário não encontrado" }, { status: 404 });
  }
  if ((recipient.pendingFields ?? []).length === 0) {
    return NextResponse.json(
      { error: "Cadastro já completo — sem campos pendentes" },
      { status: 422 }
    );
  }

  const rawBody = await req.json().catch(() => ({}));
  const parsedBody = bodySchema.safeParse(rawBody ?? {});
  if (!parsedBody.success) {
    return NextResponse.json(
      { error: "Body inválido", details: parsedBody.error.format() },
      { status: 400 }
    );
  }

  const viable = {
    email: Boolean(recipient.email),
    // notifyOptOut silencia TODOS os canais de mensagem ativa (mesma regra de
    // deal-brokers.isEligible); email fica como sempre foi (transacional).
    whatsapp: Boolean(
      recipient.notifyByWhatsapp && recipient.phone && !recipient.notifyOptOut
    ),
  };
  const requested = parsedBody.data.channels ?? (
    [
      ...(viable.email ? (["email"] as const) : []),
      ...(viable.whatsapp ? (["whatsapp"] as const) : []),
    ]
  );
  const selected = requested.filter((c) => viable[c]);
  if (selected.length === 0) {
    return NextResponse.json(
      {
        error:
          "Nenhum canal viável — cadastre um email, ou telefone + notificação por WhatsApp ligada",
        viable,
      },
      { status: 422 }
    );
  }

  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "AUTH_SECRET não configurado" }, { status: 500 });
  }

  const exp = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const token = signToken(
    {
      recipientId: recipient.id,
      orgId: ctx.orgId,
      exp: Math.floor(exp.getTime() / 1000),
    },
    secret
  );

  await prisma.splitRecipient.update({
    where: { id: recipient.id },
    data: { completionToken: token, completionTokenExp: exp },
  });

  const baseUrl = process.env.NEXTAUTH_URL ?? "https://imobpro.ia.br";
  const link = `${baseUrl}/financeiro/completar-cadastro?token=${encodeURIComponent(token)}`;

  const channelResults: Record<string, string> = {};

  if (selected.includes("email") && recipient.email) {
    const r = await sendEmail({
      to: recipient.email,
      subject: "Complete seu cadastro de destinatário",
      react: SplitRecipientCompletionEmail({
        recipientName: recipient.label,
        pendingFields: recipient.pendingFields ?? [],
        link,
        expiresAt: exp.toLocaleDateString("pt-BR"),
      }),
      tags: [{ name: "kind", value: "split_recipient_completion" }],
    });
    channelResults.email = r.ok ? "sent" : `failed: ${r.error ?? "envio recusado"}`;
  }

  if (selected.includes("whatsapp") && recipient.phone) {
    // Pagadoria pertence a Vendas — resolve o agente pelo kind "venda".
    const agent = await resolveWhatsappAgent(ctx.orgId, "venda");
    if (!agent) {
      channelResults.whatsapp = "skipped: sem_agente_de_whatsapp_para_a_org";
    } else if (agent === "newton" && !isWithinWhatsappWindow()) {
      // Newton não tem fila; fora da janela 7h–22h não envia (o Max agenda).
      channelResults.whatsapp = "skipped: fora_da_janela";
    } else {
      const brand = await getOrgBrand(ctx.orgId);
      const r = await dispatchWhatsappNotify(agent, {
        orgId: ctx.orgId,
        audience: "deal_broker",
        phone: recipient.phone,
        recipientName: recipient.label,
        title: "Complete seu cadastro de corretor",
        body: `Faltam alguns dados do seu cadastro (recebimento de comissão). Complete pelo link até ${exp.toLocaleDateString("pt-BR")}.`,
        newtonTrailer: `Acesse: ${link}`,
        linkUrl: link,
        dealId: null,
        orgName: brand?.displayName ?? "imobiliária",
        dedupeKey: `split_recipient_completion:${recipient.id}:${exp.getTime()}`,
      });
      channelResults.whatsapp =
        r.status === "sent"
          ? "sent"
          : r.status === "skipped"
            ? `skipped: ${r.reason}`
            : `failed: ${r.error}`;
    }
  }

  const anySent = Object.values(channelResults).some((v) => v === "sent");

  await audit(
    {
      orgId: ctx.orgId,
      userId: ctx.userId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    },
    {
      action: "SPLIT_RECIPIENT_COMPLETION_REQUESTED",
      result: anySent ? "SUCCESS" : "FAILURE",
      resourceType: "split_recipient",
      resource: `split_recipient:${recipient.id}`,
      metadata: {
        email: recipient.email ?? undefined,
        channels: channelResults,
        expiresAt: exp.toISOString(),
      },
    }
  );

  // ok=false quando NENHUM canal enviou — atenção: o token novo já foi
  // persistido (o link precisa existir antes do envio), então o link anterior
  // está invalidado; a UI deve orientar a tentar de novo.
  return NextResponse.json({
    ok: anySent,
    channels: channelResults,
    expiresAt: exp.toISOString(),
  });
}
