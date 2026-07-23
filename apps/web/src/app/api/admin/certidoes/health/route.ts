import { NextRequest, NextResponse } from "next/server";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { requireOrgAdmin } from "@/lib/security/org-scope";
import { callInfosimples } from "@/lib/certidoes/infosimples";
import { checkOnrAuth } from "@/lib/certidoes/onr-auth";
import { isOnrLoginFailure } from "@/lib/certidoes/error-codes";
import { isOrgInfosimplesBlocked } from "@/lib/certidoes/executor";

export const runtime = "nodejs";
export const maxDuration = 30;

interface OnrHealth {
  active: boolean;
  mode: "cert_a1" | "login_senha" | null;
  error?: string;
  /**
   * true = login autenticou (SÓ com code 200); false = portal recusou o login
   * (mensagem explícita de login). undefined = inconclusivo (6xx ambíguo, portal
   * fora, rede, org bloqueada) — NUNCA presumir login OK sem 200.
   */
  loginOk?: boolean;
  /** Mensagem crua da Infosimples quando o login falha. */
  loginError?: string;
  /** Contexto quando inconclusivo (6xx ambíguo, ex.: 606 lista tipo_login aceitos; ou org bloqueada). */
  note?: string;
  resultCode?: number;
  /** Só as CHAVES do 1º item de data[] (sem valores/PII) — revela o campo de protocolo do ONR. */
  sampleShape?: string[];
}

/**
 * Probe de login ONR/ARISP. Usa `registradores/matric/lista` — endpoint
 * INFORMATIVO que **não consome saldo do portal ONR** (só ~R$0,04 de crédito
 * Infosimples) — pra exercer o login real e revelar o shape da resposta.
 *
 * Classificação CONSERVADORA: só afirma `loginOk:true` com **code 200** (prova
 * positiva de autenticação). Falha de login só com mensagem explícita
 * (isOnrLoginFailure). Qualquer outro 6xx / rede / org bloqueada → `loginOk`
 * undefined (inconclusivo) com a mensagem crua no `note` — nunca pinta verde sem
 * 200 nem vermelho por causa de outage transitório. Nunca lança.
 *
 * Guarda o breaker/orçamento (isOrgInfosimplesBlocked) e usa timeout curto
 * (< maxDuration do route) sem retry, pra não estourar o serverless nem gastar
 * crédito com a org já congelada.
 */
async function probeOnrLogin(orgId: string): Promise<OnrHealth> {
  const onrAuth = await checkOnrAuth();
  if (!onrAuth.active) {
    return { active: false, mode: null, ...(onrAuth.error ? { error: onrAuth.error } : {}) };
  }
  // Respeita o mesmo guard que runSingleJob/pollPortalJob: não gasta crédito se
  // a org estourou o orçamento mensal ou o breaker de crédito (603) está tripado.
  const blocked = await isOrgInfosimplesBlocked(orgId);
  if (blocked.blocked) {
    return {
      active: true,
      mode: onrAuth.mode,
      note:
        blocked.reason === "credit"
          ? "Conta Infosimples sem crédito (breaker ativo) — teste não executado."
          : "Orçamento mensal de certidões esgotado — teste não executado.",
    };
  }
  try {
    // Timeout curto (< maxDuration=30s) e sem retry: o probe não pode estourar o
    // serverless nem dobrar a latência num portal ONR lento.
    const resp = await callInfosimples(
      "registradores/matric/lista",
      {},
      { timeoutMs: 20_000, retryOnNetworkError: false }
    );
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
    // 6xx ambíguo (608 genérico "params recusados", 615 portal fora, 606 "faltam
    // params" listando tipo_login aceitos, 603/604 conta): INCONCLUSIVO. Mostra a
    // mensagem crua pra diagnóstico, sem afirmar que o login passou.
    return {
      active: true,
      mode: onrAuth.mode,
      note: msg || `Código ${resp.code}`,
      resultCode: resp.code,
    };
  } catch (err) {
    // callInfosimples só lança em rede/5xx (não em 6xx de negócio). Isso é
    // problema de TRANSPORTE, não de credencial → inconclusivo, não "login falhou".
    return {
      active: true,
      mode: onrAuth.mode,
      note: `Não foi possível testar o login (${
        err instanceof Error ? err.message : "erro de rede/provedor"
      }). Tente novamente.`,
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
    const onr = await probeOnrLogin(org.id);
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
  // Env-only aqui (instantâneo, custo zero) — indica só se a credencial está
  // configurada. O teste de login AO VIVO (pago, matric/lista) fica no botão
  // dedicado "Testar login ONR" (?onr=1), pra "Verificar API agora" não gastar
  // crédito extra a cada clique nem arriscar estourar o maxDuration.
  const onrAuth = await checkOnrAuth();
  const onrStatus: OnrHealth = {
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
