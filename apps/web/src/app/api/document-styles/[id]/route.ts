import { NextRequest, NextResponse } from "next/server";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const org = await getUserOrg(session.user.id);
  if (!org) return NextResponse.json({ error: "No organization" }, { status: 400 });

  const style = await prisma.documentStyle.findFirst({
    where: { id: params.id, orgId: org.id },
  });
  if (!style) {
    return NextResponse.json({ error: "Style não encontrado" }, { status: 404 });
  }
  return NextResponse.json(style);
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const org = await getUserOrg(session.user.id);
  if (!org) return NextResponse.json({ error: "No organization" }, { status: 400 });

  const body = await req.json().catch(() => ({}));

  // Cross-org guard: só edita estilo da própria org.
  const owned = await prisma.documentStyle.findFirst({
    where: { id: params.id, orgId: org.id },
    select: { id: true },
  });
  if (!owned) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const allowedFields = [
    "name",
    "isDefault",
    "fontFamily",
    "fontSizeBase",
    "lineHeight",
    "marginTopMm",
    "marginBottomMm",
    "marginLeftMm",
    "marginRightMm",
    "colorPrimary",
    "colorAccent",
    "headerHtml",
    "footerHtml",
    "pageNumbers",
    "includeToc",
  ];
  const data: Record<string, unknown> = {};
  for (const key of allowedFields) {
    if (key in body) data[key] = body[key];
  }

  // Invariante "um default por org": limpar o default anterior e gravar o novo
  // numa transação, senão duas requests concorrentes deixam a org com 0 ou 2
  // defaults.
  const updated = await prisma.$transaction(async (tx) => {
    if (body.isDefault === true) {
      await tx.documentStyle.updateMany({
        where: { orgId: org.id, isDefault: true, id: { not: params.id } },
        data: { isDefault: false },
      });
    }
    return tx.documentStyle.update({
      where: { id: params.id },
      data,
    });
  });
  return NextResponse.json(updated);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const org = await getUserOrg(session.user.id);
  if (!org) return NextResponse.json({ error: "No organization" }, { status: 400 });

  await prisma.documentStyle.deleteMany({
    where: { id: params.id, orgId: org.id },
  });
  return NextResponse.json({ ok: true });
}
