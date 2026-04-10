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

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json();
  const parsed = exportSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
  }

  const contract = await prisma.contract.findUnique({
    where: { id: params.id },
    include: { template: true }
  });
  if (!contract) {
    return NextResponse.json({ error: 'Contract not found' }, { status: 404 });
  }

  const templateSource = contract.templateOverride || contract.template.handlebarsSource;
  const html = contract.htmlContent ?? renderContratoHTML(templateSource, contract.dataJson as Record<string, unknown>);

  const tmpDir = path.join(os.tmpdir(), 'contractmaker-exports');
  fs.mkdirSync(tmpDir, { recursive: true });

  const base = `contract-${contract.id}`;
  const pdfPath = path.join(tmpDir, `${base}.pdf`);
  const docxPath = path.join(tmpDir, `${base}.docx`);

  await exportPdf(html, pdfPath);
  await exportDocx(html, docxPath);

  const pdfBuffer = fs.readFileSync(pdfPath);
  const docxBuffer = fs.readFileSync(docxPath);

  const bucket = process.env.S3_BUCKET;

  let pdfUrl: string;
  let docxUrl: string;

  if (bucket) {
    const pdfKey = `exports/${contract.userId}/${contract.id}/${base}.pdf`;
    const docxKey = `exports/${contract.userId}/${contract.id}/${base}.docx`;
    pdfUrl = await uploadBufferToStorage({ bucket, key: pdfKey, body: pdfBuffer, contentType: 'application/pdf' });
    docxUrl = await uploadBufferToStorage({
      bucket,
      key: docxKey,
      body: docxBuffer,
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    });
  } else {
    const publicDir = path.join(process.cwd(), 'public', 'exports', contract.id);
    fs.mkdirSync(publicDir, { recursive: true });
    const pdfPublicPath = path.join(publicDir, `${base}.pdf`);
    const docxPublicPath = path.join(publicDir, `${base}.docx`);
    fs.writeFileSync(pdfPublicPath, pdfBuffer);
    fs.writeFileSync(docxPublicPath, docxBuffer);
    pdfUrl = `/exports/${contract.id}/${base}.pdf`;
    docxUrl = `/exports/${contract.id}/${base}.docx`;
  }

  await prisma.export.createMany({
    data: [
      { contractId: contract.id, format: 'pdf', url: pdfUrl },
      { contractId: contract.id, format: 'docx', url: docxUrl }
    ]
  });

  return NextResponse.json({ pdfUrl, docxUrl });
}
