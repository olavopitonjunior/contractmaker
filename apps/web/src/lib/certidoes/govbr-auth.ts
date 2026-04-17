/**
 * Phase F.II-γ — Pre-flight check de autenticação GOV.BR na conta Infosimples.
 *
 * Usado pelo planner para decidir se endpoints com `requiresGovBrAuth: true`
 * devem ser emitidos (se auth ativa) ou pulados como SkippedJob (se ausente/
 * expirada). Cache em memória de 5 min evita abusar do rate limit do endpoint
 * (100 req/hora).
 *
 * Endpoint Infosimples: https://api.infosimples.com/api/admin/autenticacao-govbr
 * Custo: zero. Rate limit: 100 req/hora.
 */

interface GovBrSession {
  type: string;          // "CPF/Senha" | "Certificado A1"
  identifier: string;    // mascarado, ex "***123456**"
  expired: boolean;
  created_at: string;    // "dd/mm/yyyy HH:MM"
  expires_at: string;
  expired_at: string | null;
}

interface GovBrAuthResult {
  active: boolean;
  session?: GovBrSession;
  error?: string;
}

interface CacheEntry {
  result: GovBrAuthResult;
  fetchedAt: number;
}

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 min
let cache: CacheEntry | null = null;

/**
 * Limpa o cache (usado em testes ou quando admin reset via UI).
 */
export function clearGovBrAuthCache(): void {
  cache = null;
}

/**
 * Verifica se há sessão GOV.BR ativa na conta Infosimples.
 *
 * Retorno:
 *   - `{active: true, session: {...}}` se há sessão não-expirada
 *   - `{active: false, error?}` caso contrário
 *
 * Cache de 5 min para não bater no rate limit (100 RPH).
 */
export async function checkGovBrAuth(): Promise<GovBrAuthResult> {
  // Cache hit
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
    return cache.result;
  }

  const token = process.env.INFOSIMPLES_TOKEN;
  if (!token) {
    const result: GovBrAuthResult = {
      active: false,
      error: "INFOSIMPLES_TOKEN não configurado",
    };
    cache = { result, fetchedAt: Date.now() };
    return result;
  }

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
      data?: GovBrSession[];
    };

    let result: GovBrAuthResult;
    if (json.code === 200 && Array.isArray(json.data)) {
      const activeSession = json.data.find((s) => !s.expired);
      result = activeSession
        ? { active: true, session: activeSession }
        : {
            active: false,
            error:
              "Nenhuma sessão GOV.BR ativa. Renove a autenticação em duas etapas no portal Infosimples.",
          };
    } else {
      result = {
        active: false,
        error: json.code_message || "Falha ao consultar status GOV.BR",
      };
    }

    cache = { result, fetchedAt: Date.now() };
    return result;
  } catch (err) {
    // Em caso de falha de rede, não cachear erro (retry rápido no próximo call)
    return {
      active: false,
      error: err instanceof Error ? err.message : "erro desconhecido",
    };
  }
}

/**
 * Versão síncrona para uso em testes ou quando a resposta já foi cached.
 * Retorna `null` se nunca foi checado.
 */
export function getGovBrAuthFromCache(): GovBrAuthResult | null {
  if (!cache) return null;
  if (Date.now() - cache.fetchedAt >= CACHE_TTL_MS) return null;
  return cache.result;
}
