import { getServiceAccountEmail, isOwnerOAuthConfigured } from "./client";
import { ensureAnyonePermission } from "./share-org";
import {
  withOwnerAuth,
  getOwnerDriveForAuth,
  resolveDriveParent,
} from "./org-oauth";

interface CopyInput {
  /** Drive file id do doc fonte. */
  sourceDocId: string;
  /** Nome visível do novo doc no Drive. */
  name: string;
  /** Pasta de destino (default: pasta da org conectada ou GOOGLE_DRIVE_FOLDER_ID). */
  parentFolderId?: string;
  /** Org dona do doc — usa a conta Google conectada da org quando houver
   *  (fallback: owner OAuth global). */
  orgId?: string;
}

interface CopyOutput {
  docId: string;
  webViewLink: string;
  embedLink: string;
}

/**
 * Copia um Google Doc nativo via owner OAuth (da org quando conectada) e
 * compartilha a cópia com a service account como editor. Usado para
 * versionar contratos e para gerar contratos a partir de templates
 * engine="google_docs": cada cópia preserva 100% do layout do doc fonte
 * (papel timbrado, logo no header, fontes).
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

  return withOwnerAuth(input.orgId, async (resolved) => {
    const ownerDrive = getOwnerDriveForAuth(resolved);

    const parent = input.parentFolderId ?? (await resolveDriveParent(resolved));
    const parents = parent ? [parent] : undefined;

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
    if (saEmail && resolved.accountEmail?.toLowerCase() !== saEmail.toLowerCase()) {
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

    await ensureAnyonePermission(docId, "writer", input.orgId);

    const webViewLink =
      copy.data.webViewLink || `https://docs.google.com/document/d/${docId}/edit`;

    return {
      docId,
      webViewLink,
      embedLink: `https://docs.google.com/document/d/${docId}/edit?embedded=true&rm=embedded`,
    };
  });
}
