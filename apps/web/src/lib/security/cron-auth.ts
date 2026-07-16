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
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "CRON_SECRET não configurado — cron desabilitado por segurança" },
      { status: 503 }
    );
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
