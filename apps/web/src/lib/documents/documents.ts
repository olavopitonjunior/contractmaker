import { prisma } from '../db/prisma';

export async function createDocument(params: {
  userId: string;
  filename: string;
  mime: string;
  s3Url: string;
}): Promise<{ id: string }> {
  const doc = await prisma.document.create({
    data: {
      userId: params.userId,
      filename: params.filename,
      mime: params.mime,
      s3Url: params.s3Url
    }
  });
  return { id: doc.id };
}

export async function updateDocumentExtraction(params: {
  id: string;
  html?: string | null;
  text?: string | null;
  ocrText?: string | null;
  status?: string;
}): Promise<void> {
  await prisma.document.update({
    where: { id: params.id },
    data: {
      extractedHtml: params.html ?? undefined,
      extractedText: params.text ?? undefined,
      ocrText: params.ocrText ?? undefined,
      status: params.status ?? undefined
    }
  });
}
