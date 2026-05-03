import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import {
  createApiToken,
  listApiTokens,
  type ApiTokenScope,
} from "@/lib/auth/api-token";
import { apiTokenCreateSchema } from "@/lib/validation/schemas";
import { audit, extractAuditContextFromRequest } from "@/lib/security/audit";

/**
 * Tokens de API por usuário.
 *
 * GET /api/me/api-tokens — lista tokens do usuário logado (sem o valor cru).
 * POST /api/me/api-tokens — cria novo token. Retorna `rawToken` UMA VEZ.
 *
 * Auth: session-only (NextAuth cookie). Endpoint da UI; clientes externos
 * não devem usar Bearer aqui — token novo precisa de identidade humana.
 */

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const tokens = await listApiTokens(session.user.id);
  return NextResponse.json({ tokens });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const parsed = apiTokenCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Bad Request", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { name, scopes, expiresInDays } = parsed.data;
  const expiresAt =
    expiresInDays != null
      ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000)
      : null;

  // orgId para audit: pega primeiro membership do usuário.
  const membership = await prisma.orgMembership.findFirst({
    where: { userId: session.user.id },
    select: { orgId: true },
  });
  if (!membership) {
    return NextResponse.json(
      { error: "Forbidden", reason: "user has no active org" },
      { status: 403 }
    );
  }

  const result = await createApiToken({
    userId: session.user.id,
    name,
    scopes: scopes as ApiTokenScope[],
    expiresAt,
  });

  await audit(
    extractAuditContextFromRequest(req, membership.orgId, session.user.id),
    {
      action: "API_TOKEN_CREATED",
      result: "SUCCESS",
      resource: result.token.id,
      resourceType: "UserApiToken",
      metadata: { name, scopes, expiresAt: expiresAt?.toISOString() ?? null },
    }
  );

  return NextResponse.json(
    {
      // ATENÇÃO: rawToken aparece apenas nesta resposta. Não loga, não persiste.
      rawToken: result.rawToken,
      token: result.token,
      warning:
        "Salve o rawToken agora. Não será exibido novamente. Use no header: Authorization: Bearer <rawToken>",
    },
    { status: 201 }
  );
}
