import { NextResponse } from "next/server";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { resolveFormScope, formLockedResponse } from "@/lib/forms/resolve-form-scope";
import { formClosedResponse } from "@/lib/forms/form-gate";
import { RateLimits } from "@/lib/security/ratelimit";

export const runtime = "nodejs";

/** 20MB. Só é alcançável porque o navegador sobe DIRETO pro Blob — ver doc. */
const MAX_BYTES = 20 * 1024 * 1024;

const ALLOWED_MIMES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "application/pdf",
];

/**
 * POST /api/forms/:token/attachments/blob-upload  (PÚBLICO, sem session)
 *
 * Handshake do upload client-direct pro Vercel Blob. Existe pra remover um
 * limite que não era do produto e sim da plataforma: o POST clássico de
 * `../attachments` recebe o arquivo pelo CORPO da função, e a Vercel corta
 * corpo de função serverless em ~4.5MB — um PDF de 6MB morria com 413 opaco
 * antes de chegar na validação. Aqui o servidor só emite o token; os bytes vão
 * do navegador direto pro storage.
 *
 * A criação do FormAttachment fica no `/finalize` irmão (onUploadCompleted não
 * dispara em localhost, então não serve pra persistir). É lá também que rodam
 * as checagens que dependem do conteúdo — magic bytes inclusive.
 *
 * Sendo rota ANÔNIMA, o que trava o abuso:
 *  - o token do form tem que resolver, e o form não pode estar travado/enviado;
 *  - rate limit por token+IP (mesmo do POST clássico);
 *  - o pathname é preso ao prefixo `form-attachments/<formId>/`, senão daria
 *    pra gravar no espaço de outro formulário;
 *  - `allowedContentTypes` + `maximumSizeInBytes` são impostos pelo próprio
 *    Blob, não por confiança no cliente.
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
        const scope = await resolveFormScope(params.token);
        if (!scope) throw new Error("Form not found");

        const locked = formLockedResponse(scope);
        if (locked) throw new Error("Forbidden");
        const closed = await formClosedResponse(scope);
        if (closed) throw new Error("Forbidden");

        // Mesmo balde do POST clássico (`form-attach:<token>`, 40/h): os dois
        // caminhos criam anexo no mesmo formulário, então compartilhar o teto é
        // o certo — senão migrar de rota dobraria a cota na prática.
        const rl = await RateLimits.formAttachmentPerToken(params.token);
        if (!rl.success) throw new Error("Muitos uploads. Tente novamente.");

        // Prefixo genérico, não `form-attachments/<formId>/`: o cliente escolhe
        // o pathname ANTES de qualquer resposta do servidor, e ele não conhece
        // o formId — só o token, que é segredo e não pode ir parar numa URL de
        // blob pública e permanente. A posse é verificada no `/finalize`, que
        // recusa URL já referenciada por outro anexo; aqui basta impedir
        // gravação fora da árvore de formulários.
        if (!pathname.startsWith("form-attachments/")) {
          throw new Error("pathname fora do escopo de formulários");
        }

        return {
          allowedContentTypes: ALLOWED_MIMES,
          maximumSizeInBytes: MAX_BYTES,
          addRandomSuffix: true,
          tokenPayload: JSON.stringify({
            formId: scope.formId,
            orgId: scope.orgId,
            participantId: scope.participantId,
          }),
        };
      },
      onUploadCompleted: async () => {},
    });

    return NextResponse.json(jsonResponse);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Erro no upload";
    const status = msg === "Form not found" ? 404 : msg === "Forbidden" ? 403 : 400;
    return NextResponse.json({ error: msg }, { status });
  }
}
