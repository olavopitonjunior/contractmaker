import { NextRequest, NextResponse } from "next/server";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { buildOrgConnectClient, ORG_GOOGLE_SCOPES } from "@/lib/google/org-oauth";
import { signOAuthState } from "@/lib/google/oauth-state";

// Inicia o OAuth de conexão do Google Drive da imobiliária. Só owner/admin.
// access_type=offline + prompt=consent força o Google a devolver refresh
// token mesmo quando a conta já consentiu antes.
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const org = await getUserOrg(session.user.id);
  if (!org) {
    return NextResponse.json({ error: "No organization" }, { status: 400 });
  }
  const membership = await prisma.orgMembership.findFirst({
    where: { userId: session.user.id, orgId: org.id },
    select: { role: true },
  });
  if (!membership || !["owner", "admin"].includes(membership.role)) {
    return NextResponse.json(
      { error: "Apenas owner/admin podem conectar o Google da imobiliária." },
      { status: 403 }
    );
  }

  const base = (process.env.NEXTAUTH_URL ?? req.nextUrl.origin).replace(/\/$/, "");
  const redirectUri = `${base}/api/settings/google/callback`;

  const client = buildOrgConnectClient(redirectUri);
  const url = client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: [...ORG_GOOGLE_SCOPES, "openid", "email"],
    state: signOAuthState({ orgId: org.id, userId: session.user.id }),
  });

  return NextResponse.redirect(url);
}
