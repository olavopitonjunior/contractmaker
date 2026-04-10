import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { renderContractSchema } from '@/lib/validation/schemas';
import { renderContratoHTML } from '@/lib/render/handlebars';

export const runtime = 'nodejs';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json();
  const parsed = renderContractSchema.safeParse(body);
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

  const dataJson = parsed.data.dataJson ?? (contract.dataJson as Record<string, unknown>);
  const templateSource = contract.templateOverride || contract.template.handlebarsTemplate;
  const html = renderContratoHTML(templateSource, dataJson);

  await prisma.contract.update({
    where: { id: contract.id },
    data: {
      dataJson,
      htmlPreview: html
    }
  });

  return NextResponse.json({ htmlPreview: html });
}
