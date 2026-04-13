import { NextRequest, NextResponse } from 'next/server';
import os from 'os';
import path from 'path';
import fs from 'fs';
import { prisma } from '@/lib/db/prisma';
import { exportSchema } from '@/lib/validation/schemas';
import { renderContratoHTML } from '@/lib/render/handlebars';
import { exportDocx, exportPdf } from '@/lib/render/exporter';
import { uploadBufferToStorage } from '@/lib/storage/s3';

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

    const tmpDir = path.join(os.tmpdir(), 'contractmaker-exports');
    fs.mkdirSync(tmpDir, { recursive: true });

    const base = `contract-${contract.id}`;
    const pdfPath = path.join(tmpDir, `${base}.pdf`);
    const docxPath = path.join(tmpDir, `${base}.docx`);

    let pdfBuffer: Buffer | null = null;
    let docxBuffer: Buffer | null = null;

    if (wantsPdf) {
      try {
        await exportPdf(html, pdfPath);
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
        await exportDocx(html, docxPath);
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

    const bucket = process.env.S3_BUCKET;
    let pdfUrl: string | null = null;
    let docxUrl: string | null = null;

    try {
      if (bucket) {
        if (pdfBuffer) {
          const pdfKey = `exports/${contract.userId}/${contract.id}/${base}.pdf`;
          pdfUrl = await uploadBufferToStorage({
            bucket,
            key: pdfKey,
            body: pdfBuffer,
            contentType: 'application/pdf'
          });
        }
        if (docxBuffer) {
          const docxKey = `exports/${contract.userId}/${contract.id}/${base}.docx`;
          docxUrl = await uploadBufferToStorage({
            bucket,
            key: docxKey,
            body: docxBuffer,
            contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
          });
        }
      } else {
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
