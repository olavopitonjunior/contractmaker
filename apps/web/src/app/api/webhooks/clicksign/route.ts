import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { audit } from "@/lib/security/audit";
import { verifyWebhookSignature } from "@/lib/clicksign/webhook";
import { processClickSignWebhookPayload } from "@/lib/clicksign/webhook-process";
import type { WebhookPayload } from "@/lib/clicksign/types";

export const runtime = "nodejs";
// O trabalho pesado roda em `waitUntil` e conta pro tempo da invocação: baixar
// o PDF assinado, ou — no Aceite — consultar a ClickSign e então renderizar o
// comprovante com Puppeteer. O comprovante é o ÚNICO artefato do Aceite do
// nosso lado, então ser morto antes de gerá-lo é perda de dado.
export const maxDuration = 60;

/**
 * Coleta os headers que importam pra debugar HMAC + identificação. Não
 * loga `cookie`, `authorization`, etc. — apenas headers ClickSign-specific
 * + content-type/length.
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

export async function POST(req: NextRequest) {
  const secret = process.env.CLICKSIGN_WEBHOOK_SECRET;
  const rawBody = await req.text();
  const headers = collectRelevantHeaders(req);
  const bodyHash = crypto
    .createHash("sha256")
    .update(rawBody)
    .digest("hex")
    .slice(0, 16);

  // Log SEMPRE — incluindo quando HMAC falha. Isso permite diagnosticar
  // se o ClickSign está realmente mandando, com qual header de
  // assinatura, e se nosso secret bate.
  // Pré-resolução de tenant: ainda não sabemos qual envelope/org é. orgId=null
  // (Fase 0c) em vez de cair na org compartilhada legada. Pós-resolução audita
  // com o orgId real.
  await audit(
    { orgId: null, userId: null },
    {
      action: "CLICKSIGN_WEBHOOK_RECEIVED",
      result: "SUCCESS",
      resourceType: "Webhook",
      metadata: {
        headers,
        bodyHash,
        bodyLength: rawBody.length,
        bodyExcerpt: rawBody.slice(0, 1000),
      },
    }
  ).catch(() => {});

  // Fail-closed: sem secret configurado, NÃO processa (antes o bloco HMAC era
  // pulado e qualquer POST forjava um `close` → auto-promoção de deal + SSRF
  // no downloadSignedPdf). Espelha o webhook Asaas, que já rejeita sem token.
  if (!secret) {
    console.error(
      "[clicksign webhook] CLICKSIGN_WEBHOOK_SECRET não configurado — rejeitando request"
    );
    await audit(
      { orgId: null, userId: null },
      {
        action: "CLICKSIGN_WEBHOOK_REJECTED",
        result: "DENIED",
        resourceType: "Webhook",
        metadata: { reason: "secret not configured", bodyHash },
      }
    ).catch(() => {});
    return NextResponse.json(
      { error: "Webhook não configurado" },
      { status: 503 }
    );
  }

  {
    const sigHeader =
      req.headers.get("content-hmac") ||
      req.headers.get("x-clicksign-signature") ||
      req.headers.get("x-hub-signature-256");
    const ok = verifyWebhookSignature(rawBody, sigHeader, secret);
    if (!ok) {
      await audit(
        { orgId: null, userId: null },
        {
          action: "CLICKSIGN_WEBHOOK_REJECTED",
          result: "DENIED",
          resourceType: "Webhook",
          metadata: {
            reason: "HMAC mismatch",
            sigHeaderPresent: Boolean(sigHeader),
            sigHeaderName: req.headers.get("content-hmac")
              ? "content-hmac"
              : req.headers.get("x-clicksign-signature")
                ? "x-clicksign-signature"
                : req.headers.get("x-hub-signature-256")
                  ? "x-hub-signature-256"
                  : null,
            sigPreview: sigHeader?.slice(0, 16),
            bodyHash,
          },
        }
      ).catch(() => {});
      return NextResponse.json(
        { error: "Assinatura inválida" },
        { status: 401 }
      );
    }
  }

  let payload: WebhookPayload;
  try {
    payload = JSON.parse(rawBody) as WebhookPayload;
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }

  // Rota legada (org compartilhada, secret global): sem escopo de org, o lookup
  // do envelope é global. A lógica de mutação é compartilhada com a rota
  // per-org via processClickSignWebhookPayload.
  const result = await processClickSignWebhookPayload(payload);
  return NextResponse.json(result);
}
