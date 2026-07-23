import { prisma } from "@/lib/db/prisma";
import {
  envTrim,
  getServiceAccountEmail,
  isOwnerOAuthConfigured,
} from "./client";
import { resolveOwnerAuth, getOwnerDriveForAuth } from "./org-oauth";
import { markProgrammaticDocEdit } from "./doc-edit-marker";

export interface ShareOrgResult {
  shared: string[];
  skipped: string[];
  failed: Array<{ email: string; error: string }>;
}

/**
 * Garante que o doc tenha permission `{ type: "anyone", role }` no Drive.
 *
 * Por que existe: o iframe Google Docs sempre autentica com a conta Google
 * ativa do browser. Se o user logado na app tem outra conta Google ativa
 * no Chrome (caso comum: várias contas), o iframe mostra "Solicitar acesso"
 * mesmo com NextAuth válido. Anyone-link elimina essa dependência — qualquer
 * um com a URL do doc edita/visualiza direto, sem precisar de conta Google.
 *
 * Segurança: a URL do doc só é entregue ao client após `auth()` validar a
 * sessão NextAuth. Não aparece em rotas públicas. Para contratos aprovados,
 * usar `role: "reader"` (chamada no approve-action). SA e owner OAuth
 * continuam editando via API independentemente.
 *
 * Idempotente: lista permissions e atualiza a anyone existente in-place;
 * cria nova se não houver. `allowFileDiscovery: false` mantém o doc oculto
 * de buscas públicas — só quem tem a URL exata acessa.
 * Best-effort: nunca lança — falha vai pro console.
 */
export async function ensureAnyonePermission(
  docId: string,
  role: "writer" | "reader",
  orgId?: string
): Promise<void> {
  if (!isOwnerOAuthConfigured()) {
    console.error(
      "[ensureAnyonePermission] Owner OAuth não configurado — skip anyone share."
    );
    return;
  }
  try {
    // Mudança de permissão dispara "update" no watch sem mudar conteúdo — marca
    // como programática pro webhook não registrar edição manual fantasma.
    void markProgrammaticDocEdit(docId);
    // Permissions são criadas pelo DONO do arquivo: docs criados na conta da
    // org precisam da credencial da org (a global não tem acesso a eles).
    const drive = getOwnerDriveForAuth(await resolveOwnerAuth(orgId));
    const existing = await drive.permissions.list({
      fileId: docId,
      fields: "permissions(id, type, role)",
      supportsAllDrives: true,
    });
    const anyone = existing.data.permissions?.find((p) => p.type === "anyone");
    if (anyone?.id) {
      if (anyone.role === role) return;
      await drive.permissions.update({
        fileId: docId,
        permissionId: anyone.id,
        requestBody: { role },
        supportsAllDrives: true,
      });
      return;
    }
    await drive.permissions.create({
      fileId: docId,
      requestBody: { type: "anyone", role, allowFileDiscovery: false },
      supportsAllDrives: true,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(
      `[ensureAnyonePermission] Falha ao setar anyone=${role} em ${docId}: ${msg.slice(0, 200)}`
    );
  }
}

/**
 * Concede `writer` no GDoc pra todos os membros ativos da org.
 *
 * Por que existe: o pipeline de upload (`uploadHtmlAsGoogleDoc`,
 * `uploadFileAsGoogleDoc`, `copyContractGoogleDoc`) cria o arquivo com o owner
 * OAuth (Olavo) e só compartilha com a Service Account. Sem essa chamada, qualquer
 * outro membro da org abre o iframe e vê "Solicitar acesso" — o Drive autentica
 * direto contra a conta Google do usuário, fora da sessão NextAuth.
 *
 * Filtros:
 *  - users com deletedAt (soft delete LGPD)
 *  - email vazio/null
 *  - email do owner (já é owner do file no Drive — Drive rejeita duplicata)
 *  - email da SA (já adicionada pelo uploader)
 *
 * Idempotente: rodar 2x não quebra. Drive aceita re-share do mesmo email.
 * Falha individual não bloqueia os outros (Promise.allSettled).
 * Função nunca lança — falhas vão pro console.
 */
export async function shareDocWithOrgMembers(
  docId: string,
  orgId: string
): Promise<ShareOrgResult> {
  const result: ShareOrgResult = { shared: [], skipped: [], failed: [] };

  if (!isOwnerOAuthConfigured()) {
    console.error(
      "[share-org] Owner OAuth não configurado — skip share com org members."
    );
    return result;
  }

  // Grants de permissão disparam "update" no watch sem mudar conteúdo — marca
  // como programática (fecha o "Manual" fantasma em contrato recém-gerado).
  void markProgrammaticDocEdit(docId);

  const memberships = await prisma.orgMembership.findMany({
    where: { orgId, user: { deletedAt: null } },
    select: { user: { select: { email: true } } },
  });

  const resolved = await resolveOwnerAuth(orgId);
  const ownerEmail =
    (resolved.source === "org"
      ? resolved.accountEmail?.toLowerCase()
      : envTrim("GOOGLE_OWNER_EMAIL")?.toLowerCase()) ?? null;
  const saEmail = getServiceAccountEmail()?.toLowerCase() ?? null;

  const targets = new Set<string>();
  for (const m of memberships) {
    const email = m.user.email?.trim();
    if (!email) {
      result.skipped.push("(empty)");
      continue;
    }
    const lower = email.toLowerCase();
    if (lower === ownerEmail || lower === saEmail) {
      result.skipped.push(email);
      continue;
    }
    targets.add(email);
  }

  if (targets.size === 0) return result;

  const drive = getOwnerDriveForAuth(resolved);
  const outcomes = await Promise.allSettled(
    Array.from(targets).map(async (email) => {
      await drive.permissions.create({
        fileId: docId,
        requestBody: { type: "user", role: "writer", emailAddress: email },
        sendNotificationEmail: false,
        supportsAllDrives: true,
      });
      return email;
    })
  );

  outcomes.forEach((outcome, idx) => {
    const email = Array.from(targets)[idx]!;
    if (outcome.status === "fulfilled") {
      result.shared.push(email);
    } else {
      const msg =
        outcome.reason instanceof Error
          ? outcome.reason.message
          : String(outcome.reason);
      result.failed.push({ email, error: msg.slice(0, 200) });
      const masked = email.replace(/(.).+(@.+)/, "$1***$2");
      console.error(`[share-org] Falha ao compartilhar com ${masked}: ${msg}`);
    }
  });

  return result;
}
