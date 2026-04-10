import { NextResponse } from "next/server";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const org = await getUserOrg(session.user.id);
  if (!org) {
    return NextResponse.json({ error: "No organization" }, { status: 400 });
  }

  const pipeline = await prisma.pipeline.findFirst({
    where: { orgId: org.id },
    include: {
      stages: {
        orderBy: { position: "asc" },
        include: {
          deals: {
            orderBy: { position: "asc" },
            include: {
              form: { select: { id: true, status: true, updatedAt: true } },
            },
          },
        },
      },
    },
  });

  return NextResponse.json(pipeline);
}
