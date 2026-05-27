import { NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";
import { requireAuth } from "@/lib/auth/context";
import { googleOAuthClient, storeGoogleConnection } from "@/lib/google/connection";
import { audit, extractAuditContextFromRequest } from "@/lib/security/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/integrations/google/callback — troca o code por refresh_token e
 * persiste a GoogleConnection da org (Fase 1b). Revalida que o `state` (orgId)
 * bate com a org da sessão atual (anti-CSRF básico). Cria a pasta raiz no Drive.
 */
export async function GET(req: NextRequest) {
  const authResult = await requireAuth(req);
  if (!authResult.ok) return authResult.response;
  const { ctx } = authResult;

  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const settingsUrl = "/settings/integrations/google";

  if (url.searchParams.get("error")) {
    return NextResponse.redirect(new URL(`${settingsUrl}?error=denied`, req.url));
  }
  if (!code || !state) {
    return NextResponse.redirect(new URL(`${settingsUrl}?error=missing_code`, req.url));
  }
  // O state (orgId) tem que bater com a org da sessão — senão é cross-org.
  if (state !== ctx.orgId) {
    return NextResponse.redirect(new URL(`${settingsUrl}?error=org_mismatch`, req.url));
  }

  const appUrl = process.env.NEXTAUTH_URL ?? url.origin;
  const redirectUri = `${appUrl.replace(/\/$/, "")}/api/integrations/google/callback`;

  try {
    const client = googleOAuthClient(redirectUri);
    const { tokens } = await client.getToken(code);
    if (!tokens.refresh_token) {
      // Sem refresh_token (reconsent sem prompt=consent) — pede pra reconectar.
      return NextResponse.redirect(new URL(`${settingsUrl}?error=no_refresh_token`, req.url));
    }
    client.setCredentials(tokens);

    // Cria a pasta raiz da org no Drive do tenant.
    let driveRootFolderId: string | null = null;
    try {
      const drive = google.drive({ version: "v3", auth: client });
      const folder = await drive.files.create({
        requestBody: {
          name: `Contractmaker — ${ctx.orgName}`,
          mimeType: "application/vnd.google-apps.folder",
        },
        fields: "id",
      });
      driveRootFolderId = folder.data.id ?? null;
    } catch {
      // Pasta é best-effort — a conexão vale mesmo sem ela.
    }

    await storeGoogleConnection({
      orgId: ctx.orgId,
      refreshToken: tokens.refresh_token,
      driveRootFolderId,
      adminUserEmail: ctx.userEmail || null,
    });

    await audit(extractAuditContextFromRequest(req, ctx.orgId, ctx.userId), {
      action: "GOOGLE_CONNECTION_UPDATED",
      result: "SUCCESS",
      resourceType: "GoogleConnection",
      resource: ctx.orgId,
      metadata: { connected: true, driveRootFolderId },
      impersonatedBy: ctx.impersonatedBy ?? undefined,
    });

    return NextResponse.redirect(new URL(`${settingsUrl}?connected=1`, req.url));
  } catch (err) {
    return NextResponse.redirect(
      new URL(
        `${settingsUrl}?error=${encodeURIComponent(err instanceof Error ? err.message : "exchange_failed")}`,
        req.url
      )
    );
  }
}
