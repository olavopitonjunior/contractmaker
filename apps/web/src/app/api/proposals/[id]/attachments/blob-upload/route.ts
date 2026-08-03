import { NextResponse } from "next/server";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { PERMISSION } from "@/lib/security/rbac/permissions";
import { guardProposalScope } from "@/lib/proposals/route-helpers";

export const runtime = "nodejs";

const MAX_BYTES = 20 * 1024 * 1024;

/**
 * POST /api/proposals/:id/attachments/blob-upload
 *
 * Handshake do upload client-direct pro Vercel Blob, espelhando
 * `api/deals/[dealId]/attachments/blob-upload`. O navegador sobe o arquivo
 * DIRETO pro Blob, contornando o teto de 4,5MB de corpo de função serverless da
 * Vercel (subir MAX_BYTES no caminho antigo é fix falso — o limite é da
 * plataforma, não nosso).
 *
 * Só emite o token: valida sessão + escopo de org + prefixo do pathname. A
 * criação do ProposalAttachment fica em /finalize (onUploadCompleted não roda em
 * localhost, então não é confiável pra persistência).
 */
export async function POST(
  request: Request,
  { params }: { params: { id: string } }
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

        // Escopo (dono/responsável/gerente) + PROPOSAL_SEND — a MESMA decisão
        // que o /finalize aplica. Sem isto, qualquer membro da org emitiria
        // token de upload pra qualquer proposta dela, mesmo sem permissão:
        // o /finalize barraria o registro do anexo, mas o blob já teria sido
        // gravado. Aqui o handshake só sabe lançar — vira 403 no catch abaixo.
        const denied = await guardProposalScope({
          proposalId: params.id,
          userId: session.user.id,
          orgId: org.id,
          permission: PERMISSION.PROPOSAL_SEND,
        });
        if (denied) throw new Error(denied);

        // O cliente escolhe o pathname; trava no prefixo desta proposta pra
        // impedir gravar no espaço de outra.
        const prefix = `proposal-attachments/${params.id}/`;
        if (!pathname.startsWith(prefix)) {
          throw new Error("pathname fora do escopo da proposta");
        }

        return {
          maximumSizeInBytes: MAX_BYTES,
          addRandomSuffix: false,
          tokenPayload: JSON.stringify({ proposalId: params.id, orgId: org.id }),
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
