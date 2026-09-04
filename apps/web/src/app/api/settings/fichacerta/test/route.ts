import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { requireFichaCertaAdmin } from "@/lib/fichacerta/settings-guard";
import { getOrgFichaCertaCreds } from "@/lib/fichacerta/account";
import { getCredits, listWebhooks } from "@/lib/fichacerta/client";
import { FichaCertaError } from "@/lib/fichacerta/types";

export const runtime = "nodejs";

/**
 * POST — "Testar conexão": bate em `GET /credits` com a credencial da org e
 * confere se o webhook cadastrado lá aponta para o nosso endpoint. Atualiza
 * `lastValidatedAt`/`lastError`/`status` na conta.
 */
export async function POST() {
  const gate = await requireFichaCertaAdmin();
  if (!gate.ok) return gate.response;
  const { orgId } = gate.ctx;

  const creds = await getOrgFichaCertaCreds(orgId);
  if (!creds) {
    return NextResponse.json({ error: "Conta Ficha Certa não conectada." }, { status: 404 });
  }
  const account = await prisma.fichaCertaAccount.findUnique({ where: { orgId } });

  try {
    const credits = await getCredits(creds);
    let webhookMatches: boolean | null = null;
    try {
      const rows = await listWebhooks(creds);
      const slug = account?.webhookSlug ?? "";
      webhookMatches = rows.some((r) => typeof r.endpoint === "string" && r.endpoint.includes(`/fichacerta/${slug}`));
    } catch {
      webhookMatches = null;
    }
    await prisma.fichaCertaAccount.update({
      where: { orgId },
      data: { lastValidatedAt: new Date(), lastError: null, status: "connected" },
    });
    return NextResponse.json({ ok: true, credits, webhookMatches });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const status = err instanceof FichaCertaError ? err.status : 0;
    await prisma.fichaCertaAccount
      .update({
        where: { orgId },
        data: { lastError: msg.slice(0, 500), status: status === 401 || status === 403 ? "error" : "connected" },
      })
      .catch(() => {});
    return NextResponse.json({ ok: false, error: msg, status }, { status: 502 });
  }
}
