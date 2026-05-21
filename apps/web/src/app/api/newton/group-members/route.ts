import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import {
  requireApiAuth,
  isAuthFailure,
  authFailureResponse,
} from "@/lib/api/require-auth";
import { normalizePhone } from "@/lib/newton/group-match";

export const runtime = "nodejs";

/**
 * POST /api/newton/group-members
 *
 * Sync de membership de grupo do sidecar (que observa os grupos de WhatsApp).
 * Upsert idempotente: registra/atualiza o grupo e seus membros observados (E.164
 * normalizado), escopado à org do token. Base do auto-link deal↔grupo.
 *
 * Body: { groupId, name?, members: [{ phone, lastSeenAt? }] }
 */
const bodySchema = z.object({
  groupId: z.string().trim().min(3).max(128),
  name: z.string().trim().max(160).optional(),
  members: z
    .array(
      z.object({
        phone: z.string().trim().min(8).max(20),
        lastSeenAt: z.string().datetime().optional(),
      })
    )
    .max(2000),
});

export async function POST(req: NextRequest) {
  const auth = await requireApiAuth(req, { scope: "deals:rw" });
  if (isAuthFailure(auth)) return authFailureResponse(auth);

  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Bad Request", details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const { groupId, name, members } = parsed.data;

  const group = await prisma.whatsappGroup.upsert({
    where: { orgId_groupId: { orgId: auth.org.id, groupId } },
    create: { orgId: auth.org.id, groupId, name: name ?? null, lastActivityAt: new Date() },
    update: { name: name ?? undefined, lastActivityAt: new Date() },
  });

  // Normaliza + dedup os telefones; upsert por (groupRowId, phone).
  const seen = new Set<string>();
  let upserted = 0;
  for (const m of members) {
    const phone = normalizePhone(m.phone);
    if (!phone || seen.has(phone)) continue;
    seen.add(phone);
    await prisma.whatsappGroupMember.upsert({
      where: { groupRowId_phone: { groupRowId: group.id, phone } },
      create: {
        groupRowId: group.id,
        phone,
        lastSeenAt: m.lastSeenAt ? new Date(m.lastSeenAt) : new Date(),
      },
      update: { lastSeenAt: m.lastSeenAt ? new Date(m.lastSeenAt) : new Date() },
    });
    upserted++;
  }

  return NextResponse.json({ groupId, members: upserted }, { status: 200 });
}
