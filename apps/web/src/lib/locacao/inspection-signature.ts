// Ganchos do ciclo de assinatura do laudo de vistoria (ClickSign).
// O envelope fecha por 3 caminhos — webhook, sync manual e cron — e o PDF
// assinado chega via downloadSignedPdf de cada caminho; todos chamam aqui.
// Idempotentes e fail-safe: nunca lançam (vistoria é efeito derivado).

import { prisma } from "@/lib/db/prisma";
import { audit } from "@/lib/security/audit";
import { downloadBufferFromUrl } from "@/lib/storage/s3";
import type { ExtraDocumentInput } from "@/lib/clicksign/executor";

/** Envelope fechou → laudo assinado → vistoria concluída. */
export async function completeInspectionOnEnvelopeClosed(
  envelopeId: string
): Promise<{ completed: boolean }> {
  try {
    const inspection = await prisma.inspection.findFirst({
      where: { envelopeId },
      select: { id: true, status: true, orgId: true },
    });
    if (!inspection || inspection.status === "concluida") {
      return { completed: false };
    }
    await prisma.inspection.update({
      where: { id: inspection.id },
      data: { status: "concluida" },
    });
    await audit(
      { orgId: inspection.orgId, userId: null },
      {
        action: "INSPECTION_SIGNED",
        result: "SUCCESS",
        resource: inspection.id,
        resourceType: "Inspection",
        metadata: { envelopeId },
      }
    );
    return { completed: true };
  } catch (err) {
    console.error("[inspection-signature] completeOnClosed:", err);
    return { completed: false };
  }
}

/** PDF assinado baixado → vira o laudo final da vistoria. */
export async function updateInspectionSignedLaudo(
  envelopeId: string,
  signedUrl: string
): Promise<void> {
  try {
    await prisma.inspection.updateMany({
      where: { envelopeId },
      data: { laudoPdfUrl: signedUrl },
    });
  } catch (err) {
    console.error("[inspection-signature] updateSignedLaudo:", err);
  }
}

/**
 * Prepara laudos de vistoria pra irem como documentos EXTRA do envelope do
 * CONTRATO (um envelope só = uma cobrança por signatário, em vez de duas).
 *
 * Valida escopo (org + mesmo deal) e estado (laudo gerado, PDF pronto, sem
 * envelope em curso), materializa o laudo como `DealAttachment` categoria
 * `laudo_vistoria` — exatamente como o envio avulso faz, pra pasta do deal ficar
 * igual nos dois caminhos — e baixa o PDF.
 *
 * NÃO muta a Inspection: quem faz isso é `linkInspectionsToEnvelope`, só depois
 * de o envelope existir.
 */
export async function collectInspectionExtraDocuments(input: {
  orgId: string;
  dealId: string;
  inspectionIds: string[];
}): Promise<
  | { ok: true; documents: ExtraDocumentInput[]; inspectionIds: string[] }
  | { ok: false; error: string }
> {
  const ids = Array.from(new Set(input.inspectionIds)).filter(Boolean);
  if (ids.length === 0) return { ok: true, documents: [], inspectionIds: [] };

  const inspections = await prisma.inspection.findMany({
    where: { id: { in: ids }, orgId: input.orgId },
    select: {
      id: true,
      tipo: true,
      status: true,
      laudoPdfUrl: true,
      leaseContract: { select: { dealId: true } },
    },
  });
  if (inspections.length !== ids.length) {
    return { ok: false, error: "Vistoria não encontrada nesta imobiliária." };
  }

  const documents: ExtraDocumentInput[] = [];
  for (const inspection of inspections) {
    // Cross-deal guard: o laudo só pode viajar no envelope do contrato do
    // MESMO negócio (senão um operador anexaria laudo de outro deal da org).
    if (inspection.leaseContract?.dealId !== input.dealId) {
      return {
        ok: false,
        error: "A vistoria selecionada não pertence a este negócio.",
      };
    }
    if (inspection.status !== "laudo_gerado" || !inspection.laudoPdfUrl) {
      return {
        ok: false,
        error: "Gere o laudo PDF da vistoria antes de anexá-lo à assinatura.",
      };
    }

    const filename = `Laudo de vistoria (${inspection.tipo}).pdf`;
    const laudoUrl = inspection.laudoPdfUrl;
    let attachment = await prisma.dealAttachment.findFirst({
      where: { dealId: input.dealId, url: laudoUrl },
      select: { id: true },
    });
    if (!attachment) {
      attachment = await prisma.dealAttachment.create({
        data: {
          dealId: input.dealId,
          filename,
          mime: "application/pdf",
          url: laudoUrl,
          category: "laudo_vistoria",
          source: "inspection",
        },
        select: { id: true },
      });
    }

    documents.push({
      buffer: await downloadBufferFromUrl(laudoUrl),
      filename,
      sourceAttachmentId: attachment.id,
    });
  }

  return { ok: true, documents, inspectionIds: inspections.map((i) => i.id) };
}

/**
 * Amarra as vistorias ao envelope UNIFICADO já criado. Mesma mutação do envio
 * avulso (`envelopeId` + status "assinatura"), então os ganchos de close/cancel
 * deste arquivo funcionam sem saber qual dos dois caminhos foi usado.
 */
export async function linkInspectionsToEnvelope(
  inspectionIds: string[],
  envelopeId: string
): Promise<void> {
  if (inspectionIds.length === 0) return;
  try {
    await prisma.inspection.updateMany({
      where: { id: { in: inspectionIds } },
      data: { envelopeId, status: "assinatura" },
    });
  } catch (err) {
    console.error("[inspection-signature] linkToEnvelope:", err);
  }
}

/** Envelope cancelado/expirado → laudo volta a ser editável. */
export async function revertInspectionOnEnvelopeCanceled(
  envelopeId: string
): Promise<void> {
  try {
    await prisma.inspection.updateMany({
      where: { envelopeId, status: "assinatura" },
      data: { status: "laudo_gerado" },
    });
  } catch (err) {
    console.error("[inspection-signature] revertOnCanceled:", err);
  }
}
