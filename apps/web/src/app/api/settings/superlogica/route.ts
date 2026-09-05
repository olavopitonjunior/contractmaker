import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { audit } from "@/lib/security/audit";
import { requireSuperlogicaAdmin } from "@/lib/superlogica/settings-guard";
import { publicAccountView } from "@/lib/superlogica/account";
import {
  connectSuperlogicaAccount,
  SuperlogicaConnectError,
} from "@/lib/superlogica/connect";

export const runtime = "nodejs";

const connectSchema = z.object({
  licenca: z.string().min(3).max(32),
  appToken: z.string().min(8).max(200),
  accessToken: z.string().min(8).max(200),
});

const settingsSchema = z.object({
  // `/contas` só lista ids > 0; 0 não é conta na Superlógica.
  contaBancariaId: z.number().int().min(1).nullable().optional(),
  filialId: z.number().int().min(0).optional(),
  contaContabilComissao: z.string().min(1).max(20).optional(),
  contaContabilDescricao: z.string().min(1).max(120).optional(),
  tipoImovelPadrao: z.number().int().min(1).max(99).optional(),
  tipoPagamentoComissao: z.union([z.literal(0), z.literal(1)]).optional(),
  tipoRecebimentoComissao: z.union([z.literal(0), z.literal(1)]).optional(),
  emitirNf: z.boolean().optional(),
  gerarDimob: z.boolean().optional(),
  vencimentoDias: z.number().int().min(0).max(365).optional(),
  tetoValorCents: z.number().int().min(0).max(2_000_000_000).optional(),
});

/** GET — status da conexão (mascarado: nunca devolve os tokens) + padrões. */
export async function GET(req: NextRequest) {
  const gate = await requireSuperlogicaAdmin(req);
  if (!gate.ok) return gate.response;
  const account = await prisma.superlogicaAccount.findUnique({
    where: { orgId: gate.ctx.orgId },
  });
  return NextResponse.json(publicAccountView(account));
}

/**
 * POST — conecta ou RECONECTA (troca de tokens preservando os padrões: o
 * upsert cai no `update`). Valida nas duas APIs e grava cifrado.
 */
export async function POST(req: NextRequest) {
  const gate = await requireSuperlogicaAdmin(req);
  if (!gate.ok) return gate.response;
  const { orgId, userId } = gate.ctx;
  const body = await req.json().catch(() => ({}));
  const parsed = connectSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Dados inválidos", issues: parsed.error.flatten() },
      { status: 400 }
    );
  }
  try {
    const result = await connectSuperlogicaAccount({ orgId, userId, ...parsed.data });
    await audit(
      { orgId, userId },
      {
        action: "SUPERLOGICA_ACCOUNT_CONNECTED",
        result: "SUCCESS",
        resourceType: "SuperlogicaAccount",
        metadata: { licenca: result.licenca },
      }
    ).catch(() => {});
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof SuperlogicaConnectError && err.status < 500) {
      // Token errado / licença fora do padrão = erro do usuário, não da
      // integração. Sem audit FAILURE: o prefixo SUPERLOGICA_ dispara alerta
      // imediato ao dono da plataforma, e um typo não pode consumir esse slot.
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const message = err instanceof Error ? err.message : String(err);
    await audit(
      { orgId, userId },
      {
        action: "SUPERLOGICA_ACCOUNT_CONNECT_FAILED",
        result: "FAILURE",
        resourceType: "SuperlogicaAccount",
        // Sem tokens: só a mensagem de erro (a API não ecoa credenciais).
        metadata: { message: message.slice(0, 300) },
      }
    ).catch(() => {});
    if (err instanceof SuperlogicaConnectError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[superlogica connect] erro:", message);
    return NextResponse.json({ error: "Falha ao conectar a Superlógica." }, { status: 500 });
  }
}

/** PATCH — padrões da exportação (auto-save da tela). Exige conta conectada. */
export async function PATCH(req: NextRequest) {
  const gate = await requireSuperlogicaAdmin(req);
  if (!gate.ok) return gate.response;
  const { orgId, userId } = gate.ctx;
  const body = await req.json().catch(() => ({}));
  const parsed = settingsSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Dados inválidos", issues: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const existing = await prisma.superlogicaAccount.findUnique({ where: { orgId } });
  if (!existing) {
    return NextResponse.json(
      { error: "Conecte a Superlógica antes de definir os padrões." },
      { status: 409 }
    );
  }
  // Só as chaves enviadas (merge parcial) — undefined não apaga nada.
  const data = Object.fromEntries(
    Object.entries(parsed.data).filter(([, v]) => v !== undefined)
  );
  const updated = await prisma.superlogicaAccount.update({ where: { orgId }, data });
  await audit(
    { orgId, userId },
    {
      action: "SUPERLOGICA_SETTINGS_UPDATED",
      result: "SUCCESS",
      resourceType: "SuperlogicaAccount",
      metadata: { fields: Object.keys(data) },
    }
  ).catch(() => {});
  return NextResponse.json(publicAccountView(updated));
}

/**
 * DELETE — desconecta: apaga a linha inteira (tokens E padrões). Para trocar
 * só os tokens, use o POST (Reconectar), que preserva os padrões.
 */
export async function DELETE(req: NextRequest) {
  const gate = await requireSuperlogicaAdmin(req);
  if (!gate.ok) return gate.response;
  const { orgId, userId } = gate.ctx;
  const account = await prisma.superlogicaAccount.findUnique({ where: { orgId } });
  if (!account) return NextResponse.json({ ok: true, alreadyDisconnected: true });
  await prisma.superlogicaAccount.delete({ where: { orgId } });
  await audit(
    { orgId, userId },
    {
      action: "SUPERLOGICA_ACCOUNT_DISCONNECTED",
      result: "SUCCESS",
      resourceType: "SuperlogicaAccount",
      metadata: { licenca: account.licenca },
    }
  ).catch(() => {});
  return NextResponse.json({ ok: true });
}
