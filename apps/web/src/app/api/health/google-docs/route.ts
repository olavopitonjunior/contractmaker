import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import {
  isGoogleDocsConfigured,
  isGoogleDocsFeatureEnabled,
  isOwnerOAuthConfigured,
  getDriveFolderId,
  getServiceAccountEmail,
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

  // Validações deeper: tenta parsear o JSON da SA, calcula tamanhos.
  // Não vaza segredos — só emite shape (length, has-newlines, parseable).
  const rawSa = process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim();
  let saJsonShape: {
    length: number;
    parseable: boolean;
    parseError?: string;
    hasClientEmail: boolean;
    hasPrivateKey: boolean;
    privateKeyLooksValid: boolean;
  } = {
    length: rawSa?.length || 0,
    parseable: false,
    hasClientEmail: false,
    hasPrivateKey: false,
    privateKeyLooksValid: false,
  };
  if (rawSa) {
    try {
      const parsed = JSON.parse(rawSa);
      saJsonShape = {
        length: rawSa.length,
        parseable: true,
        hasClientEmail: !!parsed.client_email,
        hasPrivateKey: !!parsed.private_key,
        privateKeyLooksValid:
          typeof parsed.private_key === "string" &&
          parsed.private_key.includes("BEGIN PRIVATE KEY") &&
          parsed.private_key.includes("END PRIVATE KEY"),
      };
    } catch (err) {
      saJsonShape.parseError = err instanceof Error ? err.message.slice(0, 200) : String(err);
    }
  }
  const saEmail = getServiceAccountEmail();

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
    saJsonShape.parseable &&
    saJsonShape.privateKeyLooksValid &&
    ownerOauthConfigured &&
    !!driveFolderId &&
    templates.some((t) => t.engine === "google_docs" && !!t.googleTemplateDocId);

  return NextResponse.json({
    ok: true,
    flag: "USE_GOOGLE_DOCS_EDITOR",
    enabled,
    saConfigured,
    saJsonShape,
    saEmail,
    ownerOauthConfigured,
    driveFolderId: driveFolderId || null,
    ready,
    templates,
  });
}
