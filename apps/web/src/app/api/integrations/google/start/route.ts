import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/context";
import {
  googleOAuthClient,
  GOOGLE_OAUTH_SCOPES,
} from "@/lib/google/connection";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/integrations/google/start — inicia o OAuth 3-legged pra conectar o
 * Google da org (Fase 1b). Redireciona pro consent. `state` = orgId (revalidado
 * no callback contra a sessão). Requer GOOGLE_OAUTH_CLIENT_ID/SECRET + NEXTAUTH_URL.
 */
export async function GET(req: NextRequest) {
  const authResult = await requireAuth(req);
  if (!authResult.ok) return authResult.response;
  const { ctx } = authResult;

  const appUrl = process.env.NEXTAUTH_URL ?? new URL(req.url).origin;
  const redirectUri = `${appUrl.replace(/\/$/, "")}/api/integrations/google/callback`;

  let url: string;
  try {
    const client = googleOAuthClient(redirectUri);
    url = client.generateAuthUrl({
      access_type: "offline",
      prompt: "consent", // força refresh_token mesmo em reconsent
      scope: GOOGLE_OAUTH_SCOPES,
      state: ctx.orgId,
      include_granted_scopes: true,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "OAuth não configurado" },
      { status: 500 }
    );
  }

  return NextResponse.redirect(url);
}
