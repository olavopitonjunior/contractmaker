import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { resolveUserOrgId } from "@/lib/security/org-scope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/files/attachments/[id]
 *
 * Download autenticado e escopado por org de um DealAttachment. Faz stream do
 * blob server-side (a URL do Vercel Blob nunca é entregue ao cliente), então
 * documentos sensíveis (RG/CPF, contratos, certidões) não circulam como URL
 * pública. Substitui o padrão antigo de expor `attachment.url` cru.
 *
 * Auth: sessão + mesma org do deal (via deal.pipeline.orgId). 404 cross-org.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const orgId = await resolveUserOrgId(session.user.id);
  if (!orgId) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const attachment = await prisma.dealAttachment.findUnique({
    where: { id: params.id },
    select: {
      filename: true,
      mime: true,
      url: true,
      deal: { select: { pipeline: { select: { orgId: true } } } },
    },
  });

  if (!attachment || attachment.deal.pipeline.orgId !== orgId) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // Stream do blob server-side. A URL fica no servidor; só os bytes vão pro
  // cliente, com headers de download e cache privado.
  let upstream: Response;
  try {
    upstream = await fetch(attachment.url);
  } catch {
    return NextResponse.json(
      { error: "Falha ao buscar o arquivo" },
      { status: 502 }
    );
  }
  if (!upstream.ok || !upstream.body) {
    return NextResponse.json(
      { error: `Arquivo indisponível (${upstream.status})` },
      { status: 502 }
    );
  }

  const filename = (attachment.filename || "arquivo").replace(/["\\\r\n]/g, "_");
  return new NextResponse(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": attachment.mime || "application/octet-stream",
      "Content-Disposition": `inline; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
