import { NextRequest, NextResponse } from "next/server";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { downloadBufferFromUrl } from "@/lib/storage/s3";
import { extractCcvDataJson } from "@/lib/extraction/ccv-extractor";
import { audit, extractAuditContextFromRequest } from "@/lib/security/audit";
import type { ImportableMime } from "@/lib/google/upload-file-as-gdoc";

export const runtime = "nodejs";
export const maxDuration = 60;

const SUPPORTED_MIMES: ImportableMime[] = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
];

/**
 * POST /api/contracts/:id/re-extract
 *
 * Roda novamente a extração Gemini sobre o PDF/DOCX original do contrato
 * importado e atualiza `SalesForm.dataJson` + `Contract.dataJson` com o
 * resultado. Útil quando a extração inicial falhou parcialmente (ex:
 * comissionados não vieram, parcelas omitidas) e o usuário quer re-tentar
 * sem subir o doc de novo.
 *
 * Pré-requisitos:
 *   - Contract existe e tem `templateId IS NULL` (importado).
 *   - Existe um DealAttachment com `category="contrato_original"` no mesmo deal.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const org = await getUserOrg(session.user.id);
  if (!org) {
    return NextResponse.json({ error: "No organization" }, { status: 400 });
  }

  const contract = await prisma.contract.findUnique({
    where: { id: params.id },
    include: {
      deal: {
        include: {
          form: { select: { id: true, orgId: true } },
          pipeline: { select: { orgId: true } },
        },
      },
    },
  });
  if (!contract) {
    return NextResponse.json({ error: "Contrato não encontrado" }, { status: 404 });
  }
  if (contract.deal.pipeline.orgId !== org.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (contract.templateId !== null) {
    return NextResponse.json(
      {
        error:
          "Re-extração só está disponível para contratos importados (sem template Handlebars).",
      },
      { status: 400 }
    );
  }

  // Procura o PDF/DOCX original anexado pelo fluxo de import.
  const sourceAttachment = await prisma.dealAttachment.findFirst({
    where: {
      dealId: contract.dealId,
      category: "contrato_original",
      source: "upload",
    },
    orderBy: { createdAt: "desc" },
  });
  if (!sourceAttachment) {
    return NextResponse.json(
      {
        error:
          "Documento original não encontrado na pasta Documentos. Reimporte o contrato.",
      },
      { status: 404 }
    );
  }
  if (!SUPPORTED_MIMES.includes(sourceAttachment.mime as ImportableMime)) {
    return NextResponse.json(
      { error: `Mime ${sourceAttachment.mime} não suportado para re-extração` },
      { status: 415 }
    );
  }

  let buffer: Buffer;
  try {
    buffer = await downloadBufferFromUrl(sourceAttachment.url);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `Falha ao baixar documento original: ${msg}` },
      { status: 502 }
    );
  }

  const extracted = await extractCcvDataJson(
    buffer,
    sourceAttachment.mime as ImportableMime,
    {
      orgId: org.id,
      userId: session.user.id,
      contractId: contract.id,
    }
  );

  const fieldsCount = Object.keys(extracted).length;

  // Atualiza ambos: SalesForm (alimenta a aba Dados) e Contract (snapshot do
  // dataJson usado por find_similar_contracts e enrich futuro).
  await prisma.$transaction([
    ...(contract.deal.formId
      ? [
          prisma.salesForm.update({
            where: { id: contract.deal.formId },
            data: { dataJson: extracted as object },
          }),
        ]
      : []),
    prisma.contract.update({
      where: { id: contract.id },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data: { dataJson: extracted as any },
    }),
  ]);

  await audit(
    extractAuditContextFromRequest(req, org.id, session.user.id),
    {
      action: "CONTRACT_REEXTRACT",
      result: "SUCCESS",
      resource: contract.id,
      resourceType: "Contract",
      metadata: {
        attachmentId: sourceAttachment.id,
        fieldsCount,
      },
    }
  );

  return NextResponse.json({
    ok: true,
    fieldsCount,
    dataJson: extracted,
  });
}
