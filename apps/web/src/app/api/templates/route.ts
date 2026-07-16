import { NextRequest, NextResponse } from "next/server";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { z } from "zod";
import { isTemplateCategory, modalidadeForCategory } from "@/lib/contracts/template-category";

const createTemplateSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  handlebarsSource: z.string().min(1),
  modalidade: z.string().optional(),
  category: z.string().optional(),
  isDefault: z.boolean().optional(),
  version: z.string().optional(),
  engine: z.enum(["handlebars", "google_docs"]).optional(),
  googleTemplateDocId: z.string().optional(),
});

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const org = await getUserOrg(session.user.id);
  if (!org) {
    return NextResponse.json({ error: "No organization" }, { status: 400 });
  }

  const templates = await prisma.contractTemplate.findMany({
    where: { orgId: org.id },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(templates);
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const org = await getUserOrg(session.user.id);
  if (!org) {
    return NextResponse.json({ error: "No organization" }, { status: 400 });
  }

  const body = await req.json();
  const parsed = createTemplateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }

  // Templates de PROPOSTA: modalidade `proposta_*` → schemaType do contrato
  // correspondente (a conversão herda o dataJson sem tradução). O selectPropostaTemplate
  // busca por (orgId, modalidade); o schemaType tem de bater com o da proposta.
  const PROPOSTA_SCHEMA: Record<string, string> = {
    proposta_venda: "compra_venda_v1",
    proposta_locacao_residencial: "locacao_residencial_v1",
    proposta_locacao_comercial: "locacao_comercial_v1",
  };
  const isProposta = parsed.data.modalidade?.startsWith("proposta_") ?? false;

  // Categoria é o input canônico (contratos); modalidade (grupo) é derivada dela.
  const category =
    !isProposta && isTemplateCategory(parsed.data.category)
      ? parsed.data.category
      : undefined;
  const modalidade = isProposta
    ? (parsed.data.modalidade as string)
    : category
      ? modalidadeForCategory(category)
      : parsed.data.modalidade || "a_vista";
  const schemaType = isProposta
    ? PROPOSTA_SCHEMA[parsed.data.modalidade as string] ?? "compra_venda_v1"
    : "compra_venda_v2";
  const isDefault = parsed.data.isDefault ?? false;

  // Invariante: um principal por GRUPO (modalidade).
  if (isDefault) {
    await prisma.contractTemplate.updateMany({
      where: { orgId: org.id, modalidade, isDefault: true },
      data: { isDefault: false },
    });
  }

  const template = await prisma.contractTemplate.create({
    data: {
      orgId: org.id,
      name: parsed.data.name,
      description: parsed.data.description || "",
      handlebarsSource: parsed.data.handlebarsSource,
      modalidade,
      category: category ?? null,
      isDefault,
      version: parsed.data.version || "1.0.0",
      schemaType,
      status: "active",
      engine: parsed.data.engine ?? "handlebars",
      googleTemplateDocId: parsed.data.googleTemplateDocId ?? null,
    },
  });

  return NextResponse.json(template, { status: 201 });
}
