import { NextResponse } from "next/server";

/**
 * ⚠️ DEPRECATED (2026-07-15)
 *
 * Endpoint legado de login pré-NextAuth. O login real é o NextAuth
 * Credentials em /api/auth/[...nextauth]. Este endpoint era um orÁculo de
 * credenciais sem rate-limit e, com ALLOW_SELF_REGISTER=true, ainda criava
 * usuário via verifyOrBootstrapUser — nenhum client o consome desde a
 * migração.
 *
 * Mantém o endpoint apenas para retornar 410 Gone — mesma convenção do
 * /api/auth/register desativado.
 */
export async function POST() {
  return NextResponse.json(
    { error: "Endpoint desativado. Use o login padrão da plataforma." },
    { status: 410 }
  );
}
