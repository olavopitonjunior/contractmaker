import { getDriveClient } from "./client";
import { getDocStructure } from "./docs";

export interface CreateCommentInput {
  docId: string;
  /** Texto exato a ancorar; primeira ocorrência é usada (anti-alucinação IA). */
  selectedText: string;
  content: string;
  /** Email do autor (apenas se DWD ativo); senão, usa identidade da service account. */
  authorEmail?: string;
}

export interface CreatedComment {
  id: string;
  resolved: boolean;
}

/**
 * Cria um comment ancorado em uma substring do doc. Drive Comments API recebe
 * um anchor JSON com revision + classifyId; aqui montamos isso a partir do
 * estado atual do documento.
 */
export async function createAnchoredComment(input: CreateCommentInput): Promise<CreatedComment> {
  const drive = getDriveClient();
  const doc = await getDocStructure(input.docId);
  const range = findTextRange(doc, input.selectedText);
  if (!range) {
    throw new Error(
      `Texto-âncora não encontrado no doc (anti-alucinação): "${input.selectedText.slice(0, 80)}…"`
    );
  }

  const anchor = JSON.stringify({
    r: doc.revisionId ?? "head",
    a: [
      {
        txt: { o: range.startIndex, l: range.endIndex - range.startIndex },
      },
    ],
  });

  const res = await drive.comments.create({
    fileId: input.docId,
    fields: "id, resolved",
    requestBody: {
      content: input.content,
      anchor,
    },
  });

  return {
    id: res.data.id!,
    resolved: !!res.data.resolved,
  };
}

export async function resolveComment(docId: string, commentId: string) {
  const drive = getDriveClient();
  await drive.comments.update({
    fileId: docId,
    commentId,
    fields: "id, resolved",
    requestBody: { resolved: true },
  });
}

export async function deleteComment(docId: string, commentId: string) {
  const drive = getDriveClient();
  await drive.comments.delete({ fileId: docId, commentId });
}

export async function listComments(docId: string) {
  const drive = getDriveClient();
  const res = await drive.comments.list({
    fileId: docId,
    fields: "comments(id, content, resolved, anchor, createdTime, author/displayName, replies(id, content, createdTime, author/displayName))",
  });
  return res.data.comments || [];
}

interface TextRange {
  startIndex: number;
  endIndex: number;
}

/**
 * Busca a primeira ocorrência de `needle` no doc varrendo `body.content` →
 * `paragraph.elements[].textRun.content`. Retorna índices em escala absoluta
 * do doc (necessário para Docs API).
 */
function findTextRange(
  doc: import("googleapis").docs_v1.Schema$Document,
  needle: string
): TextRange | null {
  const trimmed = needle.trim();
  if (!trimmed) return null;
  const elements = doc.body?.content || [];
  for (const block of elements) {
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
