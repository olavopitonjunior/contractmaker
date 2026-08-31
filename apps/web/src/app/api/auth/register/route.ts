import { NextResponse } from "next/server";

/**
 * ⚠️ DEPRECATED (2026-04-29)
 *
 * Cadastro público desativado. Acesso à plataforma é exclusivamente por
 * convite criado em /settings/membros, com aprovação de quem tem a permissão
 * `org.members.approve` — presets `owner` e `admin` — ou de um e-mail da
 * allowlist INVITE_APPROVER_EMAILS. Ver `lib/auth/invitations.ts`.
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
