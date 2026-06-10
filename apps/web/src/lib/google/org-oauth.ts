import { google, drive_v3 } from "googleapis";
import { OAuth2Client } from "google-auth-library";
import { prisma } from "@/lib/db/prisma";
import { encryptSecret, decryptSecret } from "@/lib/security/crypto";
import {
  envTrim,
  getOwnerOAuthClient,
  getDriveFolderId,
  isOwnerOAuthConfigured,
} from "./client";

// ============================================================================
// OAuth Google POR ORG (multitenant). Docs de template e contratos passam a
// nascer no Drive da imobiliária (quota/privacidade isoladas); a service
// account global segue recebendo writer em cada doc (batchUpdate/export/
// watch inalterados). Sem conta conectada — ou com token revogado — o fluxo
// cai no owner OAuth global (tenants legados não quebram).
//
// Pré-requisito operacional: consent screen do OAuth client em "In
// production" (em Testing o refresh token expira em 7 dias — memória
// feedback_oauth_testing_7d).
// ============================================================================

export const ORG_GOOGLE_SCOPES = ["https://www.googleapis.com/auth/drive"];

export interface ResolvedOwnerAuth {
  auth: OAuth2Client;
  source: "org" | "global";
  /** E-mail da conta quando source="org" (observabilidade/permissions). */
  accountEmail?: string;
  orgId?: string;
}

// Cache por org — OAuth2Client renova o access token sozinho via refresh
// token. Invalidado em disconnect/revoke.
const orgClientCache = new Map<string, { client: OAuth2Client; email: string }>();

function buildOAuthClient(): OAuth2Client {
  const clientId = envTrim("GOOGLE_OAUTH_CLIENT_ID");
  const clientSecret = envTrim("GOOGLE_OAUTH_CLIENT_SECRET");
  if (!clientId || !clientSecret) {
    throw new Error(
      "GOOGLE_OAUTH_CLIENT_ID/GOOGLE_OAUTH_CLIENT_SECRET não configurados."
    );
  }
  return new google.auth.OAuth2({ clientId, clientSecret });
}

/** OAuth client pro fluxo connect/callback (com redirect URI). */
export function buildOrgConnectClient(redirectUri: string): OAuth2Client {
  const clientId = envTrim("GOOGLE_OAUTH_CLIENT_ID");
  const clientSecret = envTrim("GOOGLE_OAUTH_CLIENT_SECRET");
  if (!clientId || !clientSecret) {
    throw new Error(
      "GOOGLE_OAUTH_CLIENT_ID/GOOGLE_OAUTH_CLIENT_SECRET não configurados."
    );
  }
  return new google.auth.OAuth2({ clientId, clientSecret, redirectUri });
}

/**
 * Resolve a credencial de criação de docs: conta Google da org quando
 * conectada, senão owner OAuth global. Nunca lança por falta de conta da
 * org — fallback é o comportamento legado.
 */
export async function resolveOwnerAuth(orgId?: string): Promise<ResolvedOwnerAuth> {
  if (orgId) {
    const cached = orgClientCache.get(orgId);
    if (cached) {
      return { auth: cached.client, source: "org", accountEmail: cached.email, orgId };
    }
    const account = await prisma.orgGoogleAccount.findUnique({
      where: { orgId },
    });
    if (account && account.status === "connected") {
      try {
        const refreshToken = decryptSecret({
          ciphertext: account.refreshTokenEncrypted,
          iv: account.refreshTokenIvBase64,
          tag: account.refreshTokenTagBase64,
        });
        const client = buildOAuthClient();
        client.setCredentials({ refresh_token: refreshToken });
        orgClientCache.set(orgId, { client, email: account.email });
        // lastUsedAt best-effort (não bloqueia o caminho quente).
        void prisma.orgGoogleAccount
          .update({ where: { orgId }, data: { lastUsedAt: new Date() } })
          .catch(() => {});
        return { auth: client, source: "org", accountEmail: account.email, orgId };
      } catch (err) {
        console.error(
          `[org-oauth] Falha ao montar client da org ${orgId} — fallback global:`,
          err
        );
      }
    }
  }
  return { auth: getOwnerOAuthClient(), source: "global", orgId };
}

export function getOwnerDriveForAuth(resolved: ResolvedOwnerAuth): drive_v3.Drive {
  return google.drive({ version: "v3", auth: resolved.auth });
}

function isInvalidGrant(err: unknown): boolean {
  const msg =
    (err as { message?: string })?.message ??
    (typeof err === "string" ? err : "");
  const resp = (err as { response?: { data?: { error?: string } } })?.response
    ?.data?.error;
  return /invalid_grant/i.test(msg) || resp === "invalid_grant";
}

export async function markOrgGoogleRevoked(
  orgId: string,
  message?: string
): Promise<void> {
  orgClientCache.delete(orgId);
  await prisma.orgGoogleAccount
    .update({
      where: { orgId },
      data: {
        status: "revoked",
        lastErrorMessage: (message ?? "invalid_grant").slice(0, 500),
      },
    })
    .catch(() => {});
}

/**
 * Executa `fn` com a credencial resolvida; em `invalid_grant` na credencial
 * da ORG, marca revoked e re-tenta UMA vez com o owner global (degradação em
 * vez de falha dura). Erros do caminho global propagam.
 */
export async function withOwnerAuth<T>(
  orgId: string | undefined,
  fn: (resolved: ResolvedOwnerAuth) => Promise<T>
): Promise<T> {
  const resolved = await resolveOwnerAuth(orgId);
  try {
    return await fn(resolved);
  } catch (err) {
    if (resolved.source === "org" && isInvalidGrant(err)) {
      console.error(
        `[org-oauth] invalid_grant na org ${orgId} — marcando revoked e re-tentando com owner global.`
      );
      await markOrgGoogleRevoked(orgId!, err instanceof Error ? err.message : String(err));
      if (isOwnerOAuthConfigured()) {
        return fn({ auth: getOwnerOAuthClient(), source: "global", orgId });
      }
    }
    throw err;
  }
}

const ORG_DRIVE_FOLDER_NAME = "Contractmaker — Contratos";

/**
 * Parent folder pra criação de docs: pasta global (env) quando a credencial
 * é a global; pasta lazy "Contractmaker — Contratos" no Drive da org quando a
 * credencial é da org (a pasta global NÃO é acessível pela conta do tenant).
 */
export async function resolveDriveParent(
  resolved: ResolvedOwnerAuth
): Promise<string | undefined> {
  if (resolved.source === "global") return getDriveFolderId();
  const orgId = resolved.orgId;
  if (!orgId) return undefined;

  const account = await prisma.orgGoogleAccount.findUnique({
    where: { orgId },
    select: { driveFolderId: true },
  });
  if (account?.driveFolderId) return account.driveFolderId;

  try {
    const drive = getOwnerDriveForAuth(resolved);
    const created = await drive.files.create({
      requestBody: {
        name: ORG_DRIVE_FOLDER_NAME,
        mimeType: "application/vnd.google-apps.folder",
      },
      fields: "id",
    });
    const folderId = created.data.id ?? undefined;
    if (folderId) {
      await prisma.orgGoogleAccount.update({
        where: { orgId },
        data: { driveFolderId: folderId },
      });
    }
    return folderId;
  } catch (err) {
    console.error(
      `[org-oauth] Falha ao criar pasta no Drive da org ${orgId} (segue sem parent):`,
      err
    );
    return undefined;
  }
}

export async function saveOrgGoogleTokens(input: {
  orgId: string;
  email: string;
  refreshToken: string;
  scopes: string[];
  userId?: string;
}): Promise<void> {
  const enc = encryptSecret(input.refreshToken);
  orgClientCache.delete(input.orgId);
  await prisma.orgGoogleAccount.upsert({
    where: { orgId: input.orgId },
    create: {
      orgId: input.orgId,
      email: input.email,
      refreshTokenEncrypted: enc.ciphertext,
      refreshTokenIvBase64: enc.iv,
      refreshTokenTagBase64: enc.tag,
      scopes: input.scopes,
      status: "connected",
      connectedById: input.userId,
    },
    update: {
      email: input.email,
      refreshTokenEncrypted: enc.ciphertext,
      refreshTokenIvBase64: enc.iv,
      refreshTokenTagBase64: enc.tag,
      scopes: input.scopes,
      status: "connected",
      lastErrorMessage: null,
      connectedById: input.userId,
    },
  });
}

export async function disconnectOrgGoogle(orgId: string): Promise<void> {
  const account = await prisma.orgGoogleAccount.findUnique({ where: { orgId } });
  if (!account) return;
  // Revoke best-effort no Google (o usuário também pode revogar no painel).
  try {
    const refreshToken = decryptSecret({
      ciphertext: account.refreshTokenEncrypted,
      iv: account.refreshTokenIvBase64,
      tag: account.refreshTokenTagBase64,
    });
    const client = buildOAuthClient();
    await client.revokeToken(refreshToken);
  } catch (err) {
    console.error(`[org-oauth] revokeToken falhou (segue com delete):`, err);
  }
  orgClientCache.delete(orgId);
  await prisma.orgGoogleAccount.delete({ where: { orgId } }).catch(() => {});
}

/**
 * Manda um arquivo do Drive pra lixeira, best-effort: tenta a credencial da
 * org (dona dos docs novos) e, em 403/404 ou org desconectada, o owner
 * global (dono dos docs legados). Nunca lança.
 */
export async function trashDriveFile(
  docId: string,
  orgId?: string
): Promise<boolean> {
  const attempts: ResolvedOwnerAuth[] = [];
  const orgResolved = await resolveOwnerAuth(orgId);
  attempts.push(orgResolved);
  if (orgResolved.source === "org" && isOwnerOAuthConfigured()) {
    attempts.push({ auth: getOwnerOAuthClient(), source: "global", orgId });
  }
  for (const resolved of attempts) {
    try {
      const drive = getOwnerDriveForAuth(resolved);
      await drive.files.update({
        fileId: docId,
        requestBody: { trashed: true },
        supportsAllDrives: true,
      });
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(
        `[org-oauth] trash via ${resolved.source} falhou para ${docId}: ${msg.slice(0, 150)}`
      );
    }
  }
  return false;
}

/** Pra testes: limpa o cache de clients. */
export function __resetOrgOAuthCacheForTests(): void {
  orgClientCache.clear();
}
