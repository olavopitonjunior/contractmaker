import { z } from "zod";

/**
 * Resolução de subdomínio per-tenant (Fase 1a). Funções puras — usadas no
 * middleware (edge-safe, sem DB) e no admin form (validação). O middleware
 * injeta o subdomínio extraído em `x-org-subdomain`; a resolução
 * subdomínio→org (DB) acontece server-side em getUserOrg.
 */

export const ROOT_DOMAIN = process.env.ROOT_DOMAIN ?? "imobpro.ia.br";

// Subdomínios reservados — nunca viram tenant (servem a plataforma).
export const RESERVED_SUBDOMAINS: ReadonlySet<string> = new Set([
  "www",
  "api",
  "mcp",
  "admin",
  "auth",
  "app",
  "status",
  "docs",
  "mail",
  "static",
  "assets",
  "cdn",
]);

export function isReservedSubdomain(sub: string): boolean {
  return RESERVED_SUBDOMAINS.has(sub.toLowerCase());
}

/**
 * Extrai o subdomínio de tenant do host. Retorna null pra apex, www, localhost
 * puro, previews da Vercel e subdomínios reservados.
 *
 *   alpha.imobpro.ia.br      → "alpha"
 *   imobpro.ia.br            → null (apex)
 *   www.imobpro.ia.br        → null (reservado)
 *   alpha.localhost:3000     → "alpha"
 *   localhost:3000           → null
 *   foo.vercel.app           → null (preview)
 */
export function extractSubdomain(
  host: string | null | undefined,
  rootDomain: string = ROOT_DOMAIN
): string | null {
  if (!host) return null;
  const hostname = host.split(":")[0].trim().toLowerCase();
  if (!hostname) return null;

  // Previews da Vercel e IPs não são tenants.
  if (hostname.endsWith(".vercel.app")) return null;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) return null;

  let base: string | null = null;
  if (hostname === "localhost" || hostname.endsWith(".localhost")) {
    base = "localhost";
  } else if (hostname === rootDomain || hostname.endsWith(`.${rootDomain}`)) {
    base = rootDomain;
  } else {
    // Host desconhecido (domínio custom é resolvido por outro caminho).
    return null;
  }

  if (hostname === base) return null; // apex
  const prefix = hostname.slice(0, hostname.length - base.length - 1); // remove ".base"
  if (!prefix) return null;
  // Só o primeiro label conta como subdomínio de tenant.
  const sub = prefix.split(".")[0];
  if (!sub || isReservedSubdomain(sub)) return null;
  return sub;
}

/** Validação do subdomínio escolhido no admin (Fase 1e). */
export const subdomainSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, "Mínimo 3 caracteres")
  .max(63, "Máximo 63 caracteres")
  .regex(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/, "Use letras, números e hífens (sem hífen no início/fim)")
  .refine((s) => !isReservedSubdomain(s), "Subdomínio reservado");
