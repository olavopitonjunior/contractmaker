import { NextRequest, NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { prisma } from "@/lib/db/prisma";
import { audit } from "@/lib/security/audit";
import { sha256Hex } from "@/lib/security/crypto";
import { RateLimits } from "@/lib/security/ratelimit";
import { decryptWebhookQuerySecret } from "@/lib/fichacerta/account";
import { verifyWebhookRequest } from "@/lib/fichacerta/webhook-auth";
import { reconcileCreditRequest } from "@/lib/credit/fichacerta-runner";
import type { ReportResponse } from "@/lib/fichacerta/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function clientIp(req: NextRequest): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "anon";
}

/**
 * POST /api/webhooks/fichacerta/[slug] — entrega do laudo (1 pretendente).
 *
 * Público, sem sessão; o gate é a conta pelo slug + (`Bearer` emitido por
 * `/token` OU `?k=` da conta). Sem assinatura de payload do lado deles, então
 * o payload NUNCA é aplicado às cegas: o que vale é a reconciliação por
 * `GET report` disparada em seguida (idempotente por `updateKey`). Sempre 200
 * depois de autenticar — solicitação desconhecida inclusive — para não virar
 * reentrega eterna. Toda entrega é auditada (`CREDIT_WEBHOOK_RECEIVED` /
 * `_REJECTED`) com hash do corpo.
 */
export async function POST(req: NextRequest, { params }: { params: { slug: string } }) {
  const rl = await RateLimits.fichaCertaWebhookPerSlug(params.slug);
  if (!rl.success) return NextResponse.json({ error: "rate_limited" }, { status: 429 });

  const account = await prisma.fichaCertaAccount.findUnique({ where: { webhookSlug: params.slug } });
  if (!account) return NextResponse.json({ error: "unknown" }, { status: 404 });

  const via = verifyWebhookRequest(req, params.slug, decryptWebhookQuerySecret(account));
  const rawBody = await req.text();
  const bodyHash = sha256Hex(rawBody);
  if (!via) {
    console.warn(`[webhook/fichacerta] entrega recusada (slug ${params.slug})`);
    await audit(
      { orgId: account.orgId, userId: null, ipAddress: clientIp(req), userAgent: req.headers.get("user-agent") },
      { action: "CREDIT_WEBHOOK_REJECTED", result: "DENIED", resource: account.id, resourceType: "FichaCertaAccount", metadata: { bodyHash, bodyLength: rawBody.length } }
    ).catch(() => {});
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let payload: ReportResponse | null = null;
  try {
    const parsed: unknown = JSON.parse(rawBody);
    if (parsed && typeof parsed === "object") payload = parsed as ReportResponse;
  } catch {
    payload = null;
  }
  const sidRaw = payload?.solicitacao?.id;
  const sid = typeof sidRaw === "number" || typeof sidRaw === "string" ? String(sidRaw) : null;
  const request = sid
    ? await prisma.creditAnalysisRequest.findFirst({
        where: { orgId: account.orgId, provider: "fichacerta", externalId: sid },
        select: { id: true, status: true },
      })
    : null;

  await audit(
    { orgId: account.orgId, userId: null, ipAddress: clientIp(req), userAgent: req.headers.get("user-agent") },
    {
      action: "CREDIT_WEBHOOK_RECEIVED",
      result: "SUCCESS",
      resource: request?.id ?? account.id,
      resourceType: request ? "CreditAnalysisRequest" : "FichaCertaAccount",
      metadata: {
        via,
        bodyHash,
        bodyLength: rawBody.length,
        solicitacaoId: sid,
        known: !!request,
        malformed: payload === null,
        pretendentes: payload?.pretendentes?.length ?? 0,
      },
    }
  ).catch(() => {});

  if (!payload) return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  if (!request) return NextResponse.json({ ok: true, known: false });

  waitUntil(
    reconcileCreditRequest(request.id, { source: "webhook", payload }).catch((err) => {
      console.error("[webhook/fichacerta] reconcile failed", err);
    })
  );
  return NextResponse.json({ ok: true, known: true });
}
