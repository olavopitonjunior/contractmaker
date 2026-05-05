import { NextRequest, NextResponse } from "next/server";
import { recordApiUsage } from "@/lib/api/usage";
import { authOrBearer } from "@/lib/auth/auth-or-bearer";
import { prisma } from "@/lib/db/prisma";

/**
 * Wrapper de telemetry para route handlers Newton-aware. Captura
 * status/latency/errorCode e grava em `ApiUsage` async (fire-and-forget).
 *
 * Uso:
 *   export const GET = withApi("GET /api/me/metrics", async (req) => { ... });
 *
 * Não substitui auth/scope — handler ainda chama `requireAuth`/`requireApiAuth`
 * internamente. O wrapper só observa.
 *
 * Roteia path normalizado (`/api/deals/:id`) pro routeKey passado, evitando
 * cardinalidade alta de IDs reais.
 */

type Handler<Args extends unknown[]> = (
  req: NextRequest,
  ...args: Args
) => Promise<NextResponse>;

export function withApi<Args extends unknown[]>(
  routeKey: string,
  handler: Handler<Args>
): Handler<Args> {
  return async (req, ...args) => {
    const start = Date.now();
    let response: NextResponse;
    let errorCode: string | null = null;
    try {
      response = await handler(req, ...args);
    } catch (err) {
      // Log telemetry com status 500 antes de re-throw
      void recordTelemetry(req, routeKey, 500, Date.now() - start, "exception");
      throw err;
    }

    // Mapeia errorCode comum a partir do status
    if (response.status === 401) errorCode = "unauthorized";
    else if (response.status === 403) errorCode = "forbidden";
    else if (response.status === 404) errorCode = "not_found";
    else if (response.status === 412) errorCode = "etag_mismatch";
    else if (response.status === 429) errorCode = "rate_limited";
    else if (response.status >= 500) errorCode = "server_error";
    else if (response.status >= 400) errorCode = "client_error";

    void recordTelemetry(
      req,
      routeKey,
      response.status,
      Date.now() - start,
      errorCode
    );
    return response;
  };
}

async function recordTelemetry(
  req: NextRequest,
  routeKey: string,
  statusCode: number,
  latencyMs: number,
  errorCode: string | null
): Promise<void> {
  try {
    // Resolve identidade — se não for autenticada, pula telemetry (não é
    // uso de "API"; é provavelmente request anônima).
    const ident = await authOrBearer(req);
    if (!ident) return;

    // Encontra orgId — busca primeiro membership ativo
    const membership = await prisma.orgMembership.findFirst({
      where: { userId: ident.userId },
      select: { orgId: true },
    });
    if (!membership) return;

    const [method] = routeKey.split(" ");
    const path = routeKey.split(" ").slice(1).join(" ") || routeKey;

    await recordApiUsage({
      orgId: membership.orgId,
      userId: ident.userId,
      tokenId: ident.via === "bearer" ? ident.tokenId : null,
      via: ident.via,
      method,
      path,
      statusCode,
      latencyMs,
      errorCode,
    });
  } catch (err) {
    console.error(
      "[with-api] telemetry falhou:",
      err instanceof Error ? err.message : err
    );
  }
}
