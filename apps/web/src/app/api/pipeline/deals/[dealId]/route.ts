import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { z } from "zod";

export async function GET(
  _req: NextRequest,
  { params }: { params: { dealId: string } }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const deal = await prisma.deal.findUnique({
    where: { id: params.dealId },
    include: {
      stage: true,
      form: true,
      attachments: { orderBy: { createdAt: "desc" } },
      contracts: {
        where: { isLatest: true },
        include: { template: { select: { name: true } } },
        orderBy: { createdAt: "desc" },
      },
    },
  });

  if (!deal) {
    return NextResponse.json({ error: "Deal not found" }, { status: 404 });
  }

  return NextResponse.json(deal);
}

const updateDealSchema = z.object({
  stageId: z.string().optional(),
  position: z.number().optional(),
  title: z.string().optional(),
  value: z.number().optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: { dealId: string } }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const parsed = updateDealSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }

  const deal = await prisma.deal.update({
    where: { id: params.dealId },
    data: parsed.data,
    include: { stage: true },
  });

  return NextResponse.json(deal);
}
