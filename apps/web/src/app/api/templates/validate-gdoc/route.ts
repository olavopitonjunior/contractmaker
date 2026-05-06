import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth, getUserOrg } from "@/lib/auth/auth";
import {
  getDriveClient,
  isGoogleDocsConfigured,
} from "@/lib/google/client";
import { getDocPlainText } from "@/lib/google/docs";
import { extractPlaceholdersFromText } from "@/lib/google/replace-placeholders";

const requestSchema = z.object({
  url: z.string().min(1),
});

/**
 * Extrai o file id de uma URL do Google Docs ou aceita o id direto.
 * Suporta /document/d/{ID}/edit, /document/d/{ID}/preview, /open?id={ID}.
 */
function parseDocId(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  // ID puro (cuid-like, alfanumérico longo)
  if (/^[A-Za-z0-9_-]{20,}$/.test(trimmed)) return trimmed;

  const matchPath = trimmed.match(
    /docs\.google\.com\/document\/d\/([A-Za-z0-9_-]+)/
  );
  if (matchPath) return matchPath[1];

  const matchOpen = trimmed.match(/[?&]id=([A-Za-z0-9_-]+)/);
  if (matchOpen) return matchOpen[1];

  return null;
}

/**
 * Heurística: avisa quando placeholders parecem indicar loops (ex: vendedor_2,
 * comprador_0_nome). Não bloqueia — o aviso já está na UI.
 */
function detectLoopWarnings(placeholders: string[]): string[] {
  const warnings: string[] = [];
  const indexedRe = /[._]?\d+([._]|$)/;
  const looksIndexed = placeholders.filter((p) => indexedRe.test(p));
  if (looksIndexed.length > 0) {
    warnings.push(
      `Placeholders parecem indicar múltiplas partes (${looksIndexed
        .slice(0, 3)
        .join(", ")}${looksIndexed.length > 3 ? "..." : ""}). ` +
        "Templates Google Doc não suportam loops — apenas a primeira parte é substituída."
    );
  }
  return warnings;
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const org = await getUserOrg(session.user.id);
  if (!org) {
    return NextResponse.json({ error: "No organization" }, { status: 400 });
  }

  if (!isGoogleDocsConfigured()) {
    return NextResponse.json(
      { error: "Integração Google Docs não está configurada." },
      { status: 503 }
    );
  }

  const body = await req.json().catch(() => null);
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "URL ou ID do Google Doc é obrigatório." },
      { status: 400 }
    );
  }

  const docId = parseDocId(parsed.data.url);
  if (!docId) {
    return NextResponse.json(
      {
        error:
          "Não foi possível extrair o ID do Google Doc. Cole a URL completa (docs.google.com/document/d/...) ou apenas o ID.",
      },
      { status: 400 }
    );
  }

  try {
    const drive = getDriveClient();
    const meta = await drive.files.get({
      fileId: docId,
      fields: "id, name, mimeType, owners(emailAddress)",
      supportsAllDrives: true,
    });
    const file = meta.data;

    if (file.mimeType !== "application/vnd.google-apps.document") {
      return NextResponse.json(
        {
          error:
            "Arquivo não é um Google Doc. Importe apenas docs nativos (não PDFs nem Word).",
        },
        { status: 400 }
      );
    }

    const text = await getDocPlainText(docId);
    const placeholders = extractPlaceholdersFromText(text);
    const warnings = detectLoopWarnings(placeholders);

    return NextResponse.json({
      ok: true,
      docId,
      name: file.name || "(sem nome)",
      mimeType: file.mimeType,
      placeholdersFound: placeholders,
      warnings,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const friendly = msg.includes("404")
      ? "Doc não encontrado ou sem acesso. Compartilhe com a service account."
      : msg;
    console.error("[validate-gdoc] Erro:", err);
    return NextResponse.json(
      { error: friendly },
      { status: msg.includes("404") ? 404 : 500 }
    );
  }
}
