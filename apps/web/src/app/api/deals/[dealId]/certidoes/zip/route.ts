import { NextRequest, NextResponse } from "next/server";
import JSZip from "jszip";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { downloadBufferFromUrl } from "@/lib/storage/s3";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * GET /api/deals/:dealId/certidoes/zip
 *
 * Packs every DealAttachment with source='infosimples' or
 * category='relatorio_certidoes' for the given deal into a ZIP file,
 * organized by target part (vendedor/comprador/imovel), and returns it as
 * an application/zip response. Used by the "Baixar todas" button.
 */
export async function GET(
  _req: NextRequest,
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

  const deal = await prisma.deal.findUnique({
    where: { id: params.dealId },
    include: {
      form: { select: { orgId: true } },
      // org via pipeline (form pode ser null em deal formless — IDOR)
      pipeline: { select: { orgId: true } },
      attachments: {
        where: {
          OR: [
            { source: "infosimples" },
            { category: "relatorio_certidoes" },
          ],
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!deal) {
    return NextResponse.json({ error: "Deal not found" }, { status: 404 });
  }
  if (deal.pipeline.orgId !== org.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (deal.attachments.length === 0) {
    return NextResponse.json(
      { error: "Nenhuma certidao disponivel para empacotar" },
      { status: 404 }
    );
  }

  const zip = new JSZip();

  const folderOf = (att: (typeof deal.attachments)[number]): string => {
    if (att.category === "relatorio_certidoes") return "";
    const extracted = att.extractedData as Record<string, unknown> | null;
    const assignment =
      (extracted?.assignment as { kind?: string; index?: number }) ?? null;
    return assignment?.kind
      ? `${assignment.kind}-${(assignment.index ?? 0) + 1}`
      : "outros";
  };

  // Dedupe: re-runs criam DealAttachments NOVOS com o mesmo filename (o job
  // antigo vira `replaced`, mas o anexo persiste). Sem dedupe, o zip ganha
  // entradas repetidas no mesmo caminho → leitores acusam "corrompido". Mantém
  // só o mais recente por (pasta, filename).
  const byKey = new Map<string, (typeof deal.attachments)[number]>();
  for (const att of deal.attachments) {
    const key = `${folderOf(att)}/${att.filename}`;
    const prev = byKey.get(key);
    if (!prev || att.createdAt > prev.createdAt) byKey.set(key, att);
  }

  const usedPaths = new Set<string>();
  for (const att of byKey.values()) {
    try {
      const raw = await downloadBufferFromUrl(att.url);
      const buffer = Buffer.from(raw);
      // Corrupção: alguns anexos baixam conteúdo não-PDF (blob expirado → HTML
      // de erro) ou vazio. Valida magic bytes %PDF para arquivos .pdf antes de
      // incluir; inválidos vão pra errors/ em vez de poluir as certidões boas.
      const expectsPdf =
        att.filename.toLowerCase().endsWith(".pdf") ||
        att.category === "relatorio_certidoes";
      const isPdf =
        buffer.length > 4 && buffer.subarray(0, 4).toString("latin1") === "%PDF";
      if (buffer.length === 0 || (expectsPdf && !isPdf)) {
        zip.file(
          `errors/${att.filename}.txt`,
          `Arquivo inválido (${buffer.length} bytes, não é PDF). Baixe pelo card individual ou re-extraia a certidão.`
        );
        continue;
      }
      const folder = folderOf(att);
      let filePath = folder ? `${folder}/${att.filename}` : att.filename;
      // Garante caminho único caso ainda colida após o dedupe.
      if (usedPaths.has(filePath)) {
        const dot = att.filename.lastIndexOf(".");
        const base = dot > 0 ? att.filename.slice(0, dot) : att.filename;
        const ext = dot > 0 ? att.filename.slice(dot) : "";
        let n = 2;
        const mk = (i: number) =>
          folder ? `${folder}/${base}-${i}${ext}` : `${base}-${i}${ext}`;
        while (usedPaths.has(mk(n))) n++;
        filePath = mk(n);
      }
      usedPaths.add(filePath);
      zip.file(filePath, buffer);
    } catch (err) {
      console.error("[zip] falha ao baixar attachment", att.id, err);
      zip.file(
        `errors/${att.filename}.txt`,
        `Falha ao baixar: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  const zipBuffer = await zip.generateAsync({ type: "nodebuffer" });
  const sanitizedTitle = deal.title.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 50);
  const filename = `certidoes_${sanitizedTitle}_${deal.id.slice(0, 6)}.zip`;

  return new NextResponse(new Uint8Array(zipBuffer), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
