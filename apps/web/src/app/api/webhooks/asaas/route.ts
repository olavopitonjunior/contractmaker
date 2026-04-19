import { NextRequest, NextResponse } from "next/server";
import {
  validateWebhookToken,
  parseWebhookPayload,
  applyWebhookToCharge,
} from "@/lib/asaas/webhook";

/**
 * POST /api/webhooks/asaas
 * Rota pública — validação via header asaas-access-token (timingSafeEqual).
 * Idempotente: dedup por AsaasWebhookEvent.asaasEventId @unique.
 */
export async function POST(req: NextRequest) {
  // 1. Validate token
  const headerToken =
    req.headers.get("asaas-access-token") ??
    req.headers.get("x-asaas-token") ??
    null;

  if (!validateWebhookToken(headerToken)) {
    return NextResponse.json(
      { error: "INVALID_TOKEN" },
      { status: 401 }
    );
  }

  // 2. Parse body
  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return NextResponse.json(
      { error: "INVALID_JSON" },
      { status: 400 }
    );
  }

  const payload = parseWebhookPayload(rawBody);
  if (!payload) {
    return NextResponse.json(
      { error: "INVALID_PAYLOAD" },
      { status: 400 }
    );
  }

  // 3. Apply
  try {
    const result = await applyWebhookToCharge(payload);
    // Sempre retorna 200 — mesmo para duplicados ou ignorados — para evitar
    // retry infinito do Asaas.
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[webhook/asaas] erro ao processar", err);
    // Retornar 500 faz o Asaas retry — útil se a falha for transiente.
    return NextResponse.json(
      { error: "PROCESSING_ERROR", message: err instanceof Error ? err.message : "unknown" },
      { status: 500 }
    );
  }
}

// Webhook é pública por design (Asaas chama). Runtime Node para Prisma.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
