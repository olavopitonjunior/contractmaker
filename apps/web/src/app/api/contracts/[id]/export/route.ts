import { NextRequest, NextResponse } from 'next/server';
import os from 'os';
import path from 'path';
import fs from 'fs';
import { prisma } from '@/lib/db/prisma';
import { exportSchema } from '@/lib/validation/schemas';
import { renderContratoHTML } from '@/lib/render/handlebars';
import { exportDocx, exportPdf } from '@/lib/render/exporter';
import { uploadBufferToStorage } from '@/lib/storage/s3';
import { exportDocAsPdf, exportDocAsDocx } from '@/lib/google/docs';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const body = await req.json();
    const parsed = exportSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Payload inválido' }, { status: 400 });
    }

    const format = parsed.data.format;
    const wantsPdf = format === 'pdf' || format === 'all';
    const wantsDocx = format === 'docx' || format === 'all';

    const contract = await prisma.contract.findUnique({
      where: { id: params.id },
      include: { template: true }
    });
    if (!contract) {
      return NextResponse.json({ error: 'Contrato não encontrado' }, { status: 404 });
    }

    const templateSource = contract.templateOverride || contract.template.handlebarsSource;
    const html = contract.htmlContent ?? renderContratoHTML(templateSource, contract.dataJson as Record<string, unknown>);

    // Load the org's default DocumentStyle (if any) to apply page-level props at export time
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

    const tmpDir = path.join(os.tmpdir(), 'contractmaker-exports');
    fs.mkdirSync(tmpDir, { recursive: true });

    const base = `contract-${contract.id}`;
    const pdfPath = path.join(tmpDir, `${base}.pdf`);
    const docxPath = path.join(tmpDir, `${base}.docx`);

    let pdfBuffer: Buffer | null = null;
    let docxBuffer: Buffer | null = null;

    // Quando o contrato vive em um Google Doc, usa o export nativo do Drive
    // (`files.export`) — preserva drop cap, ornamentos, watermark e ligaturas
    // que o `html-to-docx` perdia. Esse era o motivador original da migração.
    if (contract.googleDocId) {
      try {
        if (wantsPdf) pdfBuffer = await exportDocAsPdf(contract.googleDocId);
        if (wantsDocx) docxBuffer = await exportDocAsDocx(contract.googleDocId);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[export] Google Drive export failed:', msg);
        return NextResponse.json(
          { error: `Falha ao exportar via Google Docs: ${msg}` },
          { status: 500 }
        );
      }
    } else {
      if (wantsPdf) {
        try {
          await exportPdf(html, pdfPath, 'A4', styleExport);
          pdfBuffer = fs.readFileSync(pdfPath);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error('[export] exportPdf failed:', msg);
          return NextResponse.json(
            { error: `Falha ao gerar PDF: ${msg}` },
            { status: 500 }
          );
        }
      }

      if (wantsDocx) {
        try {
          await exportDocx(html, docxPath, styleExport);
          docxBuffer = fs.readFileSync(docxPath);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error('[export] exportDocx failed:', msg);
          return NextResponse.json(
            { error: `Falha ao gerar DOCX: ${msg}` },
            { status: 500 }
          );
        }
      }
    }

    const bucket = process.env.S3_BUCKET;
    const blobToken = process.env.BLOB_READ_WRITE_TOKEN;
    const isServerless = !!(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
    let pdfUrl: string | null = null;
    let docxUrl: string | null = null;

    try {
      // Priority 1: Vercel Blob (works on Vercel serverless without any
      // additional AWS config — uses BLOB_READ_WRITE_TOKEN).
      if (blobToken) {
        const { put } = await import('@vercel/blob');
        if (pdfBuffer) {
          const res = await put(`exports/${contract.id}/${base}.pdf`, pdfBuffer, {
            access: 'public',
            contentType: 'application/pdf',
            token: blobToken,
            addRandomSuffix: false,
            allowOverwrite: true,
          });
          pdfUrl = res.url;
        }
        if (docxBuffer) {
          const res = await put(`exports/${contract.id}/${base}.docx`, docxBuffer, {
            access: 'public',
            contentType:
              'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            token: blobToken,
            addRandomSuffix: false,
            allowOverwrite: true,
          });
          docxUrl = res.url;
        }
      }
      // Priority 2: S3 bucket
      else if (bucket) {
        if (pdfBuffer) {
          const pdfKey = `exports/${contract.userId}/${contract.id}/${base}.pdf`;
          pdfUrl = await uploadBufferToStorage({
            bucket,
            key: pdfKey,
            body: pdfBuffer,
            contentType: 'application/pdf',
          });
        }
        if (docxBuffer) {
          const docxKey = `exports/${contract.userId}/${contract.id}/${base}.docx`;
          docxUrl = await uploadBufferToStorage({
            bucket,
            key: docxKey,
            body: docxBuffer,
            contentType:
              'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          });
        }
      }
      // Priority 3: local filesystem — only safe on dev (not Vercel).
      else {
        if (isServerless) {
          throw new Error(
            'Nenhum storage configurado. Defina BLOB_READ_WRITE_TOKEN (Vercel Blob) ou S3_BUCKET (AWS S3) nas variáveis de ambiente do deploy.'
          );
        }
        const publicDir = path.join(process.cwd(), 'public', 'exports', contract.id);
        fs.mkdirSync(publicDir, { recursive: true });
        if (pdfBuffer) {
          const pdfPublicPath = path.join(publicDir, `${base}.pdf`);
          fs.writeFileSync(pdfPublicPath, pdfBuffer);
          pdfUrl = `/exports/${contract.id}/${base}.pdf`;
        }
        if (docxBuffer) {
          const docxPublicPath = path.join(publicDir, `${base}.docx`);
          fs.writeFileSync(docxPublicPath, docxBuffer);
          docxUrl = `/exports/${contract.id}/${base}.docx`;
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[export] storage upload failed:', msg);
      return NextResponse.json(
        { error: `Falha ao salvar arquivo exportado: ${msg}` },
        { status: 500 }
      );
    }

    const exportRecords = [
      ...(pdfUrl ? [{ contractId: contract.id, format: 'pdf', url: pdfUrl }] : []),
      ...(docxUrl ? [{ contractId: contract.id, format: 'docx', url: docxUrl }] : []),
    ];
    if (exportRecords.length > 0) {
      await prisma.export.createMany({ data: exportRecords });
    }

    return NextResponse.json({ pdfUrl, docxUrl });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[export] unexpected error:', msg);
    return NextResponse.json(
      { error: `Erro interno ao exportar: ${msg}` },
      { status: 500 }
    );
  }
}
