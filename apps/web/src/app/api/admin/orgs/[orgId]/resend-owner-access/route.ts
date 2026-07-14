import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { requirePlatform } from "@/lib/admin/gate";
import { audit, extractAuditContextFromRequest } from "@/lib/security/audit";
import { sendOwnerAccessEmail } from "@/lib/org/owner-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/admin/orgs/[orgId]/resend-owner-access — reenvia ao owner o link de
 * primeiro acesso (definir senha). Gated (super_admin).
 *
 * Existe porque a senha temporária da criação da org é efêmera: se o e-mail não
 * chegou (ou o tenant foi provisionado antes deste fluxo existir), este é o caminho
 * de entrega. Emite um token `welcome` novo, invalidando o anterior.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { orgId: string } }
) {
  const session = await auth();
  const g = await requirePlatform(session?.user?.id, "super_admin");
  if (!g.ok) return g.res;

  const org = await prisma.organization.findUnique({
    where: { id: params.orgId },
    select: { id: true, name: true },
  });
  if (!org) return NextResponse.json({ error: "Org not found" }, { status: 404 });

  const ownership = await prisma.orgMembership.findFirst({
    where: { orgId: org.id, role: "owner" },
    select: { user: { select: { id: true, email: true } } },
  });

  const owner = ownership?.user;
  if (!owner?.email) {
    return NextResponse.json(
      { error: "NO_OWNER", message: "Esta organização não tem um owner com e-mail." },
      { status: 409 }
    );
  }

  const sent = await sendOwnerAccessEmail({
    email: owner.email,
    orgName: org.name,
    orgId: org.id,
  });

  await audit(extractAuditContextFromRequest(req, org.id, session!.user!.id), {
    action: "ORG_OWNER_ACCESS_RESENT",
    result: sent ? "SUCCESS" : "FAILURE",
    resourceType: "Organization",
    resource: org.id,
    metadata: { ownerEmail: owner.email, ownerId: owner.id },
  });

  if (!sent) {
    return NextResponse.json(
      {
        error: "EMAIL_FAILED",
        message:
          "Não foi possível enviar o e-mail. Verifique a configuração do Resend (EMAIL_FROM em domínio verificado).",
      },
      { status: 502 }
    );
  }

  return NextResponse.json({ ok: true, sentTo: owner.email });
}
