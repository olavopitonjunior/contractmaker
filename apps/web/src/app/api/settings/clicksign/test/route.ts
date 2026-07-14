import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { requireClickSignAdmin } from "@/lib/clicksign/settings-guard";
import {
  decryptWebhookSecret,
  resolveClickSignCreds,
  webhookUrlForSlug,
} from "@/lib/clicksign/account";
import { listWebhooks } from "@/lib/clicksign/envelopes";
import { ClicksignError } from "@/lib/clicksign/client";

export const runtime = "nodejs";

/** POST — revalida token + confere se o webhook per-org está registrado. */
export async function POST() {
  const gate = await requireClickSignAdmin();
  if (!gate.ok) return gate.response;
  const { orgId } = gate.ctx;

  const creds = await resolveClickSignCreds(orgId);
  if (!creds) {
    return NextResponse.json(
      { ok: false, error: "Conta ClickSign não configurada." },
      { status: 400 }
    );
  }
  const account = await prisma.clickSignAccount.findUnique({ where: { orgId } });
  const expectedUrl = account ? webhookUrlForSlug(account.webhookSlug) : null;

  try {
    const resp = await listWebhooks(creds);
    const data = (resp as { data?: unknown }).data;
    const urls = Array.isArray(data)
      ? (data as Array<{ attributes?: { url?: string; active?: boolean } }>)
          .map((w) => w.attributes)
          .filter(Boolean)
      : [];
    const webhookRegistered = expectedUrl
      ? urls.some((a) => a?.url === expectedUrl && a?.active !== false)
      : urls.length > 0;

    // token válido → atualiza carimbo.
    if (account) {
      await prisma.clickSignAccount.update({
        where: { orgId },
        data: { lastValidatedAt: new Date(), lastError: null },
      });
    }

    return NextResponse.json({
      ok: true,
      tokenValid: true,
      webhookRegistered,
      hasWebhookSecret: account ? Boolean(decryptWebhookSecret(account)) : false,
      expectedUrl,
      webhookCount: urls.length,
    });
  } catch (err) {
    const msg =
      err instanceof ClicksignError ? err.message : String(err);
    if (account) {
      await prisma.clickSignAccount.update({
        where: { orgId },
        data: { status: "error", lastError: msg.slice(0, 500) },
      });
    }
    return NextResponse.json(
      { ok: false, tokenValid: false, error: `Clicksign: ${msg}` },
      { status: 502 }
    );
  }
}
