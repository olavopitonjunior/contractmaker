import { NextResponse } from "next/server";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { RateLimits } from "@/lib/security/ratelimit";
import {
  resolvePublicUploadScope,
  publicUploadDenialStatus,
  PUBLIC_UPLOAD_DENIAL_MESSAGE,
  PUBLIC_UPLOAD_MAX_BYTES,
  PUBLIC_UPLOAD_MIMES,
  PUBLIC_UPLOAD_BLOB_PREFIX,
  type PublicUploadDenial,
} from "@/lib/proposals/public-upload";
import { publicRequestIpHash } from "@/lib/proposals/public-request";

export const runtime = "nodejs";

class PublicUploadError extends Error {
  constructor(public readonly reason: PublicUploadDenial) {
    super(PUBLIC_UPLOAD_DENIAL_MESSAGE[reason]);
  }
}

/**
 * POST /api/public/proposals/:token/attachments/blob-upload  (PÚBLICO)
 *
 * Handshake do upload client-direct pro Vercel Blob para o LEAD, na página
 * `/p/[token]`. Espelho do `/api/forms/[token]/attachments/blob-upload`:
 *  - o token é a autenticação, e a proposta tem que estar aceitando documentos
 *    (`resolvePublicUploadScope`: status, validade, kind, feature);
 *  - rate limit por (token, ip);
 *  - prefixo GENÉRICO `proposal-attachments/public/` (ver `public-upload.ts`);
 *  - MIME e tamanho impostos pelo próprio Blob, não pelo cliente.
 * A criação do ProposalAttachment fica no `/finalize`, onde os bytes são
 * conferidos (magic bytes) depois de baixados do storage.
 */
export async function POST(
  request: Request,
  { params }: { params: { token: string } }
): Promise<NextResponse> {
  const body = (await request.json()) as HandleUploadBody;

  try {
    const jsonResponse = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname) => {
        const r = await resolvePublicUploadScope(params.token);
        if (!r.ok) throw new PublicUploadError(r.reason);

        const rl = await RateLimits.proposalAttachmentPerToken(
          params.token,
          publicRequestIpHash(request)
        );
        if (!rl.success) throw new Error("Muitos envios. Tente novamente mais tarde.");

        if (!pathname.startsWith(PUBLIC_UPLOAD_BLOB_PREFIX)) {
          throw new Error("pathname fora do escopo de documentos da proposta");
        }

        return {
          allowedContentTypes: PUBLIC_UPLOAD_MIMES,
          maximumSizeInBytes: PUBLIC_UPLOAD_MAX_BYTES,
          addRandomSuffix: true,
          tokenPayload: JSON.stringify({ proposalId: r.scope.proposalId, orgId: r.scope.orgId }),
        };
      },
      onUploadCompleted: async () => {},
    });

    return NextResponse.json(jsonResponse);
  } catch (err) {
    if (err instanceof PublicUploadError) {
      return NextResponse.json(
        { error: PUBLIC_UPLOAD_DENIAL_MESSAGE[err.reason] },
        { status: publicUploadDenialStatus(err.reason) }
      );
    }
    const msg = err instanceof Error ? err.message : "Erro no upload";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
