import { NextRequest, NextResponse } from "next/server";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { getEffectiveUserId } from "@/lib/auth/impersonation";
import { getEffectivePermissions } from "@/lib/security/rbac/check";
import { prisma } from "@/lib/db/prisma";
import { getIListConnection } from "@/lib/ilist/connection";
import { LISTING_STATUS, TRANSACTION_TYPE, listingStatusLabel } from "@/lib/ilist/enums";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/ilist/listings?q=&transactionType=venda|locacao&take=&cursor=&includeInactive=
 *
 * Busca do picker de imóveis iList. Consulta SOMENTE o espelho local
 * org-scoped (IListListing) — nunca a RexAPI. Qualquer membro da org pode
 * buscar (dado da própria org, read-only); org sem conexão → { configured:false }.
 */
export async function GET(req: NextRequest) {
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
    return NextResponse.json({ configured: false });
  }

  const sp = req.nextUrl.searchParams;
  const q = (sp.get("q") ?? "").trim().toLowerCase().slice(0, 120);
  const tt = sp.get("transactionType");
  const take = Math.min(Math.max(Number(sp.get("take")) || 20, 1), 50);
  const cursor = sp.get("cursor");
  const includeInactive = sp.get("includeInactive") === "true";

  const where = {
    orgId: org.id,
    deletedAt: null,
    ...(tt === "venda"
      ? { transactionType: TRANSACTION_TYPE.SALE }
      : tt === "locacao"
        ? { transactionType: TRANSACTION_TYPE.RENT }
        : {}),
    ...(includeInactive ? {} : { listingStatus: LISTING_STATUS.ACTIVE }),
    ...(q ? { searchText: { contains: q } } : {}),
  };

  const rows = await prisma.iListListing.findMany({
    where,
    orderBy: [{ modifiedAt: "desc" }, { id: "asc" }],
    take: take + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });

  const hasMore = rows.length > take;
  const page = hasMore ? rows.slice(0, take) : rows;

  return NextResponse.json({
    configured: true,
    syncedAt: connection.lastSyncAt,
    items: page.map((l) => ({
      id: l.id,
      ilistId: l.ilistId,
      listingCode: l.listingCode,
      endereco: [l.streetName, l.streetNumber].filter(Boolean).join(", ") || null,
      cidade: l.city,
      uf: l.uf,
      price: l.price !== null ? Number(l.price) : null,
      currency: l.currency,
      transactionType: l.transactionType,
      listingStatus: l.listingStatus,
      statusLabel: listingStatusLabel(l.listingStatus),
      associateName: l.associateName,
      bedrooms: l.bedrooms,
      builtArea: l.builtArea,
      coverImageUrl: l.coverImageUrl,
    })),
    nextCursor: hasMore ? page[page.length - 1]?.id : null,
  });
}
