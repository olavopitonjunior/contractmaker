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
import { sendEmail } from "@/lib/email/client";
import { SplitRecipientCompletionEmail } from "@/lib/email/templates/split-recipient-completion";

export const runtime = "nodejs";

/**
 * POST /api/financeiro/split-recipients/[id]/request-completion
 *
 * Gera JWT-like token (HMAC-SHA256 com AUTH_SECRET) válido por 7 dias e envia
 * email pro destinatário completar dados via /financeiro/completar-cadastro?token=.
 *
 * Token format: base64url(json).base64url(hmac). Stateless, mas persistimos
 * em SplitRecipient.completionToken/Exp pra invalidar após uso.
 */

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
  if (!recipient.email) {
    return NextResponse.json(
      { error: "Destinatário sem email cadastrado — adicione antes de gerar link" },
      { status: 422 }
    );
  }
  if ((recipient.pendingFields ?? []).length === 0) {
    return NextResponse.json(
      { error: "Cadastro já completo — sem campos pendentes" },
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

  await sendEmail({
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

  await audit(
    {
      orgId: ctx.orgId,
      userId: ctx.userId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    },
    {
      action: "SPLIT_RECIPIENT_COMPLETION_REQUESTED",
      result: "SUCCESS",
      resourceType: "split_recipient",
      resource: `split_recipient:${recipient.id}`,
      metadata: { email: recipient.email, expiresAt: exp.toISOString() },
    }
  );

  return NextResponse.json({ ok: true, expiresAt: exp.toISOString() });
}
