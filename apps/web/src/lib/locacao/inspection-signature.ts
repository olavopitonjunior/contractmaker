// Ganchos do ciclo de assinatura do laudo de vistoria (ClickSign).
// O envelope fecha por 3 caminhos — webhook, sync manual e cron — e o PDF
// assinado chega via downloadSignedPdf de cada caminho; todos chamam aqui.
// Idempotentes e fail-safe: nunca lançam (vistoria é efeito derivado).

import { prisma } from "@/lib/db/prisma";
import { audit } from "@/lib/security/audit";

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
