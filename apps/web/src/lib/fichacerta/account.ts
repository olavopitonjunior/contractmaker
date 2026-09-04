/**
 * Credencial Ficha Certa Digital POR IMOBILIÁRIA (FichaCertaAccount), no molde
 * de lib/clicksign/account.ts: login/senha e os segredos do webhook vivem no
 * banco cifrados (AES-256-GCM, lib/security/crypto.ts) e são remontados aqui.
 *
 * Diferença deliberada em relação à ClickSign: NÃO existe fallback global no
 * .env. Org sem conta conectada não tem análise de crédito — fail-closed. Cada
 * laudo consome crédito pré-pago da conta da imobiliária; um token de
 * plataforma cobraria a org errada.
 */

import type { FichaCertaAccount } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { decryptSecret } from "@/lib/security/crypto";
import { publicBaseUrl } from "@/lib/clicksign/account";

export const FICHACERTA_DEFAULT_BASE_URL = "https://api.fichacertadigital.com.br";
export const FICHACERTA_STAGE_BASE_URL = "https://stage-api.fichacertadigital.com.br";

export interface FichaCertaCreds {
  orgId: string;
  login: string;
  password: string;
  baseUrl: string;
  /** Ids de produto contratados (PF). PJ usa sempre FC EMPRESA (4). */
  products: number[];
  /** Estimativa por laudo (telemetria/orçamento), em centavos. */
  costCents: number;
}

export class FichaCertaNotConfiguredError extends Error {
  constructor(
    message = "Análise de crédito não configurada para esta imobiliária. Conecte a conta Ficha Certa em Configurações › Integrações."
  ) {
    super(message);
    this.name = "FichaCertaNotConfiguredError";
  }
}

export function normalizeBaseUrl(url: string | null | undefined): string {
  return (url || FICHACERTA_DEFAULT_BASE_URL).replace(/\/+$/, "");
}

/** URL pública que recebe o laudo (POST JSON). */
export function webhookUrlForSlug(slug: string): string {
  return `${publicBaseUrl()}/api/webhooks/fichacerta/${slug}`;
}

/** URL pública que a Ficha Certa chama para obter o token antes de cada envio. */
export function tokenUrlForSlug(slug: string): string {
  return `${publicBaseUrl()}/api/webhooks/fichacerta/${slug}/token`;
}

/** "1,9" → [1, 9]; vazio/lixo → [1] (FC REPORT). */
export function parseProducts(raw: string | null | undefined): number[] {
  const out = (raw ?? "")
    .split(",")
    .map((s) => Number.parseInt(s.trim(), 10))
    .filter((n) => Number.isFinite(n) && n > 0);
  return out.length > 0 ? Array.from(new Set(out)) : [1];
}

function decrypt(cipher: string, iv: string, tag: string): string {
  return decryptSecret({ ciphertext: cipher, iv, tag });
}

export function credsFromAccount(account: FichaCertaAccount): FichaCertaCreds {
  return {
    orgId: account.orgId,
    login: account.login,
    password: decrypt(
      account.passwordEncrypted,
      account.passwordIvBase64,
      account.passwordTagBase64
    ),
    baseUrl: normalizeBaseUrl(account.baseUrl),
    products: parseProducts(account.products),
    costCents: account.costCents,
  };
}

/** Credenciais da conta da org, ou null se não conectada/desconectada. */
export async function getOrgFichaCertaCreds(orgId: string): Promise<FichaCertaCreds | null> {
  const account = await prisma.fichaCertaAccount.findUnique({ where: { orgId } });
  if (!account || account.status === "disconnected") return null;
  return credsFromAccount(account);
}

export async function requireFichaCertaCreds(orgId: string): Promise<FichaCertaCreds> {
  const creds = await getOrgFichaCertaCreds(orgId);
  if (!creds) throw new FichaCertaNotConfiguredError();
  return creds;
}

/** True quando a org tem conta conectada (única forma de estar configurada). */
export async function isFichaCertaConfigured(orgId: string): Promise<boolean> {
  return (await getOrgFichaCertaCreds(orgId)) !== null;
}

export function decryptWebhookTokenPassword(account: FichaCertaAccount): string {
  return decrypt(
    account.webhookTokenPasswordEncrypted,
    account.webhookTokenPasswordIvBase64,
    account.webhookTokenPasswordTagBase64
  );
}

export function decryptWebhookQuerySecret(account: FichaCertaAccount): string {
  return decrypt(
    account.webhookQuerySecretEncrypted,
    account.webhookQuerySecretIvBase64,
    account.webhookQuerySecretTagBase64
  );
}
