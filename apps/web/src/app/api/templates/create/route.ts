import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/auth';
import { prisma } from '@/lib/db/prisma';
import { createTemplateSchema } from '@/lib/validation/schemas';
import { generateTemplateHandlebars } from '@/lib/mapping/template-generator';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  // Rota legada (models Document/LegacyTemplate, sem call-site na app) que
  // estava SEM AUTENTICAÇÃO NENHUMA: qualquer requisição criava LegacyTemplate
  // a partir do documento de outra pessoa. Document não tem orgId — o dono é o
  // `userId`, então o escopo é o próprio usuário; 404 igual pra inexistente e
  // alheio, pra não confirmar a existência do documento.
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json();
  const parsed = createTemplateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
  }

  const { documentId, analysis } = parsed.data;
  const doc = await prisma.document.findFirst({
    where: { id: documentId, userId: session.user.id },
  });
  if (!doc) {
    return NextResponse.json({ error: 'Document not found' }, { status: 404 });
  }

  if (!doc.extractedHtml) {
    return NextResponse.json({ error: 'Document missing extracted HTML' }, { status: 400 });
  }

  const result = generateTemplateHandlebars(doc.extractedHtml, analysis);
  const userId = doc.userId;

  const template = await prisma.legacyTemplate.create({
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
