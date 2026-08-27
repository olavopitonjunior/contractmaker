import { NextResponse } from "next/server";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { authorizeIngestion, blobPrefixForOrg } from "@/lib/ingestion/route-auth";

export const runtime = "nodejs";

const MAX_BYTES = 20 * 1024 * 1024;

/**
 * POST /api/templates/ingest/runs/blob-upload
 *
 * Handshake do upload client-direct pro Vercel Blob (`upload()` de
 * @vercel/blob/client). O navegador sobe cada arquivo DIRETO pro Blob — o corpo
 * de uma função serverless da Vercel para em ~4.5MB, e um acervo de imobiliária
 * são dezenas de DOCX/PDF de até 20MB. Nenhum byte passa por aqui.
 *
 * Só emite o token: valida sessão, papel, entitlement e o prefixo do pathname.
 * A criação do run e dos itens fica no POST das runs (`onUploadCompleted` não
 * dispara em localhost, então não serve pra persistência).
 */
export async function POST(request: Request): Promise<NextResponse> {
  const body = (await request.json()) as HandleUploadBody;

  try {
    const jsonResponse = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname) => {
        const authorized = await authorizeIngestion();
        // O handshake do @vercel/blob só sabe lançar; o catch abaixo traduz de
        // volta para o status HTTP.
        if (!authorized.ok) {
          const status = authorized.response.status;
          throw new Error(status === 401 ? "Unauthorized" : "Forbidden");
        }

        // O cliente escolhe o pathname; travar no prefixo da org impede gravar
        // (ou depois LER, na extração) no espaço de outro tenant.
        const prefix = blobPrefixForOrg(authorized.actor.orgId);
        if (!pathname.startsWith(prefix)) {
          throw new Error("pathname fora do escopo da imobiliária");
        }

        return {
          allowedContentTypes: [
            "application/pdf",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            // O browser manda octet-stream para DOCX renomeado/sem handler; o
            // formato de verdade é conferido pelo sniff do magic header na
            // extração, não pelo content-type declarado.
            "application/octet-stream",
          ],
          maximumSizeInBytes: MAX_BYTES,
          addRandomSuffix: true,
          tokenPayload: JSON.stringify({ orgId: authorized.actor.orgId }),
        };
      },
      // Não persiste aqui (não dispara em localhost). Ver POST /runs.
      onUploadCompleted: async () => {},
    });

    return NextResponse.json(jsonResponse);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Erro no upload";
    const status = msg === "Unauthorized" ? 401 : msg === "Forbidden" ? 403 : 400;
    return NextResponse.json({ error: msg }, { status });
  }
}
