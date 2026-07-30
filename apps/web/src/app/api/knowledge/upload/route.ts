import { NextRequest, NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { z } from "zod";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { getEffectiveUserId } from "@/lib/auth/impersonation";
import { prisma } from "@/lib/db/prisma";
import {
  createKnowledgeItemRows,
  embedKnowledgeItem,
  type EmbedTarget,
} from "@/lib/ai/knowledge";
import { extractPlainText } from "@/lib/ai/ocr";
import { extractDocx } from "@/lib/extraction/docx";
import {
  classifyKnowledgeUpload,
  type UploadClassification,
} from "@/lib/knowledge/upload-classifier";
import { segmentClauses } from "@/lib/knowledge/clause-segmenter";

export const runtime = "nodejs";
export const maxDuration = 120;

const PDF_MIME = "application/pdf";
const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const MAX_BYTES = 20 * 1024 * 1024;
const VALID_CATEGORIES = ["legislation", "model", "rule", "glossary", "clause"] as const;
type Category = (typeof VALID_CATEGORIES)[number];

const categorySchema = z.enum(VALID_CATEGORIES);

/** Detecta o tipo real pelo magic-byte (não confia no mime declarado). */
function sniff(buffer: Buffer): "pdf" | "docx" | null {
  if (buffer.subarray(0, 7).toString("ascii").startsWith("%PDF-1.")) return "pdf";
  // DOCX é um zip → magic PK\x03\x04
  if (buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b && buffer[2] === 0x03 && buffer[3] === 0x04) {
    return "docx";
  }
  return null;
}

/**
 * POST /api/knowledge/upload (multipart)
 *
 * Ingestão de documento (PDF/DOCX) na base de conhecimento: extrai o texto
 * (PDF via Gemini OCR, DOCX via mammoth), cria as linhas do KnowledgeItem e
 * gera embeddings em background (waitUntil — a chamada ao Voyage não segura a
 * resposta). Sem VOYAGE_API_KEY, o item segue pesquisável via ILIKE.
 *
 * Campos do formData:
 *  - `file`     (obrigatório) PDF ou DOCX, ≤ 20MB
 *  - `category` (opcional) uma das VALID_CATEGORIES. **Quando vem explícita, o
 *               classificador NÃO roda** — o comportamento é o histórico.
 *  - `force`    (opcional, "true") ingere mesmo quando o documento foi
 *               detectado como modelo de contrato (o 409 abaixo).
 *  - `title`, `tags` (opcionais)
 *
 * Sem `category`, o texto passa pelo classificador (`lib/knowledge/upload-classifier`):
 *  - modelo de contrato → 409 `LOOKS_LIKE_TEMPLATE` SEM criar nada (a UI oferece
 *    o fluxo de templates, que preserva o layout e insere placeholders);
 *  - coleção de cláusulas → 1 KnowledgeItem `clause` POR cláusula;
 *  - resto → chunking por tamanho, como antes.
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const org = await getUserOrg(session.user.id);
  if (!org) return NextResponse.json({ error: "No organization" }, { status: 400 });

  const effUserId = await getEffectiveUserId(session.user.id);
  const membership = await prisma.orgMembership.findFirst({
    where: { userId: effUserId, orgId: org.id },
    select: { role: true },
  });
  if (!membership || !["owner", "admin"].includes(membership.role)) {
    return NextResponse.json(
      { error: "Apenas owner/admin podem subir documentos." },
      { status: 403 }
    );
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: "Multipart inválido." }, { status: 400 });
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Arquivo ausente." }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "Arquivo excede 20MB." }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const kind = sniff(buffer);
  if (!kind) {
    return NextResponse.json(
      { error: "Formato não suportado — envie PDF ou DOCX." },
      { status: 422 }
    );
  }

  // Categoria: ausente/"auto" → classificador decide. Explícita → caminho
  // histórico, sem IA e sem 409.
  const rawCategory = formData.get("category");
  const categoryInput = typeof rawCategory === "string" ? rawCategory.trim() : "";
  let explicitCategory: Category | null = null;
  if (categoryInput && categoryInput !== "auto") {
    const parsed = categorySchema.safeParse(categoryInput);
    if (!parsed.success) {
      return NextResponse.json({ error: "Categoria inválida." }, { status: 400 });
    }
    explicitCategory = parsed.data;
  }
  const force = String(formData.get("force") ?? "") === "true";

  const rawTitle = String(formData.get("title") ?? "").trim();
  const title = rawTitle || file.name.replace(/\.(pdf|docx)$/i, "").trim() || "Documento";
  const rawTags = String(formData.get("tags") ?? "").trim();
  const tags = rawTags
    ? rawTags.split(",").map((t) => t.trim()).filter(Boolean)
    : [];
  const source = kind === "pdf" ? "upload_pdf" : "upload_docx";

  // Extração de texto.
  let text: string;
  try {
    if (kind === "pdf") {
      text = await extractPlainText(buffer, PDF_MIME, {
        orgId: org.id,
        userId: effUserId,
      });
    } else {
      const { text: docxText } = await extractDocx(buffer);
      text = docxText;
    }
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : "Falha ao extrair o texto do documento.",
      },
      { status: 502 }
    );
  }

  if (!text || text.trim().length < 20) {
    return NextResponse.json(
      { error: "Não foi possível extrair texto suficiente do documento." },
      { status: 422 }
    );
  }

  let category: Category = explicitCategory ?? "clause";
  let classification: UploadClassification | null = null;

  if (!explicitCategory) {
    classification = await classifyKnowledgeUpload(text, file.name, {
      orgId: org.id,
      userId: effUserId,
    });

    if (classification.kind === "template" && !force) {
      // Nada é criado: um contrato inteiro no acervo vira uma "cláusula"
      // gigante e polui o RAG. A UI oferece o fluxo de modelos.
      return NextResponse.json(
        {
          code: "LOOKS_LIKE_TEMPLATE",
          error: "Isso parece um modelo de contrato completo.",
          reason: classification.reason,
          confidence: classification.confidence,
          suggestion:
            "Use “Importar modelos da imobiliária (.docx)” em Templates — o layout é preservado e a IA insere os campos variáveis. Se preferir guardar só como referência, envie assim mesmo para o acervo.",
        },
        { status: 409 }
      );
    }

    if (classification.kind === "template") {
      // force=true — o usuário insistiu; entra como modelo de referência.
      category = "model";
    } else if (classification.kind === "clauses") {
      const segments = segmentClauses(text);
      if (segments.length >= 2) {
        // TUDO OU NADA: os N itens nascem numa transação interativa. O loop solto
        // deixava as cláusulas 1..k-1 gravadas (e sem embedding, porque o lote só
        // sai no fim) quando a k-ésima falhava — e o retry do operador duplicava
        // as que já tinham entrado.
        let created: Array<{ id: string; title: string }>;
        let embedTargets: EmbedTarget[];
        try {
          ({ created, embedTargets } = await prisma.$transaction(
            async (tx) => {
              const rows: Array<{ id: string; title: string }> = [];
              const targets: EmbedTarget[] = [];
              for (const segment of segments) {
                const itemTitle = `${title} — ${segment.title}`.slice(0, 300);
                const row = await createKnowledgeItemRows(
                  {
                    orgId: org.id,
                    category: "clause",
                    title: itemTitle,
                    content: segment.content,
                    tags,
                    source,
                    createdBy: effUserId,
                  },
                  tx
                );
                rows.push({ id: row.parentId, title: itemTitle });
                targets.push(...row.embedTargets);
              }
              return { created: rows, embedTargets: targets };
            },
            // Um documento com dezenas de cláusulas estoura os 5s default.
            { timeout: 30_000, maxWait: 10_000 }
          ));
        } catch (err) {
          console.error("[knowledge/upload] ingestão de cláusulas falhou:", err);
          return NextResponse.json(
            {
              error:
                "Falha ao gravar as cláusulas — nada foi salvo. Tente enviar o documento novamente.",
            },
            { status: 500 }
          );
        }
        // Um único lote de embedding pros N itens (1 chamada ao Voyage). Fora da
        // transação: o Voyage é externo e não pode segurar conexão do pool.
        waitUntil(
          embedKnowledgeItem(embedTargets, { orgId: org.id, userId: effUserId })
        );
        return NextResponse.json(
          {
            id: created[0].id,
            title,
            category: "clause",
            mode: "clauses",
            items: created.length,
            clauses: created.map((c) => c.title),
            chunks: embedTargets.length,
            classification: {
              kind: classification.kind,
              confidence: classification.confidence,
              reason: classification.reason,
            },
          },
          { status: 201 }
        );
      }
      // Sem segmentos suficientes → cai no chunking por tamanho.
      category = "clause";
    } else {
      category = classification.suggestedCategory ?? "clause";
    }
  }

  // Mesma garantia do caminho de cláusulas: um documento longo vira parent +
  // N linhas-filhas, e uma falha no meio deixaria o parent sem os chunks.
  let parentId: string;
  let embedTargets: EmbedTarget[];
  try {
    ({ parentId, embedTargets } = await prisma.$transaction(
      (tx) =>
        createKnowledgeItemRows(
          {
            orgId: org.id,
            category,
            title,
            content: text,
            tags,
            source,
            createdBy: effUserId,
          },
          tx
        ),
      { timeout: 30_000, maxWait: 10_000 }
    ));
  } catch (err) {
    console.error("[knowledge/upload] ingestão falhou:", err);
    return NextResponse.json(
      {
        error:
          "Falha ao gravar o documento — nada foi salvo. Tente enviar novamente.",
      },
      { status: 500 }
    );
  }

  // Embedding best-effort em background — não segura a resposta no Voyage.
  waitUntil(embedKnowledgeItem(embedTargets, { orgId: org.id, userId: effUserId }));

  return NextResponse.json(
    {
      id: parentId,
      title,
      category,
      mode: "single",
      items: 1,
      chunks: embedTargets.length,
      ...(classification
        ? {
            classification: {
              kind: classification.kind,
              confidence: classification.confidence,
              reason: classification.reason,
            },
          }
        : {}),
    },
    { status: 201 }
  );
}
