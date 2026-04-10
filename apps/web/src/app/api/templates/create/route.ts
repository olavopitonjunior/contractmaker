import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { createTemplateSchema } from '@/lib/validation/schemas';
import { generateTemplateHandlebars } from '@/lib/mapping/template-generator';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const body = await req.json();
  const parsed = createTemplateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
  }

  const { documentId, analysis } = parsed.data;
  const doc = await prisma.document.findUnique({ where: { id: documentId } });
  if (!doc) {
    return NextResponse.json({ error: 'Document not found' }, { status: 404 });
  }

  if (!doc.extractedHtml) {
    return NextResponse.json({ error: 'Document missing extracted HTML' }, { status: 400 });
  }

  const result = generateTemplateHandlebars(doc.extractedHtml, analysis);
  const userId = doc.userId;
  const template = await prisma.template.create({
    data: {
      userId,
      version: '1.0.0',
      sourceDocId: doc.id,
      handlebarsTemplate: result.template,
      analysisJson: analysis,
      status: 'draft'
    }
  });

  return NextResponse.json({ templateId: template.id, warnings: result.warnings });
}
