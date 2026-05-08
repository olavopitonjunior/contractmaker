import { NextRequest, NextResponse } from "next/server";
import { auth, getUserOrg } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { listWebhooks } from "@/lib/clicksign/envelopes";
import { ClicksignError } from "@/lib/clicksign/client";

export const runtime = "nodejs";

/**
 * GET /api/admin/clicksign/webhooks
 *
 * Diagnóstico: lista todos os webhooks cadastrados na conta ClickSign.
 * Usado pra verificar se a URL canônica está registrada e ativa quando
 * eventos não estão chegando.
 *
 * Disponível só pra `OrgMembership.role = owner|admin` da org.
 */
export async function GET(_req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const org = await getUserOrg(session.user.id);
  if (!org) {
    return NextResponse.json(
      { error: "No organization" },
      { status: 400 }
    );
  }
  // Diagnóstico expõe HMAC secret + lista de URLs cadastradas — restrito
  // a owner/admin pra evitar leak pra members comuns.
  const membership = await prisma.orgMembership.findUnique({
    where: { userId_orgId: { userId: session.user.id, orgId: org.id } },
  });
  const role = membership?.role ?? "viewer";
  if (role !== "owner" && role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const expected = "https://imobpro.ia.br/api/webhooks/clicksign";
  const hasSecret = Boolean(process.env.CLICKSIGN_WEBHOOK_SECRET);

  try {
    const resp = await listWebhooks();
    const data = (resp as { data?: unknown }).data;
    const webhooks = Array.isArray(data)
      ? (data as Array<{
          id: string;
          attributes?: {
            url?: string;
            description?: string;
            events?: string[];
            active?: boolean;
            created?: string;
          };
        }>).map((w) => ({
          id: w.id,
          url: w.attributes?.url,
          description: w.attributes?.description,
          events: w.attributes?.events,
          active: w.attributes?.active,
          created: w.attributes?.created,
          matchesExpected: w.attributes?.url === expected,
        }))
      : [];

    return NextResponse.json({
      ok: true,
      expectedUrl: expected,
      hasWebhookSecret: hasSecret,
      count: webhooks.length,
      webhooks,
      raw: resp,
      diagnostic:
        webhooks.length === 0
          ? "ERRO: Nenhum webhook cadastrado na conta ClickSign. Cadastrar via dashboard ou POST /api/v3/webhooks."
          : webhooks.some((w) => w.matchesExpected && w.active !== false)
            ? "OK: URL canônica está cadastrada e ativa."
            : "AVISO: URL canônica não corresponde a nenhum webhook ativo. Verifique a configuração na ClickSign.",
    });
  } catch (err) {
    if (err instanceof ClicksignError) {
      return NextResponse.json(
        {
          ok: false,
          error: `Clicksign: ${err.message}`,
          status: err.status,
          expectedUrl: expected,
          hasWebhookSecret: hasSecret,
        },
        { status: 502 }
      );
    }
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
