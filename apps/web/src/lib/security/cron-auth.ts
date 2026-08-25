import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";

/**
 * Auth fail-closed para rotas de cron.
 *
 * O padrão antigo `if (cronSecret) { check }` era fail-OPEN: se `CRON_SECRET`
 * não estivesse setado no ambiente, o endpoint ficava público — e vários
 * crons disparam efeitos financeiros (transfer-dispatch = PIX/TED,
 * rent/generate = cobranças). Um deploy sem a env deixava tudo acionável por
 * qualquer um.
 *
 * Aqui:
 *  - sem `CRON_SECRET` no ambiente → 503 (mal configurado, nunca aberto)
 *  - header ausente/errado → 401
 *  - comparação timing-safe
 *
 * Aceita o secret via `Authorization: Bearer <secret>` (Vercel Cron) ou via
 * header `x-cron-secret`.
 *
 * Retorna `null` quando autorizado; a `NextResponse` de erro caso contrário.
 */
export function requireCronAuth(req: Request): NextResponse | null {
  return requireBearerAuth(
    req,
    ["CRON_SECRET"],
    "CRON_SECRET não configurado — cron desabilitado por segurança"
  );
}

/**
 * A mesma coisa, com a lista de envs aberta — a primeira definida vence.
 *
 * Existe para rota que precisa de um secret PRÓPRIO sem perder o fallback: o
 * `/api/admin/ocr-verify` aceita `OPS_VERIFY_SECRET` e cai em `CRON_SECRET`.
 * Sem isso, ele reimplementaria este arquivo inteiro por causa de uma linha — e
 * um fix de parsing de header aqui não chegaria lá, em silêncio.
 */
export function requireBearerAuth(
  req: Request,
  envVars: string[],
  msgNaoConfigurado: string
): NextResponse | null {
  const secret = envVars.map((v) => process.env[v]).find(Boolean);
  if (!secret) {
    return NextResponse.json({ error: msgNaoConfigurado }, { status: 503 });
  }

  const authHeader = req.headers.get("authorization") ?? "";
  const bearer = authHeader.toLowerCase().startsWith("bearer ")
    ? authHeader.slice(7).trim()
    : "";
  const provided = bearer || req.headers.get("x-cron-secret") || "";

  if (!provided || !safeEqual(provided, secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  try {
    return timingSafeEqual(ab, bb);
  } catch {
    return false;
  }
}
