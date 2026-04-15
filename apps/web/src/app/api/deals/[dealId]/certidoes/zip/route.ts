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
  if (deal.form && deal.form.orgId !== org.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (deal.attachments.length === 0) {
    return NextResponse.json(
      { error: "Nenhuma certidao disponivel para empacotar" },
      { status: 404 }
    );
  }

  const zip = new JSZip();

  for (const att of deal.attachments) {
    try {
      const buffer = await downloadBufferFromUrl(att.url);
      // Determine folder: "relatorio" at root, others grouped by kind
      let folder = "outros";
      if (att.category === "relatorio_certidoes") {
        folder = "";
      } else {
        const extracted = att.extractedData as Record<string, unknown> | null;
        const assignment =
          (extracted?.assignment as { kind?: string; index?: number }) ?? null;
        if (assignment?.kind) {
          folder = `${assignment.kind}-${(assignment.index ?? 0) + 1}`;
        }
      }
      const filePath = folder ? `${folder}/${att.filename}` : att.filename;
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
