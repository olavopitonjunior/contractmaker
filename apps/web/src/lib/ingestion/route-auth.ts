/**
 * Auth compartilhada das rotas do pipeline de ingestão.
 *
 * As três rotas da Central (intake, advance, leitura) repetem exatamente a
 * mesma porta de entrada — sessão, org, papel owner/admin e entitlement. Ficar
 * copiando isso é como um desses guards silenciosamente diverge.
 */

import { NextResponse } from "next/server";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { getEffectiveUserId } from "@/lib/auth/impersonation";
import { prisma } from "@/lib/db/prisma";
import { IngestionDisabledError, assertIngestionEnabled } from "@/lib/ingestion/guard";

export interface IngestionActor {
  orgId: string;
  userId: string;
}

export type IngestionAuthResult =
  | { ok: true; actor: IngestionActor }
  | { ok: false; response: NextResponse };

/** Prefixo do Blob de um lote — o espaço em que ESTA org pode gravar. */
export function blobPrefixForOrg(orgId: string): string {
  return `ingestion/${orgId}/`;
}

/**
 * A URL aponta para o store do Vercel Blob, dentro do espaço desta org?
 *
 * Sem esta guarda, o intake aceitaria uma URL arbitrária e o EXECUTOR — que
 * roda sob cron, sem usuário na frente — faria o fetch dela: SSRF com um
 * atacante escolhendo o destino. O prefixo por org fecha a outra metade: uma
 * imobiliária não pode mandar o pipeline ler o acervo de outra.
 */
export function isOwnedBlobUrl(raw: string, orgId: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  return (
    url.protocol === "https:" &&
    url.hostname.endsWith(".blob.vercel-storage.com") &&
    url.pathname.replace(/^\/+/, "").startsWith(blobPrefixForOrg(orgId))
  );
}

export async function authorizeIngestion(): Promise<IngestionAuthResult> {
  const session = await auth();
  if (!session?.user) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }
  const org = await getUserOrg(session.user.id);
  if (!org) {
    return {
      ok: false,
      response: NextResponse.json({ error: "No organization" }, { status: 400 }),
    };
  }

  // Id efetivo (owner impersonado sob "testar como"; senão o próprio usuário).
  const userId = await getEffectiveUserId(session.user.id);
  const membership = await prisma.orgMembership.findFirst({
    where: { userId, orgId: org.id },
    select: { role: true },
  });
  if (!membership || !["owner", "admin"].includes(membership.role)) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Apenas owner/admin podem ingerir o acervo da imobiliária." },
        { status: 403 }
      ),
    };
  }

  try {
    await assertIngestionEnabled(org.id);
  } catch (err) {
    if (err instanceof IngestionDisabledError) {
      return {
        ok: false,
        response: NextResponse.json(
          { error: err.message, code: err.code },
          { status: err.status }
        ),
      };
    }
    throw err;
  }

  return { ok: true, actor: { orgId: org.id, userId } };
}
