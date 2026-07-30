import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import {
  matchCriteriaSchema,
  parseMatchCriteria,
  resolveTemplateTaxonomy,
  schemaTypeForModalidade,
  templateFamilyForModalidade,
} from "@/lib/contracts/template-category";

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

  // Categoria (forma de pagamento) é canônica SÓ em template de venda. Num
  // template de locação/proposta ela é ignorada — derivar a modalidade dela
  // apagava a locação e o template sumia do selectLocacaoTemplate.
  const { category: nextCategory, modalidade: nextModalidade } = resolveTemplateTaxonomy({
    currentModalidade: template.modalidade,
    currentCategory: template.category,
    category: body.category,
    modalidade: body.modalidade,
  });
  // schemaType acompanha a modalidade quando ela muda de fato (o template
  // deixa de descrever o mesmo instrumento).
  const nextSchemaType =
    nextModalidade !== template.modalidade
      ? schemaTypeForModalidade(nextModalidade)
      : template.schemaType;
  // Critério de variante (locação/proposta). Só é reescrito quando o payload
  // TRAZ o campo — a listagem manda PATCH { status } e não pode apagar o
  // critério de quem já tem; `null` explícito limpa. Em venda é sempre null:
  // ali quem discrimina é a categoria (forma de pagamento).
  let nextMatchCriteria: Prisma.InputJsonValue | typeof Prisma.DbNull;
  if (templateFamilyForModalidade(nextModalidade) === "venda") {
    nextMatchCriteria = Prisma.DbNull;
  } else {
    let criteria: unknown = template.matchCriteria;
    if (body.matchCriteria !== undefined) {
      // Zod estrito só no que CHEGA. O valor já gravado passa pelo parser
      // tolerante — validar o legado com `.strict()` faria um PATCH inocente
      // (ex.: arquivar pela listagem) morrer em 400 por causa do banco.
      const validated = matchCriteriaSchema.safeParse(body.matchCriteria);
      if (!validated.success) {
        return NextResponse.json({ error: validated.error.message }, { status: 400 });
      }
      criteria = validated.data;
    }
    const normalized = parseMatchCriteria(criteria);
    nextMatchCriteria = normalized ? (normalized as Prisma.InputJsonValue) : Prisma.DbNull;
  }

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
      category: nextCategory,
      matchCriteria: nextMatchCriteria,
      schemaType: nextSchemaType,
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
