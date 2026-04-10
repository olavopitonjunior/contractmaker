import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { htmlContent } = body;

  const current = await prisma.contract.findUnique({
    where: { id: params.id },
  });

  if (!current) {
    return NextResponse.json({ error: "Contract not found" }, { status: 404 });
  }

  // Mark current as not latest
  await prisma.contract.update({
    where: { id: current.id },
    data: { isLatest: false },
  });

  // Create new version
  const newVersion = await prisma.contract.create({
    data: {
      dealId: current.dealId,
      templateId: current.templateId,
      userId: session.user.id,
      version: current.version + 1,
      dataJson: (current.dataJson ?? {}) as any,
      htmlContent: htmlContent || current.htmlContent,
      templateOverride: current.templateOverride,
      status: current.status,
      isLatest: true,
      parentVersionId: current.id,
    },
  });

  return NextResponse.json({
    id: newVersion.id,
    version: newVersion.version,
  }, { status: 201 });
}
