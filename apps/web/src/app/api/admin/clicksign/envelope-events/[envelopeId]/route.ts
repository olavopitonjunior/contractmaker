import { NextRequest, NextResponse } from "next/server";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";

export const runtime = "nodejs";

/**
 * GET /api/admin/clicksign/envelope-events/{envelopeId}
 *
 * Lista os EnvelopeEvent mais recentes de um envelope. Diagnóstico
 * pra confirmar que webhook ou cron-sync conseguiram processar e
 * persistir eventos.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: { envelopeId: string } }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const org = await getUserOrg(session.user.id);
  if (!org) {
    return NextResponse.json(
      { error: "No organization" },
      { status: 400 }
    );
  }

  const envelope = await prisma.envelope.findFirst({
    where: { id: params.envelopeId, orgId: org.id },
    select: { id: true, status: true, updatedAt: true, clicksignId: true, documentClicksignId: true },
  });
  if (!envelope) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const events = await prisma.envelopeEvent.findMany({
    where: { envelopeId: params.envelopeId },
    orderBy: { receivedAt: "desc" },
    take: 30,
    select: {
      id: true,
      eventName: true,
      source: true,
      receivedAt: true,
    },
  });

  return NextResponse.json({
    ok: true,
    envelope,
    eventCount: events.length,
    events,
  });
}
