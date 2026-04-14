import { NextRequest, NextResponse } from "next/server";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const org = await getUserOrg(session.user.id);
  if (!org) return NextResponse.json({ error: "No organization" }, { status: 400 });

  const styles = await prisma.documentStyle.findMany({
    where: { orgId: org.id },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
  });

  return NextResponse.json(styles);
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const org = await getUserOrg(session.user.id);
  if (!org) return NextResponse.json({ error: "No organization" }, { status: 400 });

  const body = await req.json().catch(() => null);
  if (!body?.name) {
    return NextResponse.json({ error: "name é obrigatório" }, { status: 400 });
  }

  // If isDefault=true, unset any previous default for the org
  if (body.isDefault === true) {
    await prisma.documentStyle.updateMany({
      where: { orgId: org.id, isDefault: true },
      data: { isDefault: false },
    });
  }

  const created = await prisma.documentStyle.create({
    data: {
      orgId: org.id,
      name: body.name,
      isDefault: !!body.isDefault,
      fontFamily: body.fontFamily || "Times New Roman",
      fontSizeBase: typeof body.fontSizeBase === "number" ? body.fontSizeBase : 12,
      lineHeight: typeof body.lineHeight === "number" ? body.lineHeight : 1.5,
      marginTopMm: typeof body.marginTopMm === "number" ? body.marginTopMm : 25,
      marginBottomMm: typeof body.marginBottomMm === "number" ? body.marginBottomMm : 25,
      marginLeftMm: typeof body.marginLeftMm === "number" ? body.marginLeftMm : 25,
      marginRightMm: typeof body.marginRightMm === "number" ? body.marginRightMm : 25,
      colorPrimary: body.colorPrimary || "#000000",
      colorAccent: body.colorAccent || "#C97B0A",
      headerHtml: body.headerHtml || null,
      footerHtml: body.footerHtml || null,
      pageNumbers: body.pageNumbers !== false,
      includeToc: body.includeToc === true,
    },
  });

  return NextResponse.json(created, { status: 201 });
}
