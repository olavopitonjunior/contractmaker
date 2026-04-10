import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { buildHeuristicAnalysis } from '@/lib/analysis/heuristics';
import { runAnthropicAnalysis } from '@/lib/analysis/anthropic';

export const runtime = 'nodejs';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const doc = await prisma.document.findUnique({ where: { id: params.id } });
  if (!doc) {
    return NextResponse.json({ error: 'Document not found' }, { status: 404 });
  }

  const text = doc.ocrText || doc.extractedText;
  if (!text) {
    return NextResponse.json({ error: 'Document has no extracted text' }, { status: 400 });
  }

  let analysis;
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      analysis = await runAnthropicAnalysis({ text });
    } catch (err) {
      analysis = buildHeuristicAnalysis(text);
    }
  } else {
    analysis = buildHeuristicAnalysis(text);
  }

  return NextResponse.json({ analysis });
}
