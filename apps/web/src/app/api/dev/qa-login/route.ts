import { NextRequest, NextResponse } from "next/server";
import { encode } from "next-auth/jwt";
import { prisma } from "@/lib/db/prisma";
import { STAGING_MODE } from "@/lib/env/staging";

/**
 * Auto-login de QA — EXCLUSIVO DE STAGING.
 *
 * O agente de QA (browser automation) não digita senha nem consome magic link:
 * visita GET /api/dev/qa-login e recebe uma sessão pronta do usuário QA
 * pré-cadastrado, redirecionado pra /pipeline. É a credencial "sempre logada"
 * do ambiente de teste.
 *
 * Segurança:
 *  - **404 fora de staging** (`STAGING_MODE !== true`) — a rota simplesmente não
 *    existe em produção, então não há superfície de auto-login em prod.
 *  - Só loga o e-mail fixo de QA (default `qa.kanban@imobpro.ia.br`, overridável
 *    por `QA_AUTOLOGIN_EMAIL`), que só existe no banco de staging.
 *  - Staging fica atrás da Vercel Deployment Protection (SSO), então nem a rota
 *    é alcançável sem a conta do dono.
 *
 * Cunha o próprio cookie de sessão do NextAuth (JWT strategy) com `AUTH_SECRET`
 * — lido no runtime do servidor, nunca sai daqui. O payload espelha o que o
 * callback `jwt` monta em auth.ts (`id`/`sub`), pra `session()` resolver igual.
 */
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  if (!STAGING_MODE) {
    return new NextResponse("Not found", { status: 404 });
  }

  const email = process.env.QA_AUTOLOGIN_EMAIL ?? "qa.kanban@imobpro.ia.br";
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "AUTH_SECRET ausente" }, { status: 500 });
  }

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true, name: true, deletedAt: true },
  });
  if (!user || user.deletedAt) {
    return NextResponse.json(
      { error: `Usuário de QA "${email}" não encontrado no banco de staging` },
      { status: 404 },
    );
  }

  // Nome do cookie segue a convenção do @auth/core: prefixo `__Secure-` em
  // https (staging é https), e o salt do JWE é o próprio nome do cookie.
  const secure = req.nextUrl.protocol === "https:";
  const cookieName = `${secure ? "__Secure-" : ""}authjs.session-token`;
  const maxAge = 60 * 60 * 24 * 30; // 30 dias — sessão de QA persistente.

  const token = await encode({
    token: { id: user.id, sub: user.id, email: user.email, name: user.name },
    secret,
    salt: cookieName,
    maxAge,
  });

  // Marca o acesso (paridade com o callback jwt real); best-effort.
  prisma.orgMembership
    .updateMany({ where: { userId: user.id }, data: { lastActiveAt: new Date() } })
    .catch(() => {});

  const res = NextResponse.redirect(new URL("/pipeline", req.nextUrl.origin));
  res.cookies.set(cookieName, token, {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge,
  });
  return res;
}
