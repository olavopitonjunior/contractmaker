import { NextRequest, NextResponse } from "next/server";
import { encode } from "next-auth/jwt";
import { prisma } from "@/lib/db/prisma";
import { STAGING_MODE, VERCEL_ENV } from "@/lib/env/staging";

/**
 * Habilitada em tudo que NÃO é o deploy de produção. O gate por `VERCEL_ENV`
 * (que a Vercel injeta sozinha: "production" no master/imobpro.ia.br, "preview"
 * nos branches como staging) é o discriminador correto — `STAGING_MODE` não
 * está setado como env var no projeto, então gatear por ele deixaria a rota
 * 404 até em staging. `STAGING_MODE` fica no OR só para o caso de ligarem a
 * flag no futuro. Em produção, os dois são falsos e a rota não existe.
 */
const QA_LOGIN_ENABLED = STAGING_MODE || VERCEL_ENV !== "production";

/**
 * Auto-login de QA — EXCLUSIVO DE STAGING.
 *
 * O agente de QA (browser automation) não digita senha nem consome magic link:
 * visita GET /api/dev/qa-login e recebe uma sessão pronta do usuário QA
 * pré-cadastrado, redirecionado pra /pipeline. É a credencial "sempre logada"
 * do ambiente de teste.
 *
 * Segurança:
 *  - **404 no deploy de produção** (`VERCEL_ENV === "production"`) — a rota
 *    simplesmente não existe em prod, então não há superfície de auto-login lá.
 *    Fica ativa nos previews (staging e branches), todos atrás do SSO da Vercel.
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
  if (!QA_LOGIN_ENABLED) {
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

  // O nome do cookie e o salt do JWE têm de casar EXATAMENTE com o que o
  // `auth()` do NextAuth usa pra ler a sessão — senão o cookie é gravado com um
  // nome que o servidor nunca procura. O NextAuth deriva `useSecureCookies` do
  // protocolo do AUTH_URL/NEXTAUTH_URL (NÃO do request), então replicamos isso:
  // no preview o NEXTAUTH_URL está como http://localhost → cookie NÃO-seguro
  // `authjs.session-token`; em prod (https) seria `__Secure-…`. (A causa raiz
  // é o NEXTAUTH_URL de preview apontar pra localhost — mesmo bug do magic link
  // — mas espelhar a lógica aqui destrava o QA sem mexer no env.)
  const authUrl = process.env.NEXTAUTH_URL ?? process.env.AUTH_URL ?? "";
  const useSecureCookies = authUrl.startsWith("https://");
  const cookieName = `${useSecureCookies ? "__Secure-" : ""}authjs.session-token`;
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
    secure: useSecureCookies,
    sameSite: "lax",
    path: "/",
    maxAge,
  });
  return res;
}
