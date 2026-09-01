import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { z } from "zod";
import {
  matchCriteriaSchema,
  parseMatchCriteria,
  resolveTemplateTaxonomy,
  schemaTypeForModalidade,
  templateFamilyForModalidade,
} from "@/lib/contracts/template-category";
import { auditTemplateText } from "@/lib/templates/pii-gate";

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
  matchCriteria: matchCriteriaSchema,
});

/**
 * Critério de variante só existe fora de venda (em venda quem discrimina é a
 * `category`). Critério vazio vira SQL NULL = template genérico da modalidade.
 */
function matchCriteriaForWrite(
  modalidade: string | null,
  raw: unknown
): Prisma.InputJsonValue | typeof Prisma.DbNull {
  if (templateFamilyForModalidade(modalidade) === "venda") return Prisma.DbNull;
  const parsed = parseMatchCriteria(raw);
  return parsed ? (parsed as Prisma.InputJsonValue) : Prisma.DbNull;
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

  // Taxonomia: `modalidade` explícita (locação `locacao*`, proposta
  // `proposta_*`) vence; senão a categoria de venda deriva a modalidade do
  // grupo. Categoria só é persistida em template de venda. O schemaType
  // acompanha a modalidade — o selectPropostaTemplate busca por
  // (orgId, modalidade) e o schemaType tem de bater com o da proposta.
  const { category, modalidade } = resolveTemplateTaxonomy({
    currentModalidade: "a_vista",
    currentCategory: null,
    category: parsed.data.category,
    modalidade: parsed.data.modalidade,
  });
  const schemaType = schemaTypeForModalidade(modalidade);
  const isDefault = parsed.data.isDefault ?? false;

  // Invariante: um principal por GRUPO (modalidade).
  // Mede ANTES de mexer no principal: modelo que nasce rascunho (source com
  // dado pessoal) não pode rebaixar o principal ativo da modalidade — a
  // seleção só enxerga `active`, e a org ficaria sem principal.
  const pii = auditTemplateText(parsed.data.handlebarsSource);
  const bornActive = !pii.blocked;
  if (isDefault && bornActive) {
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
      category,
      matchCriteria: matchCriteriaForWrite(modalidade, parsed.data.matchCriteria),
      isDefault: isDefault && bornActive,
      version: parsed.data.version || "1.0.0",
      schemaType,
      // Criação nasce ativa — mas não com dado pessoal literal: o gate da
      // ativação vive no PATCH e a criação o contornava. Source handlebars com
      // CPF/RG/conta nasce RASCUNHO, com o relatório, e passa pelo PATCH.
      status: bornActive ? "active" : "draft",
      ...(bornActive ? {} : { draftReport: { pii } as object }),
      engine: parsed.data.engine ?? "handlebars",
      googleTemplateDocId: parsed.data.googleTemplateDocId ?? null,
    },
  });

  return NextResponse.json(template, { status: 201 });
}
