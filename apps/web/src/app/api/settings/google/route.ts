import { NextResponse } from "next/server";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { getEffectiveUserId } from "@/lib/auth/impersonation";
import { prisma } from "@/lib/db/prisma";
import { disconnectOrgGoogle } from "@/lib/google/org-oauth";

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const org = await getUserOrg(session.user.id);
  if (!org) {
    return NextResponse.json({ error: "No organization" }, { status: 400 });
  }
  const account = await prisma.orgGoogleAccount.findUnique({
    where: { orgId: org.id },
    select: { email: true, status: true, lastUsedAt: true, lastErrorMessage: true, createdAt: true },
  });
  return NextResponse.json({
    connected: account?.status === "connected",
    email: account?.email ?? null,
    status: account?.status ?? "disconnected",
    lastUsedAt: account?.lastUsedAt ?? null,
    lastErrorMessage: account?.lastErrorMessage ?? null,
    connectedAt: account?.createdAt ?? null,
  });
}

export async function DELETE() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const org = await getUserOrg(session.user.id);
  if (!org) {
    return NextResponse.json({ error: "No organization" }, { status: 400 });
  }
  const effUserId = await getEffectiveUserId(session.user.id);
  const membership = await prisma.orgMembership.findFirst({
    where: { userId: effUserId, orgId: org.id },
    select: { role: true },
  });
  if (!membership || !["owner", "admin"].includes(membership.role)) {
    return NextResponse.json(
      { error: "Apenas owner/admin podem desconectar o Google da imobiliária." },
      { status: 403 }
    );
  }
  await disconnectOrgGoogle(org.id);
  return NextResponse.json({ ok: true });
}
