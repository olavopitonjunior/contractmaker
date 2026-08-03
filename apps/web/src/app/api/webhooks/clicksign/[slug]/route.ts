import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { prisma } from "@/lib/db/prisma";
import { audit } from "@/lib/security/audit";
import { verifyWebhookSignature } from "@/lib/clicksign/webhook";
import { processClickSignWebhookPayload } from "@/lib/clicksign/webhook-process";
import { decryptWebhookSecret } from "@/lib/clicksign/account";
import type { WebhookPayload } from "@/lib/clicksign/types";

export const runtime = "nodejs";
// Ver a rota legada: o `waitUntil` (PDF assinado / consulta do Aceite +
// Puppeteer do comprovante) conta pro tempo da invocação.
export const maxDuration = 60;

/**
 * Webhook ClickSign PER-ORG. A URL carrega o `slug` público da conta do tenant
 * (ClickSignAccount.webhookSlug) → identificamos a org ANTES de validar o HMAC,
 * e cada conta tem seu próprio secret. Isso permite que cada imobiliária use a
 * própria conta ClickSign (com seu webhook e secret), diferente da rota legada
 * /api/webhooks/clicksign (secret global da org compartilhada).
 *
 * O lookup do envelope é restrito ao orgId da conta (defesa cross-org).
 */
function collectRelevantHeaders(req: NextRequest): Record<string, string> {
  const out: Record<string, string> = {};
  const want = [
    "content-type",
    "content-length",
    "user-agent",
    "content-hmac",
    "x-clicksign-signature",
    "x-hub-signature-256",
    "x-clicksign-event",
    "x-forwarded-for",
  ];
  for (const h of want) {
    const v = req.headers.get(h);
    if (v) out[h] = v;
  }
  return out;
}

export async function POST(
  req: NextRequest,
  { params }: { params: { slug: string } }
) {
  const rawBody = await req.text();
  const headers = collectRelevantHeaders(req);
  const bodyHash = crypto
    .createHash("sha256")
    .update(rawBody)
    .digest("hex")
    .slice(0, 16);

  // Identifica o tenant pelo slug ANTES do HMAC (o slug não é secreto — é só um
  // roteador; a autenticação é o HMAC com o secret da conta).
  const account = await prisma.clickSignAccount.findUnique({
    where: { webhookSlug: params.slug },
  });

  await audit(
    { orgId: account?.orgId ?? null, userId: null },
    {
      action: "CLICKSIGN_WEBHOOK_RECEIVED",
      result: "SUCCESS",
      resourceType: "Webhook",
      metadata: {
        slug: params.slug,
        headers,
        bodyHash,
        bodyLength: rawBody.length,
        bodyExcerpt: rawBody.slice(0, 1000),
      },
    }
  ).catch(() => {});

  if (!account) {
    // Slug desconhecido — não vaza se existe ou não; 404 genérico.
    return NextResponse.json({ error: "Webhook não encontrado" }, { status: 404 });
  }

  const secret = decryptWebhookSecret(account);
  if (!secret) {
    console.error(
      `[clicksign webhook ${params.slug}] conta sem webhook secret — rejeitando`
    );
    await audit(
      { orgId: account.orgId, userId: null },
      {
        action: "CLICKSIGN_WEBHOOK_REJECTED",
        result: "DENIED",
        resourceType: "Webhook",
        metadata: { slug: params.slug, reason: "secret not configured", bodyHash },
      }
    ).catch(() => {});
    return NextResponse.json({ error: "Webhook não configurado" }, { status: 503 });
  }

  const sigHeader =
    req.headers.get("content-hmac") ||
    req.headers.get("x-clicksign-signature") ||
    req.headers.get("x-hub-signature-256");
  if (!verifyWebhookSignature(rawBody, sigHeader, secret)) {
    await audit(
      { orgId: account.orgId, userId: null },
      {
        action: "CLICKSIGN_WEBHOOK_REJECTED",
        result: "DENIED",
        resourceType: "Webhook",
        metadata: {
          slug: params.slug,
          reason: "HMAC mismatch",
          sigHeaderPresent: Boolean(sigHeader),
          bodyHash,
        },
      }
    ).catch(() => {});
    return NextResponse.json({ error: "Assinatura inválida" }, { status: 401 });
  }

  let payload: WebhookPayload;
  try {
    payload = JSON.parse(rawBody) as WebhookPayload;
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }

  const result = await processClickSignWebhookPayload(payload, {
    orgId: account.orgId,
  });
  return NextResponse.json(result);
}
