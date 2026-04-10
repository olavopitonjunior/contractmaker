export { auth as middleware } from "@/lib/auth/auth";

export const config = {
  matcher: [
    // Protect all routes except public ones
    "/((?!api/auth|api/forms/[^/]+$|api/forms/[^/]+/save|f/|login|register|_next/static|_next/image|favicon.ico).*)",
  ],
};
