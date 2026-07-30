import { NextRequest, NextResponse } from "next/server";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { downloadBufferFromUrl } from "@/lib/storage/s3";
import { guardDealScope } from "@/lib/deals/route-helpers";

export const runtime = "nodejs";

export async function GET(
  req: NextRequest,
  { params }: { params: { dealId: string; attachmentId: string } }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const org = await getUserOrg(session.user.id);
  if (!org) {
    return NextResponse.json({ error: "No organization" }, { status: 400 });
  }

  const attachment = await prisma.dealAttachment.findUnique({
    where: { id: params.attachmentId },
    include: {
      deal: {
        include: {
          form: { select: { orgId: true } },
          // org via pipeline (form pode ser null em deal formless — IDOR)
          pipeline: { select: { orgId: true } },
        },
      },
    },
  });
  if (!attachment || attachment.dealId !== params.dealId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (attachment.deal.pipeline.orgId !== org.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Escopo do gerente — o proxy serve o binário do documento (RG/CNH/matrícula).
  const denied = await guardDealScope({
    dealId: params.dealId,
    userId: session.user.id,
    orgId: org.id,
  });
  if (denied) return denied;

  try {
    const buffer = await downloadBufferFromUrl(attachment.url);
    const { searchParams } = new URL(req.url);
    const forceDownload = searchParams.get("download") === "1";
    const disposition = forceDownload ? "attachment" : "inline";
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": attachment.mime,
        "Content-Disposition": `${disposition}; filename="${attachment.filename}"`,
      },
    });
  } catch (err) {
    console.error("[attachments] download failed", err);
    // Objeto removido do storage (ex.: órfão de delete que apagava blob
    // compartilhado) → 404 claro "arquivo indisponível / reenvie"; transitório → 500.
    const { storageDownloadErrorResponse } = await import(
      "@/lib/storage/download-error"
    );
    return storageDownloadErrorResponse(err);
  }
}
