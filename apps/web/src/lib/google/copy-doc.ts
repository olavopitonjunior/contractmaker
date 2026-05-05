import {
  getDriveFolderId,
  getOwnerDriveClient,
  getServiceAccountEmail,
  isOwnerOAuthConfigured,
} from "./client";

interface CopyInput {
  /** Drive file id do doc fonte. */
  sourceDocId: string;
  /** Nome visível do novo doc no Drive. */
  name: string;
  /** Pasta de destino (default: GOOGLE_DRIVE_FOLDER_ID). */
  parentFolderId?: string;
}

interface CopyOutput {
  docId: string;
  webViewLink: string;
  embedLink: string;
}

/**
 * Copia um Google Doc nativo via owner OAuth e compartilha a cópia com a
 * service account como editor. Usado para versionar contratos: cada nova
 * versão recebe seu próprio doc no Drive, preservando o original como
 * histórico imutável (a versão anterior fica com `isLatest=false`).
 *
 * Diferença para `createDocFromTemplate`: não roda placeholders nem
 * batchUpdates — é uma cópia bit-a-bit do estado atual do doc fonte.
 */
export async function copyContractGoogleDoc(
  input: CopyInput
): Promise<CopyOutput> {
  if (!isOwnerOAuthConfigured()) {
    throw new Error(
      "GOOGLE_OWNER_REFRESH_TOKEN não configurado. Rode `scripts/oauth-bootstrap.ts`."
    );
  }
  const ownerDrive = getOwnerDriveClient();

  const parents = input.parentFolderId
    ? [input.parentFolderId]
    : (() => {
        const f = getDriveFolderId();
        return f ? [f] : undefined;
      })();

  const copy = await ownerDrive.files.copy({
    fileId: input.sourceDocId,
    requestBody: {
      name: input.name,
      ...(parents ? { parents } : {}),
    },
    supportsAllDrives: true,
    fields: "id, webViewLink",
  });

  const docId = copy.data.id;
  if (!docId) {
    throw new Error("Drive não retornou id da cópia.");
  }

  const saEmail = getServiceAccountEmail();
  if (saEmail) {
    try {
      await ownerDrive.permissions.create({
        fileId: docId,
        requestBody: { type: "user", role: "writer", emailAddress: saEmail },
        sendNotificationEmail: false,
        supportsAllDrives: true,
      });
    } catch (err) {
      console.error("[copyContractGoogleDoc] Falha ao compartilhar com SA:", err);
    }
  }

  const webViewLink =
    copy.data.webViewLink || `https://docs.google.com/document/d/${docId}/edit`;

  return {
    docId,
    webViewLink,
    embedLink: `https://docs.google.com/document/d/${docId}/edit?embedded=true&rm=embedded`,
  };
}
