import {
  getDriveFolderId,
  getOwnerDriveClient,
  getServiceAccountEmail,
  isOwnerOAuthConfigured,
} from "./client";
import { wrapAsCompleteHtml } from "./template-migration";

interface UploadInput {
  /** HTML já renderizado pelo Handlebars com dataJson real do contrato. */
  htmlContent: string;
  /** Nome visível do doc no Drive (ex: "Contrato {id} — v{version}"). */
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
 * Cria um Google Doc nativo a partir de HTML já renderizado e o compartilha
 * com a service account como editor.
 *
 * Por que owner OAuth e não a SA: service accounts sem Workspace não têm
 * storage próprio no Drive — quem cria o arquivo precisa ser um usuário
 * humano. Depois de criado, a SA recebe permissão de writer e roda todas as
 * operações subsequentes (batchUpdate, get, watch).
 *
 * Diferença para `migrateTemplateToGoogleDoc` em template-migration.ts: aqui
 * o HTML CHEGA pronto (renderizado por contrato com `renderContratoHTML`),
 * sem passar por `buildPlaceholderHtml`. Isso preserva loops com N iterações,
 * conditionals corretos e slots já consumidos por cláusulas pré-selecionadas.
 */
export async function uploadHtmlAsGoogleDoc(
  input: UploadInput
): Promise<UploadOutput> {
  if (!isOwnerOAuthConfigured()) {
    throw new Error(
      "GOOGLE_OWNER_REFRESH_TOKEN não configurado. Rode `scripts/oauth-bootstrap.ts`."
    );
  }

  const html = ensureCompleteHtml(input.htmlContent);
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
      mimeType: "text/html",
      body: html,
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
      console.error("[uploadHtmlAsGoogleDoc] Falha ao compartilhar com SA:", err);
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

function ensureCompleteHtml(body: string): string {
  const trimmed = body.trim();
  if (/^<!doctype/i.test(trimmed) || /^<html/i.test(trimmed)) {
    return trimmed;
  }
  return wrapAsCompleteHtml(trimmed);
}
