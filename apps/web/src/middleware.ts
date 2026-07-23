import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/auth";
import { extractSubdomain } from "@/lib/tenant/subdomain";

export default auth((req) => {
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-pathname", req.nextUrl.pathname);
  // White-label (Fase 1a): extrai o subdomínio de tenant do host (puro, sem DB —
  // edge-safe) e injeta em x-org-subdomain. A resolução subdomínio→org + check
  // de membership acontece server-side em getUserOrg/requireAuth.
  //
  // SEGURANÇA: SEMPRE deletar antes de setar. `new Headers(req.headers)` copiou
  // qualquer x-org-subdomain que o CLIENTE tenha mandado; sem o delete, um header
  // forjado no apex (onde extractSubdomain→null e o set não roda) passaria intacto
  // e getUserOrg o honraria. O header só é confiável se for exclusivamente escrito
  // aqui.
  //
  // MÁQUINA: requests de integração (Bearer SEM sessão NextAuth) NÃO recebem o
  // hint — a org de um token vem do dono, não de um Host controlável pelo cliente.
  // Resolve a classe inteira de "máquina subdomain-steerable" na raiz, sem pinar
  // cada call-site bare de getUserOrg (events, attachments…). Checa `req.auth`
  // (sessão já resolvida pelo wrapper `auth`) pra NÃO tirar o hint de uma SESSÃO
  // que por acaso carregue um Authorization header (proxy/extensão).
  const isBearer = /^bearer /i.test(req.headers.get("authorization") ?? "");
  const isMachine = isBearer && !req.auth?.user;
  const subdomain = extractSubdomain(req.headers.get("host"));
  requestHeaders.delete("x-org-subdomain");
  if (subdomain && !isMachine) requestHeaders.set("x-org-subdomain", subdomain);
  return NextResponse.next({
    request: { headers: requestHeaders },
  });
});

export const config = {
  matcher: [
    // Protect all routes except public ones
    "/((?!api/auth|api/forms/[^/]+$|api/forms/[^/]+/save|f/|p/|login|register|logout|forgot-password|reset-password|_next/static|_next/image|favicon.ico).*)",
  ],
};
