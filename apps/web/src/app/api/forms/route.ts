import { NextResponse } from "next/server";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const org = await getUserOrg(session.user.id);
  if (!org) {
    return NextResponse.json({ error: "No organization" }, { status: 400 });
  }

  const body = await request.json().catch(() => ({}));

  const form = await prisma.salesForm.create({
    data: {
      orgId: org.id,
      title: body.title || null,
      schemaType: "compra_venda_v1",
      dataJson: {},
      status: "rascunho",
    },
  });

  return NextResponse.json({
    id: form.id,
    token: form.token,
    url: `/f/${form.token}`,
  }, { status: 201 });
}

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const org = await getUserOrg(session.user.id);
  if (!org) {
    return NextResponse.json({ error: "No organization" }, { status: 400 });
  }

  const forms = await prisma.salesForm.findMany({
    where: { orgId: org.id },
    orderBy: { createdAt: "desc" },
    include: { deal: { select: { id: true, title: true } } },
  });

  return NextResponse.json(forms);
}
