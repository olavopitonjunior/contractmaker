// Resolução de credencial ClickSign por org (multitenant). Cada imobiliária
// conecta a própria conta (ClickSignAccount, token criptografado). Sem conta
// conectada, SÓ a org compartilhada legada (SHARED_ORG_ID) cai no token global
// do .env — qualquer outra org sem conta NÃO envia assinatura.
//
// Espelha o padrão da AsaasAccount (lib/asaas/account.ts): a credencial vive no
// banco criptografada com AES-256-GCM (lib/security/crypto.ts) e é remontada
// aqui pra decrypt. Preferências (tipos/orçamento/padrões) ficam em
// OrgSignatureSettings, independentes da credencial.

import type { ClickSignAccount, OrgSignatureSettings } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { decryptSecret } from "@/lib/security/crypto";

export interface ClickSignCreds {
  token: string;
  baseUrl: string;
  /** "org" = conta própria da imobiliária; "legacy_global" = token global do
   *  .env, permitido só pra org compartilhada legada. */
  source: "org" | "legacy_global";
}

/** Lançado quando a org não tem conta ClickSign conectada e não é a org legada
 *  com fallback global. As rotas de envio mapeiam pra 409 com CTA de conexão. */
export class ClickSignNotConfiguredError extends Error {
  constructor(
    message = "ClickSign não configurado para esta imobiliária. Conecte a conta em Configurações › Assinaturas."
  ) {
    super(message);
    this.name = "ClickSignNotConfiguredError";
  }
}

/** Lançado quando o método de assinatura pedido não está na allow-list da org. */
export class AuthMethodNotAllowedError extends Error {
  constructor(public readonly method: string) {
    super(
      `Método de assinatura "${method}" não está habilitado nas preferências desta imobiliária.`
    );
    this.name = "AuthMethodNotAllowedError";
  }
}

const DEFAULT_BASE_URL = "https://app.clicksign.com";

/** URL pública canônica da plataforma (onde a ClickSign entrega o webhook). */
export function publicBaseUrl(): string {
  return (process.env.NEXTAUTH_URL ?? "https://imobpro.ia.br").replace(
    /\/+$/,
    ""
  );
}

/** URL de webhook per-org montada a partir do slug público da conta. */
export function webhookUrlForSlug(slug: string): string {
  return `${publicBaseUrl()}/api/webhooks/clicksign/${slug}`;
}

function normalizeBaseUrl(url: string | null | undefined): string {
  return (url || DEFAULT_BASE_URL).replace(/\/+$/, "");
}

/** Fallback global (org compartilhada legada). Null se o env não estiver setado. */
function legacyGlobalCreds(orgId: string): ClickSignCreds | null {
  const sharedOrgId = process.env.SHARED_ORG_ID;
  const token = process.env.CLICKSIGN_API_TOKEN;
  if (!sharedOrgId || orgId !== sharedOrgId || !token) return null;
  return {
    token,
    baseUrl: normalizeBaseUrl(process.env.CLICKSIGN_API_BASE_URL),
    source: "legacy_global",
  };
}

/** Credenciais da conta própria da org, ou null se não conectada. */
export async function getOrgClickSignCreds(
  orgId: string
): Promise<ClickSignCreds | null> {
  const account = await prisma.clickSignAccount.findUnique({ where: { orgId } });
  if (!account || account.status === "disconnected") return null;
  const token = decryptSecret({
    ciphertext: account.apiTokenEncrypted,
    iv: account.apiTokenIvBase64,
    tag: account.apiTokenTagBase64,
  });
  return { token, baseUrl: normalizeBaseUrl(account.baseUrl), source: "org" };
}

/**
 * Resolve as credenciais ClickSign efetivas da org:
 *   1. conta própria conectada → creds da org;
 *   2. senão, org legada (SHARED_ORG_ID) + token global no env → fallback global;
 *   3. senão → null (chamador lança ClickSignNotConfiguredError).
 */
export async function resolveClickSignCreds(
  orgId: string
): Promise<ClickSignCreds | null> {
  const own = await getOrgClickSignCreds(orgId);
  if (own) return own;
  return legacyGlobalCreds(orgId);
}

/** Igual a resolveClickSignCreds mas lança quando não configurado. */
export async function requireClickSignCreds(
  orgId: string
): Promise<ClickSignCreds> {
  const creds = await resolveClickSignCreds(orgId);
  if (!creds) throw new ClickSignNotConfiguredError();
  return creds;
}

/** True quando a org consegue enviar assinatura (conta própria OU fallback legado). */
export async function isClickSignConfigured(orgId: string): Promise<boolean> {
  return (await resolveClickSignCreds(orgId)) !== null;
}

/** Decripta o webhook secret da conta (null se ainda não provisionado/colado). */
export function decryptWebhookSecret(account: ClickSignAccount): string | null {
  if (
    !account.webhookSecretEncrypted ||
    !account.webhookSecretIvBase64 ||
    !account.webhookSecretTagBase64
  ) {
    return null;
  }
  return decryptSecret({
    ciphertext: account.webhookSecretEncrypted,
    iv: account.webhookSecretIvBase64,
    tag: account.webhookSecretTagBase64,
  });
}

export const DEFAULT_ALLOWED_AUTH_METHODS = [
  "email",
  "whatsapp",
  "selfie",
  "icp_brasil",
] as const;

/**
 * Preferências de assinatura da org, com lazy-create dos defaults. Vale mesmo
 * pra org legada (que usa o token global): controla tipos de assinatura,
 * orçamento/custo e padrões de envelope.
 */
export async function getSignatureSettings(
  orgId: string
): Promise<OrgSignatureSettings> {
  const existing = await prisma.orgSignatureSettings.findUnique({
    where: { orgId },
  });
  if (existing) return existing;
  // upsert pra evitar corrida (dois envios concorrentes criando a row).
  return prisma.orgSignatureSettings.upsert({
    where: { orgId },
    create: { orgId },
    update: {},
  });
}
