import { NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";
import {
  buildOrgConnectClient,
  saveOrgGoogleTokens,
  ORG_GOOGLE_SCOPES,
} from "@/lib/google/org-oauth";
import { verifyOAuthState } from "@/lib/google/oauth-state";

// Callback do OAuth de conexão. O `state` HMAC carrega orgId+userId — não
// dependemos de sessão aqui (o Google redireciona o browser), mas só
// aceitamos states emitidos por nós e dentro da validade.
export async function GET(req: NextRequest) {
  const base = (process.env.NEXTAUTH_URL ?? req.nextUrl.origin).replace(/\/$/, "");
  const settingsUrl = `${base}/settings/integracoes`;

  const errorParam = req.nextUrl.searchParams.get("error");
  if (errorParam) {
    return NextResponse.redirect(`${settingsUrl}?google_error=${encodeURIComponent(errorParam)}`);
  }

  const code = req.nextUrl.searchParams.get("code");
  const stateRaw = req.nextUrl.searchParams.get("state");
  if (!code || !stateRaw) {
    return NextResponse.redirect(`${settingsUrl}?google_error=missing_code`);
  }

  const state = verifyOAuthState(stateRaw);
  if (!state) {
    return NextResponse.redirect(`${settingsUrl}?google_error=invalid_state`);
  }

  try {
    const redirectUri = `${base}/api/settings/google/callback`;
    const client = buildOrgConnectClient(redirectUri);
    const { tokens } = await client.getToken(code);

    if (!tokens.refresh_token) {
      // Conta já consentida sem prompt=consent (não deveria acontecer) ou
      // consent parcial — sem refresh token a integração não sobrevive.
      return NextResponse.redirect(`${settingsUrl}?google_error=no_refresh_token`);
    }

    client.setCredentials(tokens);
    const oauth2 = google.oauth2({ version: "v2", auth: client });
    const userinfo = await oauth2.userinfo.get();
    const email = userinfo.data.email;
    if (!email) {
      return NextResponse.redirect(`${settingsUrl}?google_error=no_email`);
    }

    await saveOrgGoogleTokens({
      orgId: state.orgId,
      email,
      refreshToken: tokens.refresh_token,
      scopes: ORG_GOOGLE_SCOPES,
      userId: state.userId,
    });

    return NextResponse.redirect(`${settingsUrl}?google_connected=1`);
  } catch (err) {
    console.error("[google/callback] Falha na troca de tokens:", err);
    return NextResponse.redirect(`${settingsUrl}?google_error=token_exchange`);
  }
}
