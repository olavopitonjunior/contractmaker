import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { requireSuperlogicaAdmin } from "@/lib/superlogica/settings-guard";
import { decryptAccountCreds } from "@/lib/superlogica/account";
import {
  validateSuperlogicaCreds,
  SuperlogicaConnectError,
} from "@/lib/superlogica/connect";

export const runtime = "nodejs";

/**
 * POST /api/settings/superlogica/test — revalida os tokens gravados nas duas
 * APIs e atualiza lastValidatedAt/lastError. Não altera os tokens.
 *
 * Só rebaixa a conta para `status: "error"` quando a Superlógica RECUSA os
 * tokens (4xx). Rede caída / HTML "Fatal error" da v2 (5xx) é transitório:
 * grava lastError e mantém `connected`, senão a tela cairia no formulário
 * vazio e o admin recolaria tokens que nunca estiveram errados.
 */
export async function POST(req: NextRequest) {
  const gate = await requireSuperlogicaAdmin(req);
  if (!gate.ok) return gate.response;
  const { orgId } = gate.ctx;
  const account = await prisma.superlogicaAccount.findUnique({ where: { orgId } });
  if (!account) {
    return NextResponse.json({ ok: false, error: "Superlógica não conectada." }, { status: 409 });
  }
  // Decrypt FORA do try: falha aqui é configuração do servidor (chave de
  // cifra ausente/rotacionada), não token do cliente — não pode virar
  // "tokens inválidos" nem persistir status de erro na conta.
  let creds;
  try {
    creds = decryptAccountCreds(account);
  } catch (err) {
    console.error("[superlogica test] falha ao decifrar credenciais:", err);
    return NextResponse.json(
      { ok: false, error: "Falha interna ao ler as credenciais gravadas. Avise o suporte." },
      { status: 500 }
    );
  }
  try {
    const result = await validateSuperlogicaCreds(creds);
    await prisma.superlogicaAccount.update({
      where: { orgId },
      data: {
        status: "connected",
        lastValidatedAt: new Date(),
        lastError: null,
        accountName: result.accountName ?? account.accountName,
      },
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const isConnectError = err instanceof SuperlogicaConnectError;
    const message = isConnectError
      ? err.message
      : "Falha ao validar os tokens na Superlógica.";
    const rejected = isConnectError && err.status < 500;
    await prisma.superlogicaAccount.update({
      where: { orgId },
      data: {
        lastError: message.slice(0, 500),
        ...(rejected ? { status: "error" } : {}),
      },
    });
    const status = isConnectError ? err.status : 500;
    return NextResponse.json({ ok: false, error: message, rejected }, { status });
  }
}
