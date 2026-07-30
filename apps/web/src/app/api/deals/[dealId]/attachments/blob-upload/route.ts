import { NextResponse } from "next/server";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";

export const runtime = "nodejs";

const MAX_BYTES = 20 * 1024 * 1024;

/**
 * POST /api/deals/:dealId/attachments/blob-upload
 *
 * Handshake do upload client-direct pro Vercel Blob (@vercel/blob/client
 * `upload()`). O navegador sobe o arquivo DIRETO pro Blob, contornando o limite
 * de 4.5MB de corpo de função serverless da Vercel — que era a causa do "falha
 * no upload" para PDFs/imagens > ~3.3MB (base64 inflado no caminho antigo).
 *
 * Só emite o token: valida auth de sessão + cross-org + prefixo do pathname. A
 * criação do DealAttachment fica na rota /finalize (onUploadCompleted não roda
 * em localhost, então não é confiável pra persistência).
 */
export async function POST(
  request: Request,
  { params }: { params: { dealId: string } }
): Promise<NextResponse> {
  const body = (await request.json()) as HandleUploadBody;

  try {
    const jsonResponse = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname) => {
        const session = await auth();
        if (!session?.user) throw new Error("Unauthorized");
        const org = await getUserOrg(session.user.id);
        if (!org) throw new Error("No organization");

        const deal = await prisma.deal.findUnique({
          where: { id: params.dealId },
          select: { id: true, pipeline: { select: { orgId: true } } },
        });
        if (!deal) throw new Error("Deal not found");
        if (deal.pipeline.orgId !== org.id) throw new Error("Forbidden");

        // O cliente escolhe o pathname; trava no prefixo deste deal pra impedir
        // gravar no espaço de outro deal.
        const prefix = `deal-attachments/${params.dealId}/`;
        if (!pathname.startsWith(prefix)) {
          throw new Error("pathname fora do escopo do deal");
        }

        return {
          // Mantém "qualquer tipo" (a pasta guarda contratos, planilhas, etc.).
          maximumSizeInBytes: MAX_BYTES,
          addRandomSuffix: false,
          tokenPayload: JSON.stringify({ dealId: params.dealId, orgId: org.id }),
        };
      },
      // Não persiste aqui (não dispara em localhost). Ver /finalize.
      onUploadCompleted: async () => {},
    });

    return NextResponse.json(jsonResponse);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Erro no upload";
    const status =
      msg === "Unauthorized" ? 401 : msg === "Forbidden" ? 403 : 400;
    return NextResponse.json({ error: msg }, { status });
  }
}
