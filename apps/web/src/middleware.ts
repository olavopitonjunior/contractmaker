import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/auth";
import { extractSubdomain } from "@/lib/tenant/subdomain";

export default auth((req) => {
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-pathname", req.nextUrl.pathname);
  // White-label (Fase 1a): extrai o subdomínio de tenant do host (puro, sem DB —
  // edge-safe) e injeta em x-org-subdomain. A resolução subdomínio→org + check
  // de membership acontece server-side em getUserOrg/requireAuth.
  const subdomain = extractSubdomain(req.headers.get("host"));
  if (subdomain) requestHeaders.set("x-org-subdomain", subdomain);
  return NextResponse.next({
    request: { headers: requestHeaders },
  });
});

export const config = {
  matcher: [
    // Protect all routes except public ones
    "/((?!api/auth|api/forms/[^/]+$|api/forms/[^/]+/save|f/|login|register|logout|forgot-password|reset-password|_next/static|_next/image|favicon.ico).*)",
  ],
};
