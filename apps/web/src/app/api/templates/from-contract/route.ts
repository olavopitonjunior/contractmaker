import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { isGoogleDocsFeatureEnabled } from "@/lib/google/client";
import { copyContractGoogleDoc } from "@/lib/google/copy-doc";
import { reverseMergeDocToTemplate } from "@/lib/templates/reverse-merge";
import { insertPlaceholdersWithAI } from "@/lib/templates/ai-placeholder-insertion";
import {
  UPLOAD_MODALIDADES,
  schemaTypeForModalidade,
} from "@/lib/contracts/template-category";

export const runtime = "nodejs";
// 300s: reverse-merge + passe de IA (até 120k chars de entrada, 8192 tokens de
// saída, não-stream) + releitura do Doc — 120s era apertado no pior caso.
export const maxDuration = 300;

/**
 * Modalidades e schemaType saem das constantes COMPARTILHADAS
 * (`template-category.ts`). Eram uma cópia local, e a cópia divergiu na hora
 * em que `temporada` foi criada: o diálogo passou a oferecer a opção e esta
 * rota respondia 400 pra ela. Derivar do mesmo lugar que o `<select>` deriva
 * é o que impede a divergência de voltar.
 */
const bodySchema = z.object({
  contractId: z.string().min(1),
  modalidade: z
    .string()
    .refine((v) => (UPLOAD_MODALIDADES as readonly string[]).includes(v), {
      message: `modalidade inválida (aceitas: ${UPLOAD_MODALIDADES.join(", ")})`,
    }),
  name: z.string().trim().min(1).optional(),
});

/**
 * POST /api/templates/from-contract — "Tornar modelo da imobiliária":
 * copia o Google Doc de um contrato existente (o original fica intacto),
 * roda o reverse-merge determinístico (valores do dataJson → {{tokens}},
 * só substituições unívocas) + pass de IA pro restante, e cria um
 * ContractTemplate engine="google_docs" em DRAFT pra revisão.
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const org = await getUserOrg(session.user.id);
  if (!org) {
    return NextResponse.json({ error: "No organization" }, { status: 400 });
  }
  const membership = await prisma.orgMembership.findFirst({
    where: { userId: session.user.id, orgId: org.id },
    select: { role: true },
  });
  if (!membership || !["owner", "admin"].includes(membership.role)) {
    return NextResponse.json(
      { error: "Apenas owner/admin podem criar templates." },
      { status: 403 }
    );
  }
  if (!isGoogleDocsFeatureEnabled()) {
    return NextResponse.json(
      { error: "Integração Google Docs não está habilitada." },
      { status: 503 }
    );
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }
  const { contractId, modalidade, name } = parsed.data;

  const contract = await prisma.contract.findUnique({
    where: { id: contractId },
    include: { deal: { include: { pipeline: { select: { orgId: true } } } } },
  });
  if (!contract || contract.deal.pipeline.orgId !== org.id) {
    return NextResponse.json({ error: "Contrato não encontrado" }, { status: 404 });
  }
  if (!contract.googleDocId) {
    return NextResponse.json(
      { error: "Contrato sem Google Doc — não pode virar modelo." },
      { status: 422 }
    );
  }

  const templateName = name ?? `Modelo da imobiliária — ${modalidade}`;

  let copy: { docId: string; webViewLink: string; embedLink: string };
  try {
    copy = await copyContractGoogleDoc({
      sourceDocId: contract.googleDocId,
      name: `[MODELO] ${templateName}`,
      orgId: org.id,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `Falha ao copiar o doc do contrato: ${msg}` },
      { status: 502 }
    );
  }

  const template = await prisma.contractTemplate.create({
    data: {
      orgId: org.id,
      name: templateName,
      description: `Template criado a partir do contrato ${contract.id}.`,
      engine: "google_docs",
      status: "draft",
      isDefault: false,
      googleTemplateDocId: copy.docId,
      modalidade,
      schemaType: schemaTypeForModalidade(modalidade),
      handlebarsSource: "<!-- engine=google_docs: a fonte é o Google Doc -->",
      version: "1.0.0",
    },
  });

  // Reverse-merge determinístico + pass de IA pro que sobrou — ambos
  // best-effort: o draft sempre passa por revisão humana antes de ativar.
  let reverse = null;
  let aiReport = null;
  try {
    reverse = await reverseMergeDocToTemplate({
      docId: copy.docId,
      dataJson: (contract.dataJson as Record<string, unknown>) ?? {},
      modalidade,
    });
  } catch (err) {
    console.error("[templates/from-contract] reverse-merge falhou:", err);
  }
  try {
    aiReport = await insertPlaceholdersWithAI({
      docId: copy.docId,
      modalidade,
      orgId: org.id,
    });
  } catch (err) {
    console.error("[templates/from-contract] pass de IA falhou:", err);
  }

  await prisma.contractTemplate.update({
    where: { id: template.id },
    data: {
      draftReport: {
        reverseMerge: reverse as object | null,
        ...(aiReport ? (aiReport as object) : {}),
      },
    },
  });

  return NextResponse.json({
    templateId: template.id,
    docId: copy.docId,
    embedLink: copy.embedLink,
    reverseMerge: reverse,
    report: aiReport,
  });
}
