import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { requirePlatform } from "@/lib/admin/gate";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const schema = z.object({ action: z.literal("dismiss") });

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await auth();
  const g = await requirePlatform(session?.user?.id, "support");
  if (!g.ok) return g.res;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Validation failed" }, { status: 422 });
  }

  const updated = await prisma.supportHandoff.updateMany({
    where: { id: params.id, status: "pending" },
    data: { status: "dismissed" },
  });
  if (updated.count === 0) {
    return NextResponse.json({ error: "Não encontrada ou não pendente" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
