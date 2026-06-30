import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { downloadBufferFromUrl, deleteFromStorage } from "@/lib/storage/s3";
import { extractAuditContextFromRequest } from "@/lib/security/audit";
import { persistDealDocument } from "@/lib/deals/attachments";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_BYTES = 10 * 1024 * 1024;
const MIME_SHAPE = /^[\w.+-]+\/[\w.+-]+$/;

const bodySchema = z.object({
  url: z.string().url().max(2048),
  filename: z.string().min(1).max(255),
  mime: z.string().min(1).max(255).regex(MIME_SHAPE, "mime inválido"),
  category: z.string().max(120).optional(),
});

/**
 * POST /api/deals/:dealId/attachments/finalize
 *
 * Registra como DealAttachment um arquivo que o navegador já subiu DIRETO pro
 * Vercel Blob (via /blob-upload + @vercel/blob/client). Body é só metadados
 * (sem bytes) — não há risco do limite de 4.5MB. O buffer é baixado server-side
 * (fetch não é limitado) só para calcular o contentHash e deduplicar.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { dealId: string } }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const org = await getUserOrg(session.user.id);
  if (!org) {
    return NextResponse.json({ error: "No organization" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Bad Request", details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const { url, filename, mime, category } = parsed.data;

  const deal = await prisma.deal.findUnique({
    where: { id: params.dealId },
    select: { id: true, pipeline: { select: { orgId: true } } },
  });
  if (!deal) {
    return NextResponse.json({ error: "Deal not found" }, { status: 404 });
  }
  if (deal.pipeline.orgId !== org.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Validação de propriedade: só aceita URL do store Vercel Blob cujo pathname
  // pertence a ESTE deal. Impede registrar URL externa arbitrária (que seria
  // depois servida pelo proxy /file → SSRF/exfil) ou roubar pro outro deal.
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    return NextResponse.json({ error: "URL inválida" }, { status: 400 });
  }
  const isBlobHost = parsedUrl.hostname.endsWith(".blob.vercel-storage.com");
  const belongsToDeal = parsedUrl.pathname.includes(
    `deal-attachments/${params.dealId}/`
  );
  if (parsedUrl.protocol !== "https:" || !isBlobHost || !belongsToDeal) {
    return NextResponse.json(
      { error: "URL não pertence a este negócio" },
      { status: 403 }
    );
  }

  // Baixa o buffer (server-side; sem limite de body) pra contentHash + dedupe.
  let buffer: Buffer;
  try {
    buffer = await downloadBufferFromUrl(url);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `Falha ao ler o arquivo enviado: ${msg}` },
      { status: 502 }
    );
  }
  if (buffer.length === 0) {
    return NextResponse.json({ error: "Conteúdo vazio" }, { status: 400 });
  }
  if (buffer.length > MAX_BYTES) {
    // Defesa em profundidade — o handshake já cap'a, mas confirmamos.
    await deleteFromStorage(url);
    return NextResponse.json(
      { error: `Excede limite de ${MAX_BYTES / 1024 / 1024}MB` },
      { status: 413 }
    );
  }

  const { attachment, deduped } = await persistDealDocument({
    dealId: deal.id,
    buffer,
    url,
    filename,
    mime,
    category: category ?? null,
    source: "manual",
    auditCtx: extractAuditContextFromRequest(req, org.id, session.user.id),
  });

  // Se já existia o mesmo conteúdo, o blob que o cliente acabou de subir é uma
  // cópia redundante — remove pra não deixar órfão no storage.
  if (deduped && attachment.url !== url) {
    await deleteFromStorage(url);
  }

  return NextResponse.json(
    {
      id: attachment.id,
      filename: attachment.filename,
      mime: attachment.mime,
      url: attachment.url,
      category: attachment.category,
      createdAt: attachment.createdAt,
      deduped,
    },
    { status: deduped ? 200 : 201 }
  );
}
