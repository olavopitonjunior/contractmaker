/**
 * Ingestão de documento na base de conhecimento da PLATAFORMA.
 *
 * Espelha `/api/knowledge/upload`, com três diferenças deliberadas:
 *
 *  1. Gate `super_admin` — o item vai pra base que todo tenant lê.
 *  2. `category` é OBRIGATÓRIA. A rota do tenant classifica o texto com LLM
 *     quando a categoria não vem, porque lá quem sobe é corretor. Aqui quem
 *     sobe é quem cura a base universal e sabe o que está publicando; adivinhar
 *     seria gastar token pra introduzir incerteza num conteúdo que não pode
 *     ter.
 *  3. Sem dedup por org e sem o guard "isto parece um modelo de contrato" —
 *     ambos são heurísticas do fluxo do tenant.
 *
 * O embedding sai por `waitUntil`: a chamada ao Voyage não pode segurar a
 * resposta, e item sem vetor continua pesquisável via ILIKE.
 */

import { NextRequest, NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { z } from "zod";
import { auth } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { requirePlatform } from "@/lib/admin/gate";
import { createKnowledgeItemRows, embedKnowledgeItem } from "@/lib/ai/knowledge";
import { extractPlainText } from "@/lib/ai/ocr";
import { extractDocx } from "@/lib/extraction/docx";
import {
  sniffDocument,
  PDF_MIME,
  MAX_UPLOAD_BYTES,
} from "@/lib/knowledge/upload-sniff";
import { AGENT_KEYS } from "@/lib/ai/agents/registry";
import { audit, extractAuditContextFromRequest } from "@/lib/security/audit";

export const runtime = "nodejs";
export const maxDuration = 120;

const categorySchema = z.enum(["legislation", "model", "rule", "glossary", "clause"]);

export async function POST(req: NextRequest) {
  const session = await auth();
  const g = await requirePlatform(session?.user?.id, "super_admin");
  if (!g.ok) return g.res;

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: "Corpo inválido (esperado multipart)" }, { status: 400 });
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Arquivo obrigatório" }, { status: 400 });
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: "Arquivo maior que o limite" }, { status: 413 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const kind = sniffDocument(buffer);
  if (!kind) {
    return NextResponse.json(
      { error: "Formato não reconhecido — envie PDF ou DOCX." },
      { status: 415 }
    );
  }

  const parsedCategory = categorySchema.safeParse(formData.get("category"));
  if (!parsedCategory.success) {
    return NextResponse.json(
      { error: "Categoria obrigatória e precisa ser uma das conhecidas." },
      { status: 422 }
    );
  }
  const category = parsedCategory.data;

  const rawTitle = String(formData.get("title") ?? "").trim();
  const title =
    rawTitle || file.name.replace(/\.(pdf|docx)$/i, "").trim() || "Documento";
  const rawTags = String(formData.get("tags") ?? "").trim();
  const tags = rawTags ? rawTags.split(",").map((t) => t.trim()).filter(Boolean) : [];

  const rawVisible = String(formData.get("visibleToAgents") ?? "").trim();
  const visibleToAgents = rawVisible
    ? rawVisible
        .split(",")
        .map((t) => t.trim())
        .filter((t): t is (typeof AGENT_KEYS)[number] =>
          (AGENT_KEYS as readonly string[]).includes(t)
        )
    : [];

  let text: string;
  try {
    if (kind === "pdf") {
      // Sem `orgId` pra atribuir: item de plataforma não pertence a tenant
      // nenhum e `AIUsage.orgId` é NOT NULL. Custo do OCR fica invisível no
      // painel — limitação conhecida, endereçada quando AIUsage aceitar org nula.
      text = await extractPlainText(buffer, PDF_MIME);
    } else {
      const { text: docxText } = await extractDocx(buffer);
      text = docxText;
    }
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Falha ao extrair o texto." },
      { status: 502 }
    );
  }

  if (!text || text.trim().length < 20) {
    return NextResponse.json(
      { error: "Não foi possível extrair texto suficiente do documento." },
      { status: 422 }
    );
  }

  const { parentId, embedTargets } = await createKnowledgeItemRows({
    orgId: null,
    allowPlatformScope: true,
    category,
    title,
    content: text,
    tags,
    visibleToAgents,
    source: kind === "pdf" ? "upload_pdf" : "upload_docx",
    createdBy: session!.user!.id,
  });

  await audit(
    { ...extractAuditContextFromRequest(req, "", session!.user!.id), orgId: null },
    {
      action: "PLATFORM_KNOWLEDGE_CREATE",
      result: "SUCCESS",
      resourceType: "KnowledgeItem",
      resource: parentId,
      metadata: { category, title, via: "upload", chunks: embedTargets.length },
    }
  ).catch(() => {});

  waitUntil(embedKnowledgeItem(embedTargets, { orgId: null }));

  return NextResponse.json(
    { id: parentId, chunks: embedTargets.length, category, title },
    { status: 201 }
  );
}

/** Quantos tenants passam a ler o que for publicado aqui — ver `page.tsx`. */
export async function GET() {
  const session = await auth();
  const g = await requirePlatform(session?.user?.id, "support");
  if (!g.ok) return g.res;
  const orgs = await prisma.organization.count();
  return NextResponse.json({ orgs });
}
