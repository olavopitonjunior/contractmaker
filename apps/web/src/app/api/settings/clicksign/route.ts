import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { audit } from "@/lib/security/audit";
import { requireClickSignAdmin } from "@/lib/clicksign/settings-guard";
import {
  connectClickSignAccount,
  ClickSignConnectError,
} from "@/lib/clicksign/connect";
import {
  decryptWebhookSecret,
  isClickSignConfigured,
  resolveClickSignCreds,
  webhookUrlForSlug,
} from "@/lib/clicksign/account";
import { deleteWebhook } from "@/lib/clicksign/envelopes";

export const runtime = "nodejs";

const connectSchema = z.object({
  token: z.string().min(8).max(500),
  baseUrl: z.string().url().optional(),
  label: z.string().max(120).optional(),
});

/** GET — status da conexão ClickSign da org (mascarado). */
export async function GET() {
  const gate = await requireClickSignAdmin();
  if (!gate.ok) return gate.response;
  const { orgId } = gate.ctx;

  const account = await prisma.clickSignAccount.findUnique({
    where: { orgId },
  });
  const configured = await isClickSignConfigured(orgId);

  return NextResponse.json({
    connected: account?.status === "connected",
    // `configured` inclui o fallback global da org legada (envia mesmo sem conta).
    configured,
    usesLegacyGlobal: !account && configured,
    status: account?.status ?? "disconnected",
    label: account?.label ?? null,
    accountName: account?.accountName ?? null,
    baseUrl: account?.baseUrl ?? null,
    webhookUrl: account ? webhookUrlForSlug(account.webhookSlug) : null,
    webhookProvisioned: account?.webhookProvisioned ?? false,
    hasWebhookSecret: account ? Boolean(decryptWebhookSecret(account)) : false,
    lastValidatedAt: account?.lastValidatedAt ?? null,
    lastError: account?.lastError ?? null,
  });
}

/** POST — conecta a conta ClickSign (valida token + provisiona webhook). */
export async function POST(req: NextRequest) {
  const gate = await requireClickSignAdmin();
  if (!gate.ok) return gate.response;
  const { orgId, userId } = gate.ctx;

  const body = await req.json().catch(() => ({}));
  const parsed = connectSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Dados inválidos", issues: parsed.error.flatten() },
      { status: 400 }
    );
  }

  try {
    const result = await connectClickSignAccount({
      orgId,
      userId,
      token: parsed.data.token,
      baseUrl: parsed.data.baseUrl,
      label: parsed.data.label,
    });
    await audit(
      { orgId, userId },
      {
        action: "CLICKSIGN_ACCOUNT_CONNECTED",
        result: "SUCCESS",
        resourceType: "ClickSignAccount",
        metadata: {
          webhookProvisioned: result.webhookProvisioned,
          needsManualSecret: result.needsManualSecret,
        },
      }
    ).catch(() => {});
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof ClickSignConnectError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[clicksign connect] erro:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/** DELETE — desconecta a conta (remove webhook remoto best-effort + apaga row). */
export async function DELETE() {
  const gate = await requireClickSignAdmin();
  if (!gate.ok) return gate.response;
  const { orgId, userId } = gate.ctx;

  const account = await prisma.clickSignAccount.findUnique({
    where: { orgId },
  });
  if (!account) {
    return NextResponse.json({ ok: true, alreadyDisconnected: true });
  }

  if (account.clicksignWebhookId) {
    const creds = await resolveClickSignCreds(orgId);
    if (creds) {
      await deleteWebhook(account.clicksignWebhookId, creds).catch(() => {});
    }
  }

  await prisma.clickSignAccount.delete({ where: { orgId } });
  await audit(
    { orgId, userId },
    {
      action: "CLICKSIGN_ACCOUNT_DISCONNECTED",
      result: "SUCCESS",
      resourceType: "ClickSignAccount",
    }
  ).catch(() => {});

  return NextResponse.json({ ok: true });
}
