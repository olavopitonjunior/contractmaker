import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { chatSchema } from '@/lib/validation/schemas';
import { runChat } from '@/lib/chat/anthropic';
import { renderContratoHTML } from '@/lib/render/handlebars';

export const runtime = 'nodejs';

function deepMerge(target: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
  const result = { ...target };
  for (const [key, value] of Object.entries(patch)) {
    if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      typeof result[key] === 'object' &&
      result[key] !== null &&
      !Array.isArray(result[key])
    ) {
      result[key] = deepMerge(result[key] as Record<string, unknown>, value as Record<string, unknown>);
    } else {
      result[key] = value as unknown;
    }
  }
  return result;
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json();
  const parsed = chatSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
  }

  const contract = await prisma.contract.findUnique({
    where: { id: params.id },
    include: { template: true, chatSessions: { include: { messages: true } } }
  });
  if (!contract) {
    return NextResponse.json({ error: 'Contract not found' }, { status: 404 });
  }

  let session = contract.chatSessions[0] ?? null;
  if (!session) {
    const created = await prisma.chatSession.create({
      data: { contractId: contract.id, userId: contract.userId },
      include: { messages: true },
    });
    session = created;
  }

  const dataJson = contract.dataJson as Record<string, unknown>;
  const templateSource = contract.templateOverride || contract.template.handlebarsSource;
  const htmlContent = contract.htmlContent || renderContratoHTML(templateSource, dataJson);

  const result = await runChat({
    message: parsed.data.message,
    dataJson,
    htmlPreview: htmlContent
  });

  let updatedData = dataJson;
  let updatedTemplate = contract.templateOverride || contract.template.handlebarsSource;
  let updatedHtml = htmlContent;

  if (result.dataPatch) {
    updatedData = deepMerge(updatedData, result.dataPatch);
  }

  if (result.clausePatch?.target && result.clausePatch.replacement) {
    updatedTemplate = updatedTemplate.replace(result.clausePatch.target, result.clausePatch.replacement);
  }

  updatedHtml = renderContratoHTML(updatedTemplate, updatedData);

  await prisma.chatMessage.create({
    data: {
      sessionId: session.id,
      role: 'user',
      content: parsed.data.message
    }
  });

  await prisma.chatMessage.create({
    data: {
      sessionId: session.id,
      role: 'assistant',
      content: result.assistantText || 'Atualizacao aplicada.'
    }
  });

  await prisma.contract.update({
    where: { id: contract.id },
    data: {
      dataJson: updatedData as any,
      templateOverride: updatedTemplate,
      htmlContent: updatedHtml
    }
  });

  return NextResponse.json({
    message: result.assistantText,
    dataJson: updatedData,
    htmlContent: updatedHtml
  });
}
