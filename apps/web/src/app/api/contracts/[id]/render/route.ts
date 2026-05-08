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

  // Contratos importados (templateId=null) não podem ser re-renderizados —
  // não há fonte Handlebars. Esse endpoint só serve o fluxo TipTap legacy.
  if (!contract.template) {
    return NextResponse.json(
      {
        error:
          'Contrato sem template Handlebars não pode ser re-renderizado. Edite via Google Docs.',
      },
      { status: 400 }
    );
  }

  const dataJson = parsed.data.dataJson ?? (contract.dataJson as Record<string, unknown>);
  const templateSource = contract.templateOverride || contract.template.handlebarsSource;
  const html = renderContratoHTML(templateSource, dataJson);

  await prisma.contract.update({
    where: { id: contract.id },
    data: {
      dataJson,
      htmlContent: html
    }
  });

  return NextResponse.json({ htmlContent: html });
}
