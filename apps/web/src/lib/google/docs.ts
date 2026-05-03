import {
  envTrim,
  getDocsClient,
  getDriveClient,
  getDriveFolderId,
  getOwnerDriveClient,
  getServiceAccountEmail,
  isOwnerOAuthConfigured,
} from "./client";

export interface CreateDocFromTemplateInput {
  templateDocId: string;
  name: string;
  /** Substituições `replaceAllText` aplicadas após a cópia. */
  replacements?: Record<string, string>;
  /** Pasta destino. Se omitido, usa GOOGLE_DRIVE_FOLDER_ID. */
  parentFolderId?: string;
  /** Emails que devem receber permissão de editor. */
  shareWith?: string[];
  /** dataJson original (com arrays). Usado para expandir blocos
   *  `[[REPEAT:fieldName]]...[[/REPEAT]]` antes do replaceAllText. */
  dataForLoops?: Record<string, unknown>;
}

export interface CreatedDoc {
  docId: string;
  webViewLink: string;
  embedLink: string;
}

/**
 * Cria um Google Doc copiando um doc-modelo, aplica substituições de placeholders
 * e (opcionalmente) compartilha com usuários. Retorna o id e os links.
 *
 * Sem Workspace, service accounts não têm Drive storage. Por isso a CÓPIA é
 * feita pelo owner OAuth (você), e logo em seguida o doc é compartilhado com
 * a SA como Editor. Todas as operações subsequentes (replaceAllText, comments,
 * export) usam a SA, que tem permissões mas não consome storage.
 */
export async function createDocFromTemplate(
  input: CreateDocFromTemplateInput
): Promise<CreatedDoc> {
  const docs = getDocsClient();

  // Sem owner OAuth o flow não funciona (SA não tem storage). Erro explícito.
  if (!isOwnerOAuthConfigured()) {
    throw new Error(
      "GOOGLE_OWNER_REFRESH_TOKEN não configurado. Rode `scripts/oauth-bootstrap.ts` para gerar."
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
    fileId: input.templateDocId,
    requestBody: {
      name: input.name,
      ...(parents ? { parents } : {}),
    },
    supportsAllDrives: true,
    fields: "id, webViewLink",
  });

  const docId = copy.data.id;
  if (!docId) throw new Error("Falha ao copiar template — Drive API não retornou id.");

  // Auto-share com SA como Editor para que ela possa fazer batchUpdate, etc.
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
      console.error("[createDocFromTemplate] Falha ao compartilhar com SA:", err);
    }
  }

  // Expansão de loops [[REPEAT:X]]...[[/REPEAT]] ANTES do replaceAllText final.
  if (input.dataForLoops) {
    const { expandLoops } = await import("./loops");
    try {
      await expandLoops(docId, input.dataForLoops);
    } catch (err) {
      console.error("[createDocFromTemplate] Falha ao expandir loops:", err);
    }
  }

  if (input.replacements && Object.keys(input.replacements).length > 0) {
    const requests = Object.entries(input.replacements).map(([key, value]) => ({
      replaceAllText: {
        containsText: { text: `{{${key}}}`, matchCase: true },
        replaceText: value,
      },
    }));
    await docs.documents.batchUpdate({
      documentId: docId,
      requestBody: { requests },
    });
  }

  // Cleanup de placeholders órfãos: campos opcionais (cônjuge, procurador, etc)
  // que o dataJson não cobriu. Lê doc, encontra `{{...}}` restantes, faz uma
  // segunda batch de replaceAllText limpando cada um com string vazia.
  try {
    const text = await getDocPlainText(docId);
    const orphans = Array.from(new Set(text.match(/\{\{[^{}\n]+\}\}/g) || []));
    if (orphans.length > 0) {
      await docs.documents.batchUpdate({
        documentId: docId,
        requestBody: {
          requests: orphans.map((orphan) => ({
            replaceAllText: {
              containsText: { text: orphan, matchCase: true },
              replaceText: "",
            },
          })),
        },
      });
    }
  } catch (err) {
    console.error("[createDocFromTemplate] Falha em cleanup de orphans:", err);
  }

  if (input.shareWith && input.shareWith.length > 0) {
    await Promise.all(
      input.shareWith.map((emailAddress) =>
        ownerDrive.permissions.create({
          fileId: docId,
          requestBody: { type: "user", role: "writer", emailAddress },
          sendNotificationEmail: false,
          supportsAllDrives: true,
        })
      )
    );
  }

  const webViewLink = copy.data.webViewLink || `https://docs.google.com/document/d/${docId}/edit`;
  const embedLink = `https://docs.google.com/document/d/${docId}/edit?embedded=true&rm=embedded`;

  return { docId, webViewLink, embedLink };
}

export interface DocPermission {
  id: string;
  email: string | null;
  role: "owner" | "writer" | "commenter" | "reader" | "fileOrganizer";
  displayName: string | null;
  type: "user" | "group" | "domain" | "anyone";
}

/**
 * Lista as permissões atuais do doc — usado pelo dialog de compartilhamento.
 * Filtra a SA (não interessa pro usuário) e o owner OAuth (gerenciado pelo app).
 */
export async function listDocPermissions(docId: string): Promise<DocPermission[]> {
  const drive = getDriveClient();
  const res = await drive.permissions.list({
    fileId: docId,
    fields: "permissions(id, role, type, emailAddress, displayName)",
    supportsAllDrives: true,
  });
  const saEmail = getServiceAccountEmail();
  const ownerEmail = envTrim("GOOGLE_OWNER_EMAIL");
  return (res.data.permissions || [])
    .filter((p) => {
      const e = (p.emailAddress || "").toLowerCase();
      if (saEmail && e === saEmail.toLowerCase()) return false;
      if (ownerEmail && e === ownerEmail.toLowerCase()) return false;
      return true;
    })
    .map((p) => ({
      id: p.id!,
      email: p.emailAddress || null,
      role: (p.role as DocPermission["role"]) || "reader",
      displayName: p.displayName || null,
      type: (p.type as DocPermission["type"]) || "user",
    }));
}

/**
 * Compartilha o doc com um email externo. Usa owner OAuth (não SA) porque a
 * SA não pode "share from" sem Workspace.
 */
export async function addDocPermission(
  docId: string,
  email: string,
  role: "writer" | "commenter" | "reader",
  options: { sendNotification?: boolean; message?: string } = {}
): Promise<DocPermission> {
  if (!isOwnerOAuthConfigured()) {
    throw new Error(
      "Owner OAuth não configurado — compartilhamento por email exige GOOGLE_OWNER_REFRESH_TOKEN."
    );
  }
  const ownerDrive = getOwnerDriveClient();
  const res = await ownerDrive.permissions.create({
    fileId: docId,
    requestBody: { type: "user", role, emailAddress: email },
    sendNotificationEmail: options.sendNotification ?? true,
    emailMessage: options.message,
    fields: "id, role, type, emailAddress, displayName",
    supportsAllDrives: true,
  });
  return {
    id: res.data.id!,
    email: res.data.emailAddress || email,
    role,
    displayName: res.data.displayName || null,
    type: "user",
  };
}

/** Remove uma permissão pelo permissionId (vindo de listDocPermissions). */
export async function removeDocPermission(docId: string, permissionId: string): Promise<void> {
  const drive = getDriveClient();
  await drive.permissions.delete({
    fileId: docId,
    permissionId,
    supportsAllDrives: true,
  });
}

/** Revoga permissões de escrita do doc, deixando apenas owner com write. */
export async function makeDocReadOnly(docId: string): Promise<void> {
  const drive = getDriveClient();
  const list = await drive.permissions.list({
    fileId: docId,
    fields: "permissions(id, role, type)",
    supportsAllDrives: true,
  });
  const writers = (list.data.permissions || []).filter(
    (p) => p.role === "writer" || p.role === "fileOrganizer"
  );
  await Promise.all(
    writers.map((p) =>
      drive.permissions.update({
        fileId: docId,
        permissionId: p.id!,
        requestBody: { role: "reader" },
        supportsAllDrives: true,
      })
    )
  );
}

/** Devolve o conteúdo do doc como texto plano (para análise passiva e quick checks). */
export async function getDocPlainText(docId: string): Promise<string> {
  const drive = getDriveClient();
  const res = await drive.files.export(
    { fileId: docId, mimeType: "text/plain" },
    { responseType: "text" }
  );
  return typeof res.data === "string" ? res.data : String(res.data);
}

/** Exporta como PDF — buffer pronto pra storage. */
export async function exportDocAsPdf(docId: string): Promise<Buffer> {
  const drive = getDriveClient();
  const res = await drive.files.export(
    { fileId: docId, mimeType: "application/pdf" },
    { responseType: "arraybuffer" }
  );
  return Buffer.from(res.data as ArrayBuffer);
}

/** Exporta como DOCX — buffer pronto pra storage. */
export async function exportDocAsDocx(docId: string): Promise<Buffer> {
  const drive = getDriveClient();
  const res = await drive.files.export(
    {
      fileId: docId,
      mimeType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    },
    { responseType: "arraybuffer" }
  );
  return Buffer.from(res.data as ArrayBuffer);
}

/** Aplica um batch de updates arbitrário (usado pelas AI tools). */
export async function batchUpdateDoc(
  docId: string,
  requests: import("googleapis").docs_v1.Schema$Request[]
) {
  const docs = getDocsClient();
  return docs.documents.batchUpdate({
    documentId: docId,
    requestBody: { requests },
  });
}

/** Recupera estrutura completa do doc (para resolver índices de texto antes de batchUpdate). */
export async function getDocStructure(docId: string) {
  const docs = getDocsClient();
  const res = await docs.documents.get({ documentId: docId });
  return res.data;
}
