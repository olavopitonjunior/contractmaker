import { NextRequest, NextResponse } from "next/server";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { getEffectiveUserId } from "@/lib/auth/impersonation";
import { getEffectivePermissions } from "@/lib/security/rbac/check";
import { prisma } from "@/lib/db/prisma";
import { getIListConnection } from "@/lib/ilist/connection";
import { buildImportPayload } from "@/lib/ilist/import";
import { audit, extractAuditContextFromRequest } from "@/lib/security/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/ilist/listings/[id] — payload de import (3 shapes prontos + fotos).
 * `id` é a PK da row do ESPELHO (org-scoped via findFirst {id, orgId}); a
 * chamada lazy à RexAPI usa o ilistId lido da row — nunca ID vindo do client.
 */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const org = await getUserOrg(session.user.id);
  if (!org) {
    return NextResponse.json({ error: "Sem organização ativa" }, { status: 404 });
  }
  const effUserId = await getEffectiveUserId(session.user.id);
  const permissions = await getEffectivePermissions(effUserId, org.id);
  if (!permissions) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const connection = await getIListConnection(org.id);
  if (!connection) {
    return NextResponse.json({ configured: false }, { status: 409 });
  }

  const listing = await prisma.iListListing.findFirst({
    where: { id: params.id, orgId: org.id },
  });
  if (!listing) {
    return NextResponse.json({ error: "Imóvel não encontrado" }, { status: 404 });
  }
  if (listing.deletedAt) {
    return NextResponse.json(
      { error: "Este imóvel não está mais disponível no iList" },
      { status: 410 },
    );
  }

  const payload = await buildImportPayload(listing, connection.regionId);

  await audit(extractAuditContextFromRequest(req, org.id, effUserId), {
    action: "ILIST_LISTING_IMPORTED",
    result: "SUCCESS",
    resourceType: "IListListing",
    resource: listing.id,
    metadata: { ilistId: listing.ilistId, listingCode: listing.listingCode },
  });

  return NextResponse.json({ configured: true, payload });
}
