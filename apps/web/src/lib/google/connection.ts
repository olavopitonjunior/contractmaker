import { google, drive_v3, docs_v1 } from "googleapis";
import { prisma } from "@/lib/db/prisma";
import { encryptSecret, decryptSecret } from "@/lib/security/crypto";
import { getDriveClient, getDocsClient, envTrim } from "@/lib/google/client";

/**
 * Google per-org (Fase 1b, ADITIVO). Quando a org tem GoogleConnection ACTIVE,
 * usa o OAuth do tenant; senão cai no Service Account global (legado) — os
 * call-sites existentes continuam intactos chamando getDriveClient()/getDocsClient().
 * Refresh token guardado em 3 colunas AES-256-GCM (lib/security/crypto).
 */

export const GOOGLE_OAUTH_SCOPES = [
  "https://www.googleapis.com/auth/documents",
  "https://www.googleapis.com/auth/drive.file",
];

export function googleOAuthClient(redirectUri?: string) {
  const clientId = envTrim("GOOGLE_OAUTH_CLIENT_ID");
  const clientSecret = envTrim("GOOGLE_OAUTH_CLIENT_SECRET");
  if (!clientId || !clientSecret) {
    throw new Error("GOOGLE_OAUTH_CLIENT_ID/SECRET não configurados");
  }
  return new google.auth.OAuth2({ clientId, clientSecret, redirectUri });
}

export async function getGoogleConnectionForOrg(orgId: string) {
  return prisma.googleConnection.findUnique({ where: { orgId } });
}

async function orgOAuthOrNull(orgId: string) {
  const conn = await prisma.googleConnection.findUnique({ where: { orgId } });
  if (
    !conn ||
    conn.status !== "ACTIVE" ||
    !conn.refreshTokenCiphertext ||
    !conn.refreshTokenIv ||
    !conn.refreshTokenTag
  ) {
    return null;
  }
  const refreshToken = decryptSecret({
    ciphertext: conn.refreshTokenCiphertext,
    iv: conn.refreshTokenIv,
    tag: conn.refreshTokenTag,
  });
  const client = googleOAuthClient();
  client.setCredentials({ refresh_token: refreshToken });
  return client;
}

/** Drive client da org (OAuth do tenant se conectado, senão SA global). */
export async function getDriveClientForOrg(orgId: string): Promise<drive_v3.Drive> {
  const auth = await orgOAuthOrNull(orgId);
  return auth ? google.drive({ version: "v3", auth }) : getDriveClient();
}

/** Docs client da org (OAuth do tenant se conectado, senão SA global). */
export async function getDocsClientForOrg(orgId: string): Promise<docs_v1.Docs> {
  const auth = await orgOAuthOrNull(orgId);
  return auth ? google.docs({ version: "v1", auth }) : getDocsClient();
}

export async function storeGoogleConnection(params: {
  orgId: string;
  refreshToken: string;
  driveRootFolderId?: string | null;
  adminUserEmail?: string | null;
  scopes?: string[];
}) {
  const enc = encryptSecret(params.refreshToken);
  const data = {
    refreshTokenCiphertext: enc.ciphertext,
    refreshTokenIv: enc.iv,
    refreshTokenTag: enc.tag,
    driveRootFolderId: params.driveRootFolderId ?? undefined,
    adminUserEmail: params.adminUserEmail ?? undefined,
    scopes: params.scopes ?? GOOGLE_OAUTH_SCOPES,
    status: "ACTIVE" as const,
    lastRefreshAt: new Date(),
  };
  return prisma.googleConnection.upsert({
    where: { orgId: params.orgId },
    update: data,
    create: { orgId: params.orgId, connectionType: "personal_oauth", ...data },
  });
}
