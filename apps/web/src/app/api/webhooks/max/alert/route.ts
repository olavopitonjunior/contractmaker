import { NextRequest, NextResponse } from "next/server";
import { verifyMaxWebhook } from "@/lib/max/delivery-webhook";
import { parseMaxAlert, deliverMaxAlert } from "@/lib/max/alert-webhook";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/webhooks/max/alert — o Max avisa que a instância Z-API caiu (ou
 * voltou). Vira e-mail. Ver `lib/max/alert-webhook.ts` e `docs/max.md` §9.
 *
 * Auth: o MESMO HMAC e o MESMO `MAX_WEBHOOK_SECRET` do `/api/webhooks/max` —
 * é a mesma direção (Max → cá) e o mesmo tipo de segredo (de serviço, não de
 * tenant). Reusa `verifyMaxWebhook` em vez de repetir a verificação: código de
 * cripto duplicado é onde um conserto futuro esquece uma cópia.
 *
 * Os códigos de erro conversam com o cliente do outro lado, que classifica
 * 404/408/429/401/403/5xx como "integração fora" (retenta) e 4xx de payload
 * como "recusado" (desiste). Por isso e-mail não enviado é **500** e não 200:
 * o carimbo do Max só acontece no sucesso, então o 500 vira reenvio na passada
 * seguinte, sem fila nova nem código de retry.
 */
export async function POST(req: NextRequest) {
  const secret = process.env.MAX_WEBHOOK_SECRET;
  if (!secret) {
    // 503, como o webhook vizinho: sem env a integração está DESLIGADA. É o
    // estado normal enquanto o receptor está deployado e o emissor não —
    // "receptor primeiro, inerte" (regra 2 do CLAUDE.md).
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }

  // Corpo CRU, byte a byte: a assinatura foi calculada sobre esta string.
  const rawBody = await req.text();

  const isValid = verifyMaxWebhook({
    timestamp: req.headers.get("x-max-timestamp"),
    signature: req.headers.get("x-max-signature"),
    rawBody,
    secret,
  });
  if (!isValid) {
    console.warn("[webhook/max-alert] assinatura recusada");
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const alert = parseMaxAlert(payload);
  if (!alert) {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  try {
    const sent = await deliverMaxAlert(alert);
    if (!sent) {
      return NextResponse.json({ error: "email_failed" }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(
      "[webhook/max-alert] falha ao entregar alerta:",
      err instanceof Error ? err.message : String(err)
    );
    return NextResponse.json({ error: "alert_failed" }, { status: 500 });
  }
}
