import { google, docs_v1, drive_v3 } from "googleapis";
import { JWT, OAuth2Client } from "google-auth-library";

const SCOPES = [
  "https://www.googleapis.com/auth/documents",
  "https://www.googleapis.com/auth/drive",
];

let cachedAuth: JWT | null = null;
let cachedOwnerAuth: OAuth2Client | null = null;

function loadServiceAccountCredentials() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) {
    throw new Error(
      "GOOGLE_SERVICE_ACCOUNT_JSON não configurado. Configure a credencial JSON da service account."
    );
  }
  try {
    return JSON.parse(raw) as { client_email: string; private_key: string };
  } catch {
    throw new Error(
      "GOOGLE_SERVICE_ACCOUNT_JSON inválido — esperado JSON de service account com client_email e private_key."
    );
  }
}

export function getGoogleAuth(): JWT {
  if (cachedAuth) return cachedAuth;
  const creds = loadServiceAccountCredentials();
  const subject = process.env.GOOGLE_IMPERSONATE_EMAIL || undefined;
  cachedAuth = new google.auth.JWT({
    email: creds.client_email,
    key: creds.private_key,
    scopes: SCOPES,
    subject,
  });
  return cachedAuth;
}

export function getDocsClient(): docs_v1.Docs {
  return google.docs({ version: "v1", auth: getGoogleAuth() });
}

export function getDriveClient(): drive_v3.Drive {
  return google.drive({ version: "v3", auth: getGoogleAuth() });
}

export function isGoogleDocsConfigured(): boolean {
  return Boolean(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
}

export function getDriveFolderId(): string | undefined {
  return process.env.GOOGLE_DRIVE_FOLDER_ID || undefined;
}

export function isGoogleDocsFeatureEnabled(): boolean {
  return process.env.USE_GOOGLE_DOCS_EDITOR === "true" && isGoogleDocsConfigured();
}

/**
 * Owner OAuth: usado para CRIAR docs (sem Workspace, service accounts não
 * têm storage no Drive — o doc precisa ser criado por um usuário humano).
 * O refresh token é obtido uma vez via `scripts/oauth-bootstrap.ts` e
 * persistido em env. A SA continua sendo usada para todas as operações
 * subsequentes (batchUpdate, get, comments, export) com Editor permission.
 */
export function getOwnerOAuthClient(): OAuth2Client {
  if (cachedOwnerAuth) return cachedOwnerAuth;
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_OWNER_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error(
      "Owner OAuth não configurado. Setar GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET e GOOGLE_OWNER_REFRESH_TOKEN."
    );
  }
  cachedOwnerAuth = new google.auth.OAuth2({
    clientId,
    clientSecret,
  });
  cachedOwnerAuth.setCredentials({ refresh_token: refreshToken });
  return cachedOwnerAuth;
}

export function getOwnerDriveClient(): drive_v3.Drive {
  return google.drive({ version: "v3", auth: getOwnerOAuthClient() });
}

export function getServiceAccountEmail(): string | null {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed.client_email || null;
  } catch {
    return null;
  }
}

export function isOwnerOAuthConfigured(): boolean {
  return Boolean(
    process.env.GOOGLE_OAUTH_CLIENT_ID &&
      process.env.GOOGLE_OAUTH_CLIENT_SECRET &&
      process.env.GOOGLE_OWNER_REFRESH_TOKEN
  );
}
