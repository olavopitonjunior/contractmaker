import { NextResponse } from "next/server";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { callInfosimples } from "@/lib/certidoes/infosimples";
import { checkOnrAuth } from "@/lib/certidoes/onr-auth";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * GET /api/admin/certidoes/health
 *
 * Phase F.II-β — ping trivial ao Infosimples para verificar se o provider
 * está operando. Usa `receita-federal/cnpj` com o CNPJ do Neon (Infosimples
 * reconhece como consulta de teste) — custo mínimo (~R$ 0,04) e resposta
 * rápida.
 *
 * Também consulta autenticação GOV.BR da conta Infosimples (não custa —
 * endpoint admin gratuito).
 *
 * Retorno:
 *   {
 *     infosimples: { ok, latencyMs, errorMessage? },
 *     govbr: { active, expiresAt?, identifier?, error? },
 *     budget: { spentCents, budgetCents, exceeded }
 *   }
 *
 * UX esperada: chamar antes de disparar um batch grande — se provider fora,
 * avisar usuário antes de gastar.
 */
export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const org = await getUserOrg(session.user.id);
  if (!org) {
    return NextResponse.json({ error: "No organization" }, { status: 400 });
  }

  const token = process.env.INFOSIMPLES_TOKEN;
  if (!token) {
    return NextResponse.json(
      {
        infosimples: { ok: false, errorMessage: "INFOSIMPLES_TOKEN não configurado" },
        govbr: { active: false, error: "Token Infosimples ausente" },
      },
      { status: 503 }
    );
  }

  // --- 1. Ping Infosimples (consulta CNPJ Neon, custo ~R$ 0,04) ---
  const infoT0 = Date.now();
  let infosimplesStatus: {
    ok: boolean;
    latencyMs: number;
    errorMessage?: string;
  } = { ok: false, latencyMs: 0 };
  try {
    // H.9 (Phase H, 2026-04-18) — antes usava cnpj:"00000000000000" (DV
    // inválido), que Infosimples rejeitava com "Parâmetro(s) inválido(s)"
    // mesmo com a API saudável. CNPJ da própria Infosimples (13.347.016/0001-17)
    // é válido e público — probe custa R$ 0,04 mas confirma serviço real.
    const resp = await callInfosimples("receita-federal/cnpj", {
      cnpj: "13347016000117",
    });
    infosimplesStatus = {
      ok: resp.code === 200 || resp.code === 600, // 600 = sem registro é OK
      latencyMs: Date.now() - infoT0,
    };
    if (resp.code !== 200 && resp.code !== 600) {
      infosimplesStatus.errorMessage = resp.code_message;
    }
  } catch (err) {
    infosimplesStatus = {
      ok: false,
      latencyMs: Date.now() - infoT0,
      errorMessage: err instanceof Error ? err.message : "erro desconhecido",
    };
  }

  // --- 2. GOV.BR auth check (admin endpoint gratuito) ---
  let govbrStatus: {
    active: boolean;
    expiresAt?: string;
    identifier?: string;
    type?: string;
    error?: string;
  } = { active: false };
  try {
    const res = await fetch(
      "https://api.infosimples.com/api/admin/autenticacao-govbr",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token }),
        signal: AbortSignal.timeout(10_000),
      }
    );
    const json = (await res.json()) as {
      code: number;
      code_message?: string;
      data?: Array<{
        type: string;
        identifier: string;
        expired: boolean;
        created_at: string;
        expires_at: string;
      }>;
    };
    if (json.code === 200 && Array.isArray(json.data)) {
      const activeSession = json.data.find((s) => !s.expired);
      if (activeSession) {
        govbrStatus = {
          active: true,
          expiresAt: activeSession.expires_at,
          identifier: activeSession.identifier,
          type: activeSession.type,
        };
      } else {
        govbrStatus = {
          active: false,
          error: "Nenhuma sessão GOV.BR ativa. Renove no portal Infosimples.",
        };
      }
    } else {
      govbrStatus = {
        active: false,
        error: json.code_message || "Falha ao consultar status GOV.BR",
      };
    }
  } catch (err) {
    govbrStatus = {
      active: false,
      error: err instanceof Error ? err.message : "erro desconhecido",
    };
  }

  // --- 3. ONR/ARISP (credenciais do portal de Registradores) ---
  // Env-based (não há endpoint admin de status). Indica se matrícula + pesquisa
  // de bens estão habilitadas.
  const onrAuth = await checkOnrAuth();
  const onrStatus = {
    active: onrAuth.active,
    mode: onrAuth.mode,
    ...(onrAuth.error ? { error: onrAuth.error } : {}),
  };

  return NextResponse.json({
    infosimples: infosimplesStatus,
    govbr: govbrStatus,
    onr: onrStatus,
    checkedAt: new Date().toISOString(),
  });
}
