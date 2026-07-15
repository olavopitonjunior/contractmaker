import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { encryptSecret } from "@/lib/security/crypto";
import { audit } from "@/lib/security/audit";
import { requireClickSignAdmin } from "@/lib/clicksign/settings-guard";
import {
  resolveClickSignCreds,
  webhookUrlForSlug,
} from "@/lib/clicksign/account";
import {
  createWebhook,
  deleteWebhook,
  WEBHOOK_EVENTS,
} from "@/lib/clicksign/envelopes";
import { ClicksignError } from "@/lib/clicksign/client";

export const runtime = "nodejs";

/** Extrai o HMAC secret da resposta de criação do webhook (campo varia). */
function extractWebhookSecret(resp: unknown): string | null {
  const attrs =
    (resp as { data?: { attributes?: Record<string, unknown> } }).data
      ?.attributes ?? {};
  const c =
    attrs.secret ??
    attrs.hmac_secret ??
    attrs.hmac ??
    attrs.signing_secret ??
    attrs.secret_key;
  return typeof c === "string" && c.length > 0 ? c : null;
}

/**
 * POST — (re)provisiona o webhook per-org usando o TOKEN JÁ SALVO (sem re-colar).
 * Cobre o caso de o auto-provisionamento ter falhado na conexão, ou de o webhook
 * ter sido removido na ClickSign.
 */
export async function POST() {
  const gate = await requireClickSignAdmin();
  if (!gate.ok) return gate.response;
  const { orgId, userId } = gate.ctx;

  const account = await prisma.clickSignAccount.findUnique({ where: { orgId } });
  if (!account) {
    return NextResponse.json(
      { error: "Conecte a conta ClickSign antes de provisionar o webhook." },
      { status: 400 }
    );
  }
  const creds = await resolveClickSignCreds(orgId);
  if (!creds) {
    return NextResponse.json(
      { error: "Credenciais ClickSign indisponíveis." },
      { status: 400 }
    );
  }

  const webhookUrl = webhookUrlForSlug(account.webhookSlug);
  try {
    const resp = await createWebhook(
      { url: webhookUrl, events: WEBHOOK_EVENTS },
      creds
    );
    const webhookId =
      (resp as { data?: { id?: string } }).data?.id ?? null;
    const secret = extractWebhookSecret(resp);
    if (!webhookId) {
      return NextResponse.json(
        { error: "ClickSign não retornou id do webhook." },
        { status: 502 }
      );
    }
    // Remove o webhook antigo se havia um diferente.
    if (account.clicksignWebhookId && account.clicksignWebhookId !== webhookId) {
      await deleteWebhook(account.clicksignWebhookId, creds).catch(() => {});
    }
    const enc = secret ? encryptSecret(secret) : null;
    await prisma.clickSignAccount.update({
      where: { orgId },
      data: {
        clicksignWebhookId: webhookId,
        webhookProvisioned: true,
        status: "connected",
        lastError: null,
        ...(enc
          ? {
              webhookSecretEncrypted: enc.ciphertext,
              webhookSecretIvBase64: enc.iv,
              webhookSecretTagBase64: enc.tag,
            }
          : {}),
      },
    });
    await audit(
      { orgId, userId },
      {
        action: "CLICKSIGN_SETTINGS_UPDATED",
        result: "SUCCESS",
        resourceType: "ClickSignAccount",
        metadata: { action: "provision_webhook", capturedSecret: Boolean(enc) },
      }
    ).catch(() => {});

    return NextResponse.json({
      ok: true,
      webhookProvisioned: true,
      webhookUrl,
      needsManualSecret: !secret && !account.webhookSecretEncrypted,
    });
  } catch (err) {
    const msg = err instanceof ClicksignError ? err.message : String(err);
    await prisma.clickSignAccount.update({
      where: { orgId },
      data: { lastError: msg.slice(0, 500) },
    }).catch(() => {});
    return NextResponse.json(
      { ok: false, error: `Clicksign: ${msg}` },
      { status: 502 }
    );
  }
}
