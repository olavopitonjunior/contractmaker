import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { downloadBufferFromUrl } from '@/lib/storage/s3';
import { extractDocx } from '@/lib/extraction/docx';
import { extractPdf } from '@/lib/extraction/pdf';
import { textractPdfText } from '@/lib/ocr/textract';
import { updateDocumentExtraction } from '@/lib/documents/documents';

export const runtime = 'nodejs';

function canUseTextract(): boolean {
  return Boolean(process.env.AWS_REGION && process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY);
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const doc = await prisma.document.findUnique({ where: { id: params.id } });
  if (!doc) {
    return NextResponse.json({ error: 'Document not found' }, { status: 404 });
  }

  const buffer = await downloadBufferFromUrl(doc.s3Url);
  let extractedHtml: string | undefined;
  let extractedText: string | undefined;
  let ocrText: string | undefined;

  if (doc.mime.includes('docx') || doc.filename.toLowerCase().endsWith('.docx')) {
    const result = await extractDocx(buffer);
    extractedHtml = result.html;
    extractedText = result.text;
  } else if (doc.mime.includes('pdf') || doc.filename.toLowerCase().endsWith('.pdf')) {
    const result = await extractPdf(buffer);
    extractedText = result.text;
    if ((extractedText?.trim().length ?? 0) < 50 && process.env.OCR_ENABLED === 'true' && canUseTextract()) {
      const url = doc.s3Url;
      if (!url.startsWith('s3://')) {
        return NextResponse.json({ error: 'OCR requires S3 storage' }, { status: 400 });
      }
      const stripped = url.replace('s3://', '');
      const [bucket, ...rest] = stripped.split('/');
      const key = rest.join('/');
      ocrText = await textractPdfText({ bucket, key });
    }
  } else {
    return NextResponse.json({ error: 'Unsupported file type' }, { status: 400 });
  }

  await updateDocumentExtraction({
    id: doc.id,
    html: extractedHtml,
    text: extractedText,
    ocrText,
    status: 'extracted'
  });

  return NextResponse.json({
    id: doc.id,
    extractedHtml: extractedHtml ?? null,
    extractedText: extractedText ?? null,
    ocrText: ocrText ?? null
  });
}
