import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { requirePlatform } from "@/lib/admin/gate";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const VALID_STATUS = new Set(["pending", "answered", "dismissed"]);

export async function GET(req: NextRequest) {
  const session = await auth();
  const g = await requirePlatform(session?.user?.id, "support");
  if (!g.ok) return g.res;

  const statusParam = req.nextUrl.searchParams.get("status") ?? "pending";
  const status = VALID_STATUS.has(statusParam) ? statusParam : "pending";

  const rows = await prisma.supportHandoff.findMany({
    where: { status },
    orderBy: status === "pending" ? { count: "desc" } : { updatedAt: "desc" },
    take: 100,
    select: {
      id: true,
      question: true,
      screenPath: true,
      status: true,
      count: true,
      answer: true,
      answeredAt: true,
      knowledgeItemId: true,
      transcriptJson: true,
      createdAt: true,
    },
  });

  return NextResponse.json({
    handoffs: rows.map((r) => ({
      ...r,
      answeredAt: r.answeredAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
    })),
  });
}
