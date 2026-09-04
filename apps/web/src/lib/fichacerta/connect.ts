/**
 * Conexão da conta Ficha Certa Digital da imobiliária — molde de
 * lib/clicksign/connect.ts, em 1 passo: o owner/admin cola login + senha →
 * validamos com `GET /credits` → provisionamos o webhook da conta apontando
 * para o nosso endpoint por slug → guardamos tudo cifrado.
 *
 * Webhook: a Ficha Certa aceita UM por conta (upsert) e não assina o payload.
 * Autenticação é a deles: ANTES de cada entrega eles chamam `token_url` com
 * `{username, password}` e mandam o retorno como `Authorization: Bearer`.
 * Geramos um par `token_user`/`token_password` por conta (cifrado) e, como
 * cinto e suspensório, um segredo `?k=` na URL do endpoint. Reconectar reusa
 * slug e segredos (a configuração lá fora continua válida); trocar de senha
 * só troca a senha.
 */

import { prisma } from "@/lib/db/prisma";
import { encryptSecret, generatePublicToken, generateSecureToken } from "@/lib/security/crypto";
import {
  FICHACERTA_DEFAULT_BASE_URL,
  credsFromAccount,
  decryptWebhookQuerySecret,
  decryptWebhookTokenPassword,
  normalizeBaseUrl,
  parseProducts,
  tokenUrlForSlug,
  webhookUrlForSlug,
  type FichaCertaCreds,
} from "./account";
import { deleteWebhook, getCredits, registerWebhook } from "./client";
import { FichaCertaError } from "./types";

export class FichaCertaConnectError extends Error {
  constructor(
    message: string,
    public readonly status: number = 400
  ) {
    super(message);
    this.name = "FichaCertaConnectError";
  }
}

export interface ConnectResult {
  ok: true;
  status: "connected";
  credits: number;
  webhookProvisioned: boolean;
  webhookUrl: string;
  tokenUrl: string;
  products: number[];
}

export async function connectFichaCertaAccount(input: {
  orgId: string;
  userId: string;
  login: string;
  password: string;
  baseUrl?: string;
  label?: string;
  /** "1,9" — ids de produto contratados (PF). */
  products?: string;
  costCents?: number;
}): Promise<ConnectResult> {
  const login = input.login.trim();
  const password = input.password;
  if (!login || !password) throw new FichaCertaConnectError("Informe login e senha.", 400);
  const baseUrl = normalizeBaseUrl(input.baseUrl || FICHACERTA_DEFAULT_BASE_URL);
  const products = parseProducts(input.products ?? "1,9");

  const creds: FichaCertaCreds = {
    orgId: input.orgId,
    login,
    password,
    baseUrl,
    products,
    costCents: input.costCents ?? 1500,
  };

  // 1. Valida a credencial com a leitura mais barata autenticada.
  let credits: number;
  try {
    credits = await getCredits(creds);
  } catch (err) {
    if (err instanceof FichaCertaError && (err.status === 401 || err.status === 403)) {
      throw new FichaCertaConnectError(
        "Login ou senha recusados pela Ficha Certa. Confira as credenciais de API (homologação × produção).",
        400
      );
    }
    const msg = err instanceof Error ? err.message : String(err);
    throw new FichaCertaConnectError(`Não foi possível validar a credencial na Ficha Certa: ${msg}`, 502);
  }

  // 2. Slug e segredos: reusa em reconexão (mantém a URL/config do webhook).
  const existing = await prisma.fichaCertaAccount.findUnique({ where: { orgId: input.orgId } });
  const webhookSlug = existing?.webhookSlug ?? generatePublicToken(16);
  const webhookTokenUser = existing?.webhookTokenUser ?? `fc_${webhookSlug}`;
  const webhookTokenPassword = existing ? decryptWebhookTokenPassword(existing) : generateSecureToken(24);
  const webhookQuerySecret = existing ? decryptWebhookQuerySecret(existing) : generateSecureToken(24);
  const webhookUrl = webhookUrlForSlug(webhookSlug);
  const tokenUrl = tokenUrlForSlug(webhookSlug);

  // 3. Provisiona o webhook (best-effort — a conta conecta mesmo assim e o
  //    card mostra "webhook pendente" com o botão de reprovisionar).
  let webhookId: string | null = existing?.fichaCertaWebhookId ?? null;
  let webhookProvisioned = false;
  try {
    const r = await registerWebhook(creds, {
      endpoint: `${webhookUrl}?k=${encodeURIComponent(webhookQuerySecret)}`,
      token_url: tokenUrl,
      token_user: webhookTokenUser,
      token_password: webhookTokenPassword,
    });
    if (r && typeof r.id !== "undefined") webhookId = String(r.id);
    webhookProvisioned = true;
  } catch (err) {
    console.error("[fichacerta connect] provisionamento do webhook falhou:", err);
  }

  // 4. Cifra e persiste.
  const encPassword = encryptSecret(password);
  const encTokenPassword = encryptSecret(webhookTokenPassword);
  const encQuerySecret = encryptSecret(webhookQuerySecret);
  const common = {
    label: input.label ?? existing?.label ?? null,
    login,
    passwordEncrypted: encPassword.ciphertext,
    passwordIvBase64: encPassword.iv,
    passwordTagBase64: encPassword.tag,
    baseUrl,
    webhookSlug,
    webhookTokenUser,
    webhookTokenPasswordEncrypted: encTokenPassword.ciphertext,
    webhookTokenPasswordIvBase64: encTokenPassword.iv,
    webhookTokenPasswordTagBase64: encTokenPassword.tag,
    webhookQuerySecretEncrypted: encQuerySecret.ciphertext,
    webhookQuerySecretIvBase64: encQuerySecret.iv,
    webhookQuerySecretTagBase64: encQuerySecret.tag,
    fichaCertaWebhookId: webhookId,
    webhookProvisioned: webhookProvisioned || existing?.webhookProvisioned || false,
    products: products.join(","),
    costCents: input.costCents ?? existing?.costCents ?? 1500,
    status: "connected",
    connectedById: input.userId,
    lastValidatedAt: new Date(),
    lastError: null,
  };
  await prisma.fichaCertaAccount.upsert({
    where: { orgId: input.orgId },
    create: { orgId: input.orgId, ...common },
    update: common,
  });

  return {
    ok: true,
    status: "connected",
    credits,
    webhookProvisioned,
    webhookUrl,
    tokenUrl,
    products,
  };
}

/** Desconecta: remove o webhook remoto (best-effort) e apaga a conta. */
export async function disconnectFichaCertaAccount(orgId: string): Promise<{ ok: true; alreadyDisconnected?: boolean }> {
  const account = await prisma.fichaCertaAccount.findUnique({ where: { orgId } });
  if (!account) return { ok: true, alreadyDisconnected: true };
  if (account.fichaCertaWebhookId) {
    try {
      await deleteWebhook(credsFromAccount(account), account.fichaCertaWebhookId);
    } catch (err) {
      console.error("[fichacerta disconnect] remoção do webhook falhou (segue):", err);
    }
  }
  await prisma.fichaCertaAccount.delete({ where: { orgId } });
  return { ok: true };
}
