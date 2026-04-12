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

  // Auto-create deal in "Formulario" stage
  let dealId: string | null = null;
  const pipeline = await prisma.pipeline.findFirst({
    where: { orgId: org.id },
    include: { stages: { orderBy: { position: "asc" } } },
  });

  if (pipeline && pipeline.stages.length > 0) {
    const formularioStage = pipeline.stages.find((s) => s.name === "Formulário") || pipeline.stages[0];
    const dealsInStage = await prisma.deal.count({
      where: { stageId: formularioStage.id },
    });

    const deal = await prisma.deal.create({
      data: {
        pipelineId: pipeline.id,
        stageId: formularioStage.id,
        userId: session.user.id,
        formId: form.id,
        title: body.title || `Negocio - ${form.token.slice(0, 8)}`,
        position: dealsInStage,
      },
    });
    dealId = deal.id;
  }

  return NextResponse.json({
    id: form.id,
    token: form.token,
    url: `/f/${form.token}`,
    dealId,
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
