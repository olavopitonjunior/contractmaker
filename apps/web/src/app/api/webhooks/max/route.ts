import { NextRequest, NextResponse } from "next/server";
import {
  verifyMaxWebhook,
  parseDeliveryOutcome,
  applyDeliveryOutcome,
} from "@/lib/max/delivery-webhook";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/webhooks/max — o Max reporta o desfecho de entrega de uma
 * notificação (delivered | read | unconfirmed | failed), costurado pela
 * `(orgId, dedupeKey)` aos logs de notificação. Ver `lib/max/delivery-webhook.ts`
 * e `docs/max.md`.
 *
 * Auth: HMAC `${timestamp}.${rawBody}` com `MAX_WEBHOOK_SECRET` — secret
 * próprio desta direção (Max → cá), distinto do `MAX_NOTIFY_SECRET`.
 *
 * Sempre 200 após autenticar, inclusive para `dedupeKey` desconhecida: o
 * cliente retenta enquanto não confirma, e um 4xx por linha órfã viraria
 * retentativa eterna do lado de lá (o teto de tentativas dele é a válvula).
 */
export async function POST(req: NextRequest) {
  const secret = process.env.MAX_WEBHOOK_SECRET;
  if (!secret) {
    // 503, não 200: sem env a integração está DESLIGADA — o Max deve seguir
    // retentando até alguém configurar, não concluir que entregou o report.
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }

  // Corpo CRU, byte a byte — a assinatura foi calculada sobre esta string;
  // reserializar o JSON quebraria na primeira diferença de ordem de chave.
  const rawBody = await req.text();

  const isValid = verifyMaxWebhook({
    timestamp: req.headers.get("x-max-timestamp"),
    signature: req.headers.get("x-max-signature"),
    rawBody,
    secret,
  });
  if (!isValid) {
    // Sem detalhe NO CORPO — mas com log: drift de secret entre os dois
    // projetos Vercel produziria 401s indistinguíveis de "o Max nunca chamou"
    // (convenção dos webhooks vizinhos: clicksign loga toda recusa).
    console.warn("[webhook/max] assinatura recusada");
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const outcome = parseDeliveryOutcome(payload);
  if (!outcome) {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  try {
    const applied = await applyDeliveryOutcome(outcome);
    if (applied.dealLogs === 0 && applied.userDeliveries === 0) {
      // Zero linhas cobre DOIS casos que o UPDATE atômico não distingue:
      // canal sem linha de log (§8) e retry idempotente de desfecho já
      // aplicado (rank igual). O log diz os dois — chamar tudo de "sem linha"
      // mascararia órfãos reais atrás do ruído dos retries.
      console.log(
        `[webhook/max] desfecho sem efeito — linha inexistente OU já aplicado ` +
          `(${outcome.orgId}, ${outcome.dedupeKey}, ${outcome.status})`
      );
    }
    return NextResponse.json({ ok: true, applied });
  } catch (err) {
    // 500 deliberado, como o asaas: o cliente do Max trata 5xx como
    // "integração fora" — retenta sem queimar tentativa. Engolir num 200
    // carimbaria reported_at com o desfecho perdido.
    console.error(
      "[webhook/max] falha ao aplicar desfecho:",
      err instanceof Error ? err.message : String(err)
    );
    return NextResponse.json({ error: "apply_failed" }, { status: 500 });
  }
}
