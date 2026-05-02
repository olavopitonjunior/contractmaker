import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import {
  isGoogleDocsConfigured,
  isGoogleDocsFeatureEnabled,
  isOwnerOAuthConfigured,
  getDriveFolderId,
} from "@/lib/google/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Health check público da feature Google Docs editor. Sem auth — só expõe
 * estado da feature flag e templates configurados; nenhum secret é vazado.
 *
 * Endpoint vive em `/api/health/...` em vez de `/api/contracts/...` pra
 * evitar colisão com a rota dinâmica `/api/contracts/[contractId]/route.ts`.
 *
 * Usado pelo QA E2E (docs/qa-google-docs-e2e.md) e pode ser usado por
 * monitoramento externo (uptime checks).
 */
export async function GET() {
  const enabled = isGoogleDocsFeatureEnabled();
  const saConfigured = isGoogleDocsConfigured();
  const ownerOauthConfigured = isOwnerOAuthConfigured();
  const driveFolderId = getDriveFolderId();

  let templates: Array<{
    id: string;
    name: string;
    modalidade: string | null;
    engine: string;
    googleTemplateDocId: string | null;
  }> = [];

  try {
    templates = await prisma.contractTemplate.findMany({
      where: { status: "active" },
      select: {
        id: true,
        name: true,
        modalidade: true,
        engine: true,
        googleTemplateDocId: true,
      },
      orderBy: { name: "asc" },
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: "DB unreachable",
        message: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    );
  }

  const ready =
    enabled &&
    saConfigured &&
    ownerOauthConfigured &&
    !!driveFolderId &&
    templates.some((t) => t.engine === "google_docs" && !!t.googleTemplateDocId);

  return NextResponse.json({
    ok: true,
    flag: "USE_GOOGLE_DOCS_EDITOR",
    enabled,
    saConfigured,
    ownerOauthConfigured,
    driveFolderId: driveFolderId || null,
    ready,
    templates,
    note: ready
      ? "Feature pronta. Contratos NOVOS gerados a partir desses templates serão Google Docs. Legacy continua em TipTap por design."
      : "Algum requisito ainda não foi configurado. Veja flags acima.",
  });
}
