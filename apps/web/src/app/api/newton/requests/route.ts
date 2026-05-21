import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import {
  requireApiAuth,
  isAuthFailure,
  authFailureResponse,
} from "@/lib/api/require-auth";
import { serializeRequest } from "@/lib/newton/requests";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/newton/requests
 *
 * Consumido pelo Newton (Bearer) para encontrar pedidos a atender. Filtros:
 *   - dealId   — pedidos de um negócio (após gatilho)
 *   - status   — open|chasing|awaiting_reply|fulfilled|cancelled (CSV aceito)
 *   - targetRef — telefone do contato (match de DM inbound → pedido aberto)
 *   - groupId  — JID do grupo (match de mensagem em grupo → deal → pedidos)
 *
 * Sempre escopado à org do token. Sem filtro de status, default = pendentes
 * (open|chasing|awaiting_reply).
 */
export async function GET(req: NextRequest) {
  const auth = await requireApiAuth(req, { scope: "deals:r" });
  if (isAuthFailure(auth)) return authFailureResponse(auth);

  const url = new URL(req.url);
  const dealIdParam = url.searchParams.get("dealId");
  const statusParam = url.searchParams.get("status");
  const targetRef = url.searchParams.get("targetRef");
  const groupId = url.searchParams.get("groupId");

  const statuses = statusParam
    ? statusParam.split(",").map((s) => s.trim()).filter(Boolean)
    : ["open", "chasing", "awaiting_reply"];

  // groupId → resolve o(s) deal(s) vinculado(s) e filtra por eles.
  let dealIds: string[] | undefined;
  if (groupId) {
    const links = await prisma.dealGroupLink.findMany({
      where: { orgId: auth.org.id, groupId },
      select: { dealId: true },
    });
    dealIds = links.map((l) => l.dealId);
    if (dealIds.length === 0) return NextResponse.json({ requests: [] });
  }

  const requests = await prisma.newtonRequest.findMany({
    where: {
      orgId: auth.org.id,
      ...(dealIdParam ? { dealId: dealIdParam } : {}),
      ...(dealIds ? { dealId: { in: dealIds } } : {}),
      ...(statuses.length ? { status: { in: statuses } } : {}),
      ...(targetRef ? { targetRef } : {}),
    },
    orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
    take: 50,
  });

  return NextResponse.json({ requests: requests.map(serializeRequest) });
}
