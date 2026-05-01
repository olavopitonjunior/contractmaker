import os from "os";
import path from "path";
import fs from "fs";
import { prisma } from "@/lib/db/prisma";
import { renderContratoHTML } from "@/lib/render/handlebars";
import { exportPdf } from "@/lib/render/exporter";
import { exportDocAsPdf } from "@/lib/google/docs";

export interface ContractPdfResult {
  buffer: Buffer;
  filename: string;
}

/**
 * Gera o PDF final do contrato em memória, sem persistir nem fazer upload.
 * Centraliza a lógica que antes vivia só na rota /api/contracts/[id]/export
 * para que outros consumidores (ex: envelope da Clicksign) possam gerar o
 * mesmo artefato.
 */
export async function generateContractPdfBuffer(
  contractId: string
): Promise<ContractPdfResult> {
  const contract = await prisma.contract.findUnique({
    where: { id: contractId },
    include: { template: true },
  });
  if (!contract) {
    throw new Error(`Contrato ${contractId} não encontrado`);
  }

  const filename = `contract-${contract.id}.pdf`;

  // Quando o contrato vive em Google Doc, usa export nativo do Drive.
  if (contract.googleDocId) {
    const buffer = await exportDocAsPdf(contract.googleDocId);
    return { buffer, filename };
  }

  const templateSource =
    contract.templateOverride || contract.template.handlebarsSource;
  const html =
    contract.htmlContent ??
    renderContratoHTML(
      templateSource,
      contract.dataJson as Record<string, unknown>
    );

  const documentStyle = await prisma.documentStyle.findFirst({
    where: { orgId: contract.template.orgId, isDefault: true },
  });
  const styleExport = documentStyle
    ? {
        fontFamily: documentStyle.fontFamily,
        fontSizeBase: documentStyle.fontSizeBase,
        lineHeight: documentStyle.lineHeight,
        marginTopMm: documentStyle.marginTopMm,
        marginBottomMm: documentStyle.marginBottomMm,
        marginLeftMm: documentStyle.marginLeftMm,
        marginRightMm: documentStyle.marginRightMm,
        colorPrimary: documentStyle.colorPrimary,
        headerHtml: documentStyle.headerHtml,
        footerHtml: documentStyle.footerHtml,
        pageNumbers: documentStyle.pageNumbers,
      }
    : null;

  const tmpDir = path.join(os.tmpdir(), "contractmaker-clicksign");
  fs.mkdirSync(tmpDir, { recursive: true });
  const pdfPath = path.join(tmpDir, `${contract.id}-${Date.now()}.pdf`);

  try {
    await exportPdf(html, pdfPath, "A4", styleExport);
    const buffer = fs.readFileSync(pdfPath);
    return { buffer, filename };
  } finally {
    try {
      fs.unlinkSync(pdfPath);
    } catch {
      // best-effort cleanup
    }
  }
}
