import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { createContractSchema } from '@/lib/validation/schemas';
import { renderContratoHTML } from '@/lib/render/handlebars';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const body = await req.json();
  const parsed = createContractSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
  }

  const template = await prisma.legacyTemplate.findUnique({ where: { id: parsed.data.templateId } });
  if (!template) {
    return NextResponse.json({ error: 'Template not found' }, { status: 404 });
  }

  const html = renderContratoHTML(template.handlebarsTemplate, parsed.data.dataJson);
  // Legacy route - dealId is required in new schema, use placeholder for backward compat
  const contract = await prisma.contract.create({
    data: {
      userId: template.userId,
      templateId: template.id,
      dealId: (parsed.data as any).dealId || "legacy",
      dataJson: parsed.data.dataJson,
      htmlContent: html,
      status: 'draft'
    }
  });

  return NextResponse.json({ contractId: contract.id, htmlContent: html });
}
