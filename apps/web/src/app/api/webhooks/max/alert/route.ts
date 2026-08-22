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
 * **O cliente deste endpoint trata QUALQUER não-2xx como "retenta"** — não é o
 * tri-estado do `/api/webhooks/max` vizinho, que classifica 4xx como recusa e
 * desiste. `reportAlert` (`max-agent/src/lib/cm.ts`) não tem contador de
 * tentativas para proteger: o retry é simplesmente a passada seguinte do cron.
 *
 * Duas consequências que importam para quem mexer aqui:
 *
 *  · e-mail não enviado é **500**, nunca 200 — o carimbo do Max só acontece no
 *    sucesso, então o 500 vira reenvio, sem fila nova nem código de retry;
 *  · um **400** por divergência de contrato (campo renomeado de um lado só)
 *    vira laço de uma tentativa por minuto até alguém consertar. Ruidoso, e
 *    ruidoso é o lado certo de errar num alerta — mas a defesa de verdade
 *    contra isso é o vetor fixo de paridade, que quebra no CI dos dois repos
 *    antes de qualquer deploy.
 *
 * O receptor faz o envio SMTP inline, antes de responder; o chamador reserva
 * um teto próprio e mais largo para isso (`IMOBPRO_ALERT_TIMEOUT_MS`, 25 s).
 * Encurtar um sem o outro produz e-mail duplicado em série, não perdido.
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
