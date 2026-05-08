import { Readable } from "stream";
import {
  getDriveFolderId,
  getOwnerDriveClient,
  getServiceAccountEmail,
  isOwnerOAuthConfigured,
} from "./client";

/**
 * Mime types aceitos pra conversão automática Drive → Google Doc nativo.
 * Drive aceita também RTF/ODT/HTML, mas mantemos só PDF + DOCX porque são os
 * únicos formatos suportados pelo dropzone do cadastro rápido.
 */
export type ImportableMime =
  | "application/pdf"
  | "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

interface UploadInput {
  /** Conteúdo binário do arquivo original (PDF ou DOCX). */
  buffer: Buffer;
  /** Mime do arquivo de origem — Drive usa pra decidir como converter. */
  sourceMime: ImportableMime;
  /** Nome visível do doc no Drive. */
  name: string;
  /** Pasta no Drive (default: GOOGLE_DRIVE_FOLDER_ID). */
  parentFolderId?: string;
}

interface UploadOutput {
  docId: string;
  webViewLink: string;
  /** URL pronta para iframe embedded no editor da app. */
  embedLink: string;
}

/**
 * Importa um PDF/DOCX como Google Doc nativo, preservando o layout original.
 *
 * Como funciona a conversão:
 *   - `requestBody.mimeType: "application/vnd.google-apps.document"` instrui
 *     o Drive a criar um Doc nativo (não um arquivo de upload bruto).
 *   - `media.mimeType: <ImportableMime>` declara o formato do binário enviado.
 *   - O Drive faz a conversão server-side (incluindo OCR pra PDFs digitalizados).
 *
 * Por que owner OAuth e não a SA: idêntico ao `uploadHtmlAsGoogleDoc` —
 * service accounts sem Workspace não têm storage no Drive. Owner cria,
 * compartilha com SA, SA opera daí em diante.
 *
 * Importante: NÃO aplica `DocumentStyle` da org. O contrato importado vem
 * do mundo externo (escritório do corretor, advogado, etc.) e tem layout
 * próprio que o usuário quer preservar — reaplicar o preset Zimmermann
 * sobrescreveria fonts, margens e alinhamento do contrato original. Quem
 * chama esse helper assume essa decisão.
 */
export async function uploadFileAsGoogleDoc(
  input: UploadInput
): Promise<UploadOutput> {
  if (!isOwnerOAuthConfigured()) {
    throw new Error(
      "GOOGLE_OWNER_REFRESH_TOKEN não configurado. Rode `scripts/oauth-bootstrap.ts`."
    );
  }

  if (input.buffer.length === 0) {
    throw new Error("Arquivo vazio.");
  }

  const drive = getOwnerDriveClient();

  const parents = input.parentFolderId
    ? [input.parentFolderId]
    : (() => {
        const f = getDriveFolderId();
        return f ? [f] : undefined;
      })();

  const created = await drive.files.create({
    requestBody: {
      name: input.name,
      mimeType: "application/vnd.google-apps.document",
      ...(parents ? { parents } : {}),
    },
    media: {
      mimeType: input.sourceMime,
      body: Readable.from(input.buffer),
    },
    fields: "id, webViewLink",
    supportsAllDrives: true,
  });

  const id = created.data.id;
  if (!id) throw new Error("Drive não retornou id do doc criado.");

  const saEmail = getServiceAccountEmail();
  if (saEmail) {
    try {
      await drive.permissions.create({
        fileId: id,
        requestBody: { type: "user", role: "writer", emailAddress: saEmail },
        sendNotificationEmail: false,
        supportsAllDrives: true,
      });
    } catch (err) {
      console.error("[uploadFileAsGoogleDoc] Falha ao compartilhar com SA:", err);
    }
  }

  const webViewLink =
    created.data.webViewLink || `https://docs.google.com/document/d/${id}/edit`;

  return {
    docId: id,
    webViewLink,
    embedLink: `https://docs.google.com/document/d/${id}/edit?embedded=true&rm=embedded`,
  };
}
