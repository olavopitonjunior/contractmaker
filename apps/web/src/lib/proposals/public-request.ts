import { createHash } from "node:crypto";

/**
 * `ipHash = sha256(ip + AUTH_SECRET)[:32]` — nunca o IP cru (LGPD). Mesma conta
 * do beacon `/api/public/proposals/[token]/seen`, extraída para as rotas de
 * upload público usarem o mesmo balde de rate limit e o mesmo rastro no
 * `ProposalEvent`.
 */
export function publicRequestIpHash(req: Request): string {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown";
  return createHash("sha256")
    .update(ip + (process.env.AUTH_SECRET ?? ""))
    .digest("hex")
    .slice(0, 32);
}
