import { NextResponse } from "next/server";

/**
 * ⚠️ DEPRECATED (2026-04-29)
 *
 * Cadastro público desativado. Acesso à plataforma é exclusivamente por
 * convite criado por um owner em /settings/membros, com aprovação do
 * aprovador designado (env INVITE_APPROVER_EMAILS).
 *
 * Mantém o endpoint apenas para retornar 410 Gone — clients antigos com
 * página de cadastro em cache veem a mensagem certa em vez de erro de rede.
 */
export async function POST() {
  return NextResponse.json(
    {
      error:
        "Cadastro público desativado. Solicite um convite a um administrador para receber acesso.",
    },
    { status: 410 }
  );
}
