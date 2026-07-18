import { NextRequest, NextResponse } from "next/server";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { requireOrgAdmin } from "@/lib/security/org-scope";
import { callInfosimples } from "@/lib/certidoes/infosimples";
import { checkOnrAuth } from "@/lib/certidoes/onr-auth";
import { isOnrLoginFailure } from "@/lib/certidoes/error-codes";

export const runtime = "nodejs";
export const maxDuration = 30;

interface OnrHealth {
  active: boolean;
  mode: "cert_a1" | "login_senha" | null;
  error?: string;
  /** true = login autenticou; false = portal recusou o login (608 + msg de login). */
  loginOk?: boolean;
  /** Mensagem crua da Infosimples quando o login falha. */
  loginError?: string;
  /** Login OK mas houve outro 6xx (ex.: 606 lista params/tipo_login aceitos). */
  note?: string;
  resultCode?: number;
  /** Só as CHAVES do 1º item de data[] (sem valores/PII) — revela o campo de protocolo do ONR. */
  sampleShape?: string[];
}

/**
 * Probe de login ONR/ARISP. Usa `registradores/matric/lista` — endpoint
 * INFORMATIVO que **não consome saldo do portal ONR** (só ~R$0,04 de crédito
 * Infosimples) — pra exercer o login real e revelar o shape da resposta.
 * Classifica por MENSAGEM (608 é genérico "params recusados"; o motivo login
 * está no texto). Nunca lança — devolve o estado.
 */
async function probeOnrLogin(): Promise<OnrHealth> {
  const onrAuth = await checkOnrAuth();
  if (!onrAuth.active) {
    return { active: false, mode: null, ...(onrAuth.error ? { error: onrAuth.error } : {}) };
  }
  try {
    const resp = await callInfosimples("registradores/matric/lista", {});
    const msg = [resp.code_message, ...(resp.errors ?? [])].filter(Boolean).join(" ");
    if (resp.code === 200) {
      const first = resp.data?.[0];
      const sampleShape =
        first && typeof first === "object" ? Object.keys(first) : [];
      return { active: true, mode: onrAuth.mode, loginOk: true, resultCode: 200, sampleShape };
    }
    if (isOnrLoginFailure(msg)) {
      return {
        active: true,
        mode: onrAuth.mode,
        loginOk: false,
        loginError: msg || "Não foi possível realizar o login no portal ONR/ARISP.",
        resultCode: resp.code,
      };
    }
    // Login OK, mas outro 6xx (ex.: 606 "faltam params" lista os aceitos).
    return {
      active: true,
      mode: onrAuth.mode,
      loginOk: true,
      note: msg || `Código ${resp.code}`,
      resultCode: resp.code,
    };
  } catch (err) {
    return {
      active: true,
      mode: onrAuth.mode,
      loginOk: false,
      loginError: err instanceof Error ? err.message : "erro desconhecido no probe ONR",
    };
  }
}

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
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  // Diagnóstico consome saldo Infosimples e expõe estado de infra — owner/admin.
  const gate = await requireOrgAdmin(session.user.id);
  if (!gate.ok) return gate.res;
  const org = await getUserOrg(session.user.id);
  if (!org) {
    return NextResponse.json({ error: "No organization" }, { status: 400 });
  }

  // ?onr=1 → só o probe de login ONR (pula CNPJ + GOV.BR). Iteração barata de
  // tipo_login/senha sem gastar o probe CNPJ a cada tentativa.
  const onrOnly = req.nextUrl.searchParams.get("onr") === "1";
  if (onrOnly) {
    if (!process.env.INFOSIMPLES_TOKEN) {
      return NextResponse.json(
        { onr: { active: false, mode: null, error: "INFOSIMPLES_TOKEN não configurado" } },
        { status: 503 }
      );
    }
    const onr = await probeOnrLogin();
    return NextResponse.json({ onr, checkedAt: new Date().toISOString() });
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
  // Probe de login REAL (matric/lista, não consome saldo do portal ONR) — testa
  // a credencial de fato e captura o shape da resposta. Só roda se configurado.
  const onrStatus = await probeOnrLogin();

  return NextResponse.json({
    infosimples: infosimplesStatus,
    govbr: govbrStatus,
    onr: onrStatus,
    checkedAt: new Date().toISOString(),
  });
}
