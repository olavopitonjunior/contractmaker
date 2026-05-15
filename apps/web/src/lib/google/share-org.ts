import { prisma } from "@/lib/db/prisma";
import {
  envTrim,
  getOwnerDriveClient,
  getServiceAccountEmail,
  isOwnerOAuthConfigured,
} from "./client";

export interface ShareOrgResult {
  shared: string[];
  skipped: string[];
  failed: Array<{ email: string; error: string }>;
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

  const memberships = await prisma.orgMembership.findMany({
    where: { orgId, user: { deletedAt: null } },
    select: { user: { select: { email: true } } },
  });

  const ownerEmail = envTrim("GOOGLE_OWNER_EMAIL")?.toLowerCase() ?? null;
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

  const drive = getOwnerDriveClient();
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
