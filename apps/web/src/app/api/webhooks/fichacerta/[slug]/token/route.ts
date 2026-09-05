import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { audit } from "@/lib/security/audit";
import { RateLimits } from "@/lib/security/ratelimit";
import { decryptWebhookQuerySecret, decryptWebhookTokenPassword } from "@/lib/fichacerta/account";
import { issueWebhookToken, verifyTokenCredentials } from "@/lib/fichacerta/webhook-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function clientIp(req: NextRequest): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "anon";
}

/**
 * POST /api/webhooks/fichacerta/[slug]/token — `token_url` do webhook.
 *
 * A Ficha Certa manda `{ username, password }` (o par gravado na conta na
 * conexão) e recebe `{ access_token, token_type, expires_in }`; o token vai
 * como `Authorization: Bearer` na entrega do laudo. Fail-closed: conta
 * inexistente → 404, par errado → 401 auditado. Aceita JSON e form-urlencoded
 * (a doc deles não fixa o content-type).
 */
export async function POST(req: NextRequest, { params }: { params: { slug: string } }) {
  const rl = await RateLimits.fichaCertaWebhookPerSlug(params.slug);
  if (!rl.success) return NextResponse.json({ error: "rate_limited" }, { status: 429 });

  const account = await prisma.fichaCertaAccount.findUnique({ where: { webhookSlug: params.slug } });
  if (!account) return NextResponse.json({ error: "unknown" }, { status: 404 });

  let body: Record<string, unknown> = {};
  const ct = req.headers.get("content-type") ?? "";
  try {
    if (ct.includes("application/x-www-form-urlencoded")) {
      body = Object.fromEntries(new URLSearchParams(await req.text()).entries());
    } else {
      const raw: unknown = JSON.parse(await req.text());
      if (raw && typeof raw === "object") body = raw as Record<string, unknown>;
    }
  } catch {
    body = {};
  }

  const ok = verifyTokenCredentials(
    { username: body.username ?? body.login ?? body.user, password: body.password ?? body.senha },
    { tokenUser: account.webhookTokenUser, tokenPassword: decryptWebhookTokenPassword(account) }
  );
  if (!ok) {
    await audit(
      { orgId: account.orgId, userId: null, ipAddress: clientIp(req), userAgent: req.headers.get("user-agent") },
      { action: "CREDIT_WEBHOOK_REJECTED", result: "DENIED", resource: account.id, resourceType: "FichaCertaAccount", metadata: { stage: "token" } }
    ).catch(() => {});
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { token, expiresIn } = issueWebhookToken(params.slug, decryptWebhookQuerySecret(account));
  return NextResponse.json({ access_token: token, token_type: "Bearer", expires_in: expiresIn });
}
