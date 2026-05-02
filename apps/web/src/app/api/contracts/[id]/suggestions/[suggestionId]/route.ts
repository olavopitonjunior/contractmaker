import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string; suggestionId: string } }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const { action, htmlContent } = body;

  if (action !== "accept" && action !== "reject") {
    return NextResponse.json({ error: "action deve ser accept ou reject" }, { status: 400 });
  }

  const existing = await prisma.contractSuggestion.findUnique({
    where: { id: params.suggestionId },
    include: { contract: { select: { googleDocId: true } } },
  });

  // Google Docs path: aplica a mudança real no doc (accept) ou só remove o
  // comment-suggestion (reject).
  if (existing?.contract?.googleDocId) {
    try {
      const docId = existing.contract.googleDocId;
      if (action === "accept") {
        const { batchUpdateDoc, getDocStructure } = await import("@/lib/google/docs");
        if (existing.type === "deletion" && existing.originalText) {
          const doc = await getDocStructure(docId);
          const range = findFirstRangeInDoc(doc, existing.originalText);
          if (range) {
            await batchUpdateDoc(docId, [
              { deleteContentRange: { range: { startIndex: range.startIndex, endIndex: range.endIndex } } },
            ]);
          }
        } else if (existing.type === "replacement" && existing.originalText && existing.newText) {
          await batchUpdateDoc(docId, [
            {
              replaceAllText: {
                containsText: { text: existing.originalText, matchCase: true },
                replaceText: existing.newText,
              },
            },
          ]);
        } else if (existing.type === "insertion" && existing.originalText && existing.newText) {
          const doc = await getDocStructure(docId);
          const range = findFirstRangeInDoc(doc, existing.originalText);
          if (range) {
            await batchUpdateDoc(docId, [
              { insertText: { text: existing.newText, location: { index: range.endIndex } } },
            ]);
          }
        }
      }
      // Resolve/remove o comment espelhado no Drive (accept e reject).
      if (existing.googleSuggestionId) {
        const { resolveComment } = await import("@/lib/google/comments");
        await resolveComment(docId, existing.googleSuggestionId);
      }
    } catch (err) {
      console.error("[suggestions PATCH] Falha ao aplicar mudança no Google Doc:", err);
    }
  }

  const suggestion = await prisma.contractSuggestion.update({
    where: { id: params.suggestionId },
    data: {
      status: action === "accept" ? "accepted" : "rejected",
      resolvedAt: new Date(),
      resolvedBy: session.user.id,
    },
  });

  // Persist the editor's new HTML so the server copy stays in sync with the visible state
  if (typeof htmlContent === "string" && !existing?.contract?.googleDocId) {
    await prisma.contract.update({
      where: { id: params.id },
      data: { htmlContent },
    });
  }

  return NextResponse.json(suggestion);
}

interface DocRange { startIndex: number; endIndex: number }
function findFirstRangeInDoc(
  doc: import("googleapis").docs_v1.Schema$Document,
  needle: string
): DocRange | null {
  const trimmed = needle.trim();
  if (!trimmed) return null;
  for (const block of doc.body?.content || []) {
    const para = block.paragraph;
    if (!para) continue;
    for (const el of para.elements || []) {
      const tr = el.textRun;
      if (!tr || !tr.content) continue;
      const idx = tr.content.indexOf(trimmed);
      if (idx >= 0 && el.startIndex !== undefined && el.startIndex !== null) {
        const start = el.startIndex + idx;
        return { startIndex: start, endIndex: start + trimmed.length };
      }
    }
  }
  return null;
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { suggestionId: string } }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await prisma.contractSuggestion.delete({ where: { id: params.suggestionId } });
  return NextResponse.json({ ok: true });
}
