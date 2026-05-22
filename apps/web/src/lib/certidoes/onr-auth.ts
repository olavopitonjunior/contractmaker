/**
 * Phase L (2026-05-22) — Pre-flight de credenciais ONR/ARISP (Registradores).
 *
 * Diferente do GOV.BR (que tem endpoint admin de status na Infosimples), o
 * acesso ao portal ONR/ARISP é feito com credenciais PRÓPRIAS do portal de
 * Registradores (login/senha ou certificado A1) e debita o SALDO daquele
 * portal — não os créditos Infosimples. Aqui o "ativo" é determinado pela
 * presença das env vars de credencial, que `callInfosimples` injeta nos
 * endpoints `registradores/*` e `onr/*`.
 *
 * Usado pelo planner para decidir se endpoints com `requiresOnrAuth: true`
 * disparam (active=true) ou viram SkippedJob orientando configurar em Settings.
 *
 * Env vars aceitas (qualquer um dos dois modos):
 *   - Certificado A1: INFOSIMPLES_ONR_PKCS12_CERT_CRYPT + INFOSIMPLES_ONR_PKCS12_PASS_CRYPT
 *   - Login/senha:    INFOSIMPLES_ONR_LOGIN + INFOSIMPLES_ONR_SENHA (+ INFOSIMPLES_ONR_TIPO_LOGIN)
 */

export interface OnrAuthResult {
  active: boolean;
  /** "cert_a1" | "login_senha" | null — qual modo de credencial está configurado */
  mode: "cert_a1" | "login_senha" | null;
  error?: string;
}

interface CacheEntry {
  result: OnrAuthResult;
  fetchedAt: number;
}

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 min
let cache: CacheEntry | null = null;

/** Limpa o cache (testes ou reset via UI). */
export function clearOnrAuthCache(): void {
  cache = null;
}

/**
 * Resolve o modo de credencial ONR a partir das env vars. Exportado para
 * `callInfosimples` reutilizar a mesma fonte de verdade.
 */
export function resolveOnrCredentialMode(): "cert_a1" | "login_senha" | null {
  const certCrypt = process.env.INFOSIMPLES_ONR_PKCS12_CERT_CRYPT?.trim();
  const passCrypt = process.env.INFOSIMPLES_ONR_PKCS12_PASS_CRYPT?.trim();
  const login = process.env.INFOSIMPLES_ONR_LOGIN?.trim();
  const senha = process.env.INFOSIMPLES_ONR_SENHA?.trim();
  // Toggle análogo a INFOSIMPLES_AUTH_MODE: força login/senha mesmo com cert set.
  const authMode = process.env.INFOSIMPLES_ONR_AUTH_MODE?.trim();
  if (authMode !== "login_senha" && certCrypt && passCrypt) return "cert_a1";
  if (login && senha) return "login_senha";
  return null;
}

/**
 * Verifica se há credencial ONR/ARISP configurada. Síncrono na prática
 * (só lê env), mas mantém assinatura async + cache para espelhar
 * `checkGovBrAuth` e permitir um live-check futuro via `registradores/info-conta`.
 */
export async function checkOnrAuth(): Promise<OnrAuthResult> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
    return cache.result;
  }
  const mode = resolveOnrCredentialMode();
  const result: OnrAuthResult = mode
    ? { active: true, mode }
    : {
        active: false,
        mode: null,
        error:
          "Credenciais ONR/ARISP não configuradas. Defina INFOSIMPLES_ONR_* em Settings → Certidões para habilitar matrícula e pesquisa de bens.",
      };
  cache = { result, fetchedAt: Date.now() };
  return result;
}
