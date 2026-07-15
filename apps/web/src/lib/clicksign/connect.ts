// Conexão da conta ClickSign própria da imobiliária. Fluxo didático de 1 passo:
// o usuário cola o token → validamos → auto-provisionamos o webhook per-org →
// guardamos token + secret criptografados. Se a ClickSign não devolver o secret
// na criação do webhook, caímos no fallback manual (usuário cola o secret).

import { prisma } from "@/lib/db/prisma";
import { encryptSecret } from "@/lib/security/crypto";
import { generatePublicToken } from "@/lib/security/crypto";
import { ClicksignError } from "./client";
import {
  createWebhook,
  deleteWebhook,
  listWebhooks,
  WEBHOOK_EVENTS,
} from "./envelopes";
import { webhookUrlForSlug } from "./account";

const DEFAULT_BASE_URL = "https://app.clicksign.com";

export class ClickSignConnectError extends Error {
  constructor(
    message: string,
    public readonly status: number = 400
  ) {
    super(message);
    this.name = "ClickSignConnectError";
  }
}

export interface ConnectResult {
  ok: true;
  status: string;
  webhookProvisioned: boolean;
  webhookUrl: string;
  needsManualSecret: boolean;
}

/** Extrai o HMAC secret da resposta de criação do webhook (campo varia por versão). */
function extractWebhookSecret(resp: unknown): string | null {
  const attrs =
    (resp as { data?: { attributes?: Record<string, unknown> } }).data
      ?.attributes ?? {};
  const candidate =
    attrs.secret ??
    attrs.hmac_secret ??
    attrs.hmac ??
    attrs.signing_secret ??
    attrs.secret_key;
  return typeof candidate === "string" && candidate.length > 0
    ? candidate
    : null;
}

function extractWebhookId(resp: unknown): string | null {
  return (
    (resp as { data?: { id?: string } }).data?.id ?? null
  );
}

/**
 * Valida o token, provisiona o webhook per-org e persiste a ClickSignAccount.
 * Idempotente por org (upsert): reconectar reusa o mesmo slug (mantém a URL) e
 * troca o token/webhook.
 */
export async function connectClickSignAccount(input: {
  orgId: string;
  userId: string;
  token: string;
  baseUrl?: string;
  label?: string;
}): Promise<ConnectResult> {
  const token = input.token.trim();
  if (!token) throw new ClickSignConnectError("Token vazio.", 400);
  const baseUrl = (input.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, "");
  const creds = { token, baseUrl };

  // 1. Valida o token com uma leitura barata autenticada.
  try {
    await listWebhooks(creds);
  } catch (err) {
    if (err instanceof ClicksignError && (err.status === 401 || err.status === 403)) {
      throw new ClickSignConnectError(
        "Token inválido ou sem permissão. Gere um token de API válido em ClickSign › Configurações › API.",
        400
      );
    }
    const msg = err instanceof Error ? err.message : String(err);
    throw new ClickSignConnectError(
      `Não foi possível validar o token na ClickSign: ${msg}`,
      502
    );
  }

  // Reusa o slug existente (mantém a URL de webhook estável em reconexões).
  const existing = await prisma.clickSignAccount.findUnique({
    where: { orgId: input.orgId },
  });
  const webhookSlug = existing?.webhookSlug ?? generatePublicToken(16);
  const webhookUrl = webhookUrlForSlug(webhookSlug);

  // 2. Auto-provisiona o webhook per-org. Best-effort: se falhar, a conta
  //    conecta mesmo assim e o usuário configura o webhook manualmente.
  let webhookId: string | null = null;
  let webhookSecret: string | null = null;
  let webhookProvisioned = false;
  try {
    const resp = await createWebhook(
      { url: webhookUrl, events: WEBHOOK_EVENTS },
      creds
    );
    webhookId = extractWebhookId(resp);
    webhookSecret = extractWebhookSecret(resp);
    webhookProvisioned = Boolean(webhookId);
    // Se re-provisionamos e havia um webhook antigo diferente, remove o velho.
    if (
      existing?.clicksignWebhookId &&
      webhookId &&
      existing.clicksignWebhookId !== webhookId
    ) {
      await deleteWebhook(existing.clicksignWebhookId, creds).catch(() => {});
    }
  } catch (err) {
    console.error("[clicksign connect] auto-provision de webhook falhou:", err);
    // segue: webhookProvisioned=false → fallback manual na UI
  }

  // 3. Criptografa token + secret e persiste.
  const encToken = encryptSecret(token);
  const encSecret = webhookSecret ? encryptSecret(webhookSecret) : null;

  await prisma.clickSignAccount.upsert({
    where: { orgId: input.orgId },
    create: {
      orgId: input.orgId,
      label: input.label ?? null,
      apiTokenEncrypted: encToken.ciphertext,
      apiTokenIvBase64: encToken.iv,
      apiTokenTagBase64: encToken.tag,
      baseUrl,
      webhookSlug,
      webhookSecretEncrypted: encSecret?.ciphertext ?? null,
      webhookSecretIvBase64: encSecret?.iv ?? null,
      webhookSecretTagBase64: encSecret?.tag ?? null,
      clicksignWebhookId: webhookId,
      webhookProvisioned,
      status: "connected",
      connectedById: input.userId,
      lastValidatedAt: new Date(),
      lastError: null,
    },
    update: {
      label: input.label ?? existing?.label ?? null,
      apiTokenEncrypted: encToken.ciphertext,
      apiTokenIvBase64: encToken.iv,
      apiTokenTagBase64: encToken.tag,
      baseUrl,
      webhookSlug,
      // Só sobrescreve o secret se conseguimos um novo (senão preserva o manual).
      ...(encSecret
        ? {
            webhookSecretEncrypted: encSecret.ciphertext,
            webhookSecretIvBase64: encSecret.iv,
            webhookSecretTagBase64: encSecret.tag,
          }
        : {}),
      clicksignWebhookId: webhookId ?? existing?.clicksignWebhookId ?? null,
      webhookProvisioned:
        webhookProvisioned || existing?.webhookProvisioned || false,
      status: "connected",
      connectedById: input.userId,
      lastValidatedAt: new Date(),
      lastError: null,
    },
  });

  // Precisa de secret manual quando NÃO provisionou o secret automaticamente
  // e ainda não há um secret salvo.
  const hasSecret = Boolean(
    encSecret || existing?.webhookSecretEncrypted
  );

  return {
    ok: true,
    status: "connected",
    webhookProvisioned,
    webhookUrl,
    needsManualSecret: !hasSecret,
  };
}
