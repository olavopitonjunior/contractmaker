import { NextResponse } from "next/server";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { prisma } from "@/lib/db/prisma";
import { PERMISSION } from "@/lib/security/rbac/permissions";
import { ensureLocacaoAccess, isRouteError } from "@/lib/locacao/route-helpers";
import { isInspectionContentEditable } from "@/lib/locacao/inspection-types";

export const runtime = "nodejs";

const MAX_BYTES = 20 * 1024 * 1024;

/**
 * POST /api/locacao/inspections/[id]/laudo/blob-upload
 *
 * Handshake do upload client-direct do laudo externo pro Vercel Blob
 * (@vercel/blob/client `upload()`), contornando o limite de ~4.5MB de corpo de
 * função serverless — laudo com fotos passa fácil disso. Só emite o token; o
 * registro (validação de conteúdo + mutação da vistoria) fica em ../upload.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const ctx = await ensureLocacaoAccess(PERMISSION.INSPECTION_EXECUTE);
  if (isRouteError(ctx)) return ctx;
  const { id } = await params;

  const inspection = await prisma.inspection.findFirst({
    where: { id, orgId: ctx.orgId },
    select: { id: true, status: true },
  });
  if (!inspection) {
    return NextResponse.json({ error: "Vistoria não encontrada" }, { status: 404 });
  }
  if (!isInspectionContentEditable(inspection.status)) {
    return NextResponse.json(
      { error: `Laudo em "${inspection.status}" não pode ser substituído.` },
      { status: 422 }
    );
  }

  const body = (await request.json()) as HandleUploadBody;
  try {
    const jsonResponse = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname) => {
        const prefix = `inspections/${id}/laudo-externo/`;
        if (!pathname.startsWith(prefix)) {
          throw new Error("pathname fora do escopo desta vistoria");
        }
        return {
          allowedContentTypes: ["application/pdf"],
          maximumSizeInBytes: MAX_BYTES,
          addRandomSuffix: true,
          tokenPayload: JSON.stringify({ inspectionId: id, orgId: ctx.orgId }),
        };
      },
      // Não persiste aqui (não dispara em localhost). Ver ../upload.
      onUploadCompleted: async () => {},
    });
    return NextResponse.json(jsonResponse);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Erro no upload";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
