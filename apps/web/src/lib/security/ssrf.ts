/**
 * SSRF guard compartilhado.
 *
 * Antes a checagem vivia inline em chat-attachments/url e só validava o host
 * INICIAL com `redirect: "follow"` — um 301 pra `169.254.169.254` (IMDS) ou
 * pra `[::ffff:169.254.169.254]` furava o guard. `safeFetch` resolve os dois:
 * revalida o host a CADA hop e cobre IPv4-mapped IPv6.
 *
 * Limitação conhecida: não resolve DNS → IP (DNS rebinding continua possível).
 * Mantém o mesmo nível host-based do guard original, só que sem os bypasses.
 */

/** Extrai o IPv4 embutido em formas IPv4-mapped/compat IPv6 (`::ffff:1.2.3.4`). */
function embeddedIpv4(h: string): string | null {
  const m = h.match(/(?:^|:)((?:\d{1,3}\.){3}\d{1,3})$/);
  return m ? m[1] : null;
}

function isPrivateIpv4(ip: string): boolean {
  const m = ip.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!m) return false;
  const [, a, b] = m.map(Number);
  if (a === 0) return true; // "this" network
  if (a === 10) return true; // private
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local / IMDS
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 168) return true; // private
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  return false;
}

/**
 * True se o host aponta pra rede privada/interna (loopback, link-local, ULA,
 * IMDS, CGNAT) — incluindo formas IPv4-mapped IPv6 e endereços entre colchetes.
 */
export function isPrivateHost(hostname: string): boolean {
  let h = hostname.trim().toLowerCase();
  // Remove colchetes de literais IPv6 (URL.hostname os mantém).
  if (h.startsWith("[") && h.endsWith("]")) h = h.slice(1, -1);

  if (!h || h === "localhost" || h.endsWith(".localhost")) return true;

  // IPv4-mapped/compat IPv6 (ex.: ::ffff:169.254.169.254) — checa o IPv4 dentro.
  const mapped = embeddedIpv4(h);
  if (mapped && isPrivateIpv4(mapped)) return true;

  // IPv6: loopback ::1, ULA fc00::/7 (fc/fd), link-local fe80::/10, unspecified ::
  if (h === "::" || h === "::1") return true;
  if (h.includes(":")) {
    if (h.startsWith("fc") || h.startsWith("fd")) return true;
    if (h.startsWith("fe8") || h.startsWith("fe9") || h.startsWith("fea") || h.startsWith("feb"))
      return true;
  }

  // IPv4 puro
  if (isPrivateIpv4(h)) return true;

  return false;
}

export class SsrfBlockedError extends Error {
  constructor(public readonly host: string) {
    super(`Host privado/interno bloqueado: ${host}`);
    this.name = "SsrfBlockedError";
  }
}

function assertPublicUrl(raw: string): URL {
  const u = new URL(raw);
  if (u.protocol !== "https:" && u.protocol !== "http:") {
    throw new SsrfBlockedError(u.protocol);
  }
  if (isPrivateHost(u.hostname)) {
    throw new SsrfBlockedError(u.hostname);
  }
  return u;
}

export interface SafeFetchOptions extends Omit<RequestInit, "redirect"> {
  /** Máximo de redirects seguidos (cada hop é revalidado). Default 5. */
  maxRedirects?: number;
}

/**
 * `fetch` resistente a SSRF: valida o host inicial E cada destino de redirect
 * (`redirect: "manual"` + re-fetch manual). Lança `SsrfBlockedError` se qualquer
 * hop apontar pra host privado. Drop-in pra fetch de URL fornecida pelo usuário
 * ou por payload externo (ClickSign signed_file_url, etc.).
 */
export async function safeFetch(
  rawUrl: string,
  options: SafeFetchOptions = {}
): Promise<Response> {
  const { maxRedirects = 5, ...init } = options;
  let current = assertPublicUrl(rawUrl);

  for (let hop = 0; hop <= maxRedirects; hop++) {
    const res = await fetch(current.toString(), { ...init, redirect: "manual" });
    // Opaque-redirect (status 0) ou 3xx com Location → revalida e segue.
    const isRedirect =
      res.status === 0 || (res.status >= 300 && res.status < 400);
    if (!isRedirect) return res;

    const loc = res.headers.get("location");
    if (!loc) return res; // 3xx sem Location — devolve como veio
    if (hop === maxRedirects) {
      throw new SsrfBlockedError(`excesso de redirects (${maxRedirects})`);
    }
    // Location pode ser relativa — resolve contra a URL atual e revalida.
    current = assertPublicUrl(new URL(loc, current).toString());
  }
  // Inalcançável (loop sempre retorna ou lança), mas satisfaz o tipo.
  throw new SsrfBlockedError("redirect loop");
}
