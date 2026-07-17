import { NextRequest, NextResponse } from "next/server";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { downloadBufferFromUrl } from "@/lib/storage/s3";
import { extractCcvDataJson } from "@/lib/extraction/ccv-extractor";
import { extractLocacaoContractDataJson } from "@/lib/extraction/locacao-extractor";
import {
  deriveDealMetadata,
  deriveLocacaoDealMetadata,
} from "@/lib/contracts/derive-deal-metadata";
import { exportDocAsPdf } from "@/lib/google/docs";
import { audit, extractAuditContextFromRequest } from "@/lib/security/audit";
import type { ImportableMime } from "@/lib/google/upload-file-as-gdoc";

const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

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
  const dealKind = contract?.deal.kind;
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
  let extractionMime = sourceAttachment.mime as ImportableMime;
  // DOCX → PDF: o anexo original é DOCX, mas o Gemini extrai DOCX cru de forma
  // irregular ({} silencioso). O contrato importado já tem um GDoc nativo —
  // exportamos como PDF e extraímos dele. Fallback pro buffer original em falha.
  if (sourceAttachment.mime === DOCX_MIME && contract.googleDocId) {
    try {
      buffer = await exportDocAsPdf(contract.googleDocId);
      extractionMime = "application/pdf";
    } catch (err) {
      console.error("[re-extract] export DOCX→PDF falhou, baixando original:", err);
      buffer = await downloadBufferFromUrl(sourceAttachment.url).catch(() => {
        throw err;
      });
    }
  } else {
    try {
      buffer = await downloadBufferFromUrl(sourceAttachment.url);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return NextResponse.json(
        { error: `Falha ao baixar documento original: ${msg}` },
        { status: 502 }
      );
    }
  }

  const extractCtx = {
    orgId: org.id,
    userId: session.user.id,
    contractId: contract.id,
  };
  // Re-extração respeita a esteira do deal: contrato de locação usa o extractor
  // de locação (antes sempre usava CCV — re-extrair locação trazia shape errado).
  const extracted =
    dealKind === "locacao"
      ? (await extractLocacaoContractDataJson(buffer, extractionMime, extractCtx)).dataJson
      : await extractCcvDataJson(buffer, extractionMime, extractCtx);

  const fieldsCount = Object.keys(extracted).length;

  // GUARD extração vazia: o extractor engole erro do Gemini e devolve {} —
  // uma indisponibilidade transitória não pode APAGAR os dados que o usuário
  // já tem (SalesForm/Contract.dataJson viravam {} e a aba Dados esvaziava,
  // com resposta ok:true). Sem dados novos, NADA é persistido.
  if (fieldsCount === 0) {
    return NextResponse.json(
      {
        error:
          "A extração não retornou dados (falha temporária da IA ou documento ilegível). Nada foi alterado — tente novamente.",
      },
      { status: 502 }
    );
  }

  // Re-deriva o nome denormalizado do card (Deal.clientName) do dataJson novo.
  // Sem isto, uma re-extração que finalmente trouxe o comprador deixaria o
  // kanban com o nome velho/vazio (o card não lê mais o dataJson ao vivo).
  // Sempre grava o derivado (null limpa) — coerente com o dataJson, que é
  // substituído na mesma transação.
  const deriveMeta =
    dealKind === "locacao" ? deriveLocacaoDealMetadata : deriveDealMetadata;
  const { clientName } = deriveMeta(extracted, {
    fallbackTitle: contract.deal.title,
  });

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
    prisma.deal.update({
      where: { id: contract.dealId },
      data: { clientName },
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
