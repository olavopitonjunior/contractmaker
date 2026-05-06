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

  const template = await prisma.contractTemplate.findUnique({
    where: { id: params.id },
  });

  if (!template) {
    return NextResponse.json({ error: "Template not found" }, { status: 404 });
  }

  return NextResponse.json(template);
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();

  const template = await prisma.contractTemplate.findUnique({
    where: { id: params.id },
  });

  if (!template) {
    return NextResponse.json({ error: "Template not found" }, { status: 404 });
  }

  const nextModalidade = body.modalidade ?? template.modalidade;
  const nextIsDefault =
    typeof body.isDefault === "boolean" ? body.isDefault : template.isDefault;
  const nextSource = body.handlebarsSource ?? template.handlebarsSource;
  const sourceChanged = nextSource !== template.handlebarsSource;

  if (nextIsDefault) {
    await prisma.contractTemplate.updateMany({
      where: {
        orgId: template.orgId,
        modalidade: nextModalidade,
        isDefault: true,
        id: { not: params.id },
      },
      data: { isDefault: false },
    });
  }

  const updated = await prisma.contractTemplate.update({
    where: { id: params.id },
    data: {
      name: body.name ?? template.name,
      description: body.description ?? template.description,
      handlebarsSource: nextSource,
      modalidade: nextModalidade,
      isDefault: nextIsDefault,
      version: body.version ?? template.version,
      status: body.status ?? template.status,
      engine: body.engine ?? template.engine,
      googleTemplateDocId:
        body.googleTemplateDocId !== undefined
          ? body.googleTemplateDocId
          : template.googleTemplateDocId,
      // Preview fica obsoleto quando o source muda — força regeneração no
      // próximo "Visualizar". Mantém o doc Drive antigo pra não quebrar
      // iframes que estejam abertos durante a edição.
      ...(sourceChanged
        ? { previewSourceHash: null, previewUpdatedAt: null }
        : {}),
    },
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

  const template = await prisma.contractTemplate.findUnique({
    where: { id: params.id },
    include: { _count: { select: { contracts: true } } },
  });

  if (!template) {
    return NextResponse.json({ error: "Template not found" }, { status: 404 });
  }

  // If template has contracts, archive instead of delete
  if (template._count.contracts > 0) {
    await prisma.contractTemplate.update({
      where: { id: params.id },
      data: { status: "archived" },
    });
    return NextResponse.json({ status: "archived" });
  }

  await prisma.contractTemplate.delete({ where: { id: params.id } });
  return NextResponse.json({ status: "deleted" });
}
