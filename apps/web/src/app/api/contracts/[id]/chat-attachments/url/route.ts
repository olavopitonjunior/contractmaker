import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import {
  requireApiAuth,
  isAuthFailure,
  authFailureResponse,
} from "@/lib/api/require-auth";

export const runtime = "nodejs";
export const maxDuration = 30;

const schema = z.object({
  sessionId: z.string().cuid(),
  url: z.string().url(),
});

const TEXT_CAP = 20_000;
const MAX_BYTES = 2 * 1024 * 1024; // 2 MB
const FETCH_TIMEOUT_MS = 10_000;

// SSRF guard — bloqueia ranges privados/loopback/link-local.
function isPrivateHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (h === "localhost" || h.endsWith(".localhost")) return true;
  // IPv6 loopback / ULA
  if (h === "::1" || h.startsWith("fc") || h.startsWith("fd")) return true;
  // IPv4 ranges
  const m = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (m) {
    const [, a, b] = m.map(Number);
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 0) return true;
  }
  return false;
}

/**
 * Converte HTML em texto plano de forma minimalista — sem JSDOM/Readability
 * pra nao adicionar dependencia pesada. Remove script/style, tags, decode
 * algumas entidades comuns. Bom o suficiente pro agente entender o conteudo.
 */
function htmlToPlainText(html: string): string {
  let s = html;
  // Remove script + style + comentarios HTML
  s = s.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ");
  s = s.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ");
  s = s.replace(/<!--[\s\S]*?-->/g, " ");
  // Quebra linha em blocos
  s = s.replace(/<\/(p|div|h[1-6]|li|tr|br)>/gi, "\n");
  s = s.replace(/<br\s*\/?>/gi, "\n");
  // Strip de tags restantes
  s = s.replace(/<[^>]+>/g, "");
  // Entidades comuns
  s = s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");
  // Normaliza whitespace
  s = s.replace(/[ \t\f\v]+/g, " ");
  s = s.replace(/\n{3,}/g, "\n\n");
  return s.trim();
}

/**
 * POST /api/contracts/[id]/chat-attachments/url
 * Body: { sessionId, url }
 *
 * Faz fetch server-side com timeout 10s, SSRF guard, cap de 2MB. Extrai
 * texto plano via regex (Readability seria melhor mas exige JSDOM). Cap
 * em TEXT_CAP chars antes de salvar.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await requireApiAuth(req, { scope: "contracts:rw" });
  if (isAuthFailure(auth)) return authFailureResponse(auth);

  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }
  const { sessionId, url } = parsed.data;

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    return NextResponse.json({ error: "URL invalida" }, { status: 400 });
  }
  if (parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:") {
    return NextResponse.json({ error: "Apenas http(s)" }, { status: 400 });
  }
  if (isPrivateHost(parsedUrl.hostname)) {
    return NextResponse.json(
      { error: "Host privado/interno bloqueado" },
      { status: 400 }
    );
  }

  const session = await prisma.chatSession.findUnique({
    where: { id: sessionId },
    include: { contract: { select: { id: true, userId: true } } },
  });
  if (!session || session.contractId !== params.id) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }
  if (auth.ident.via === "bearer" && session.contract.userId !== auth.ident.userId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Fetch com timeout
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(url, {
      signal: ctrl.signal,
      redirect: "follow",
      headers: {
        "User-Agent": "ContractmakerBot/1.0 (+https://imobpro.ia.br)",
        Accept: "text/html,application/xhtml+xml,*/*;q=0.5",
      },
    });
  } catch (err) {
    clearTimeout(timer);
    return NextResponse.json(
      {
        error:
          err instanceof Error && err.name === "AbortError"
            ? "Timeout (>10s) ao buscar a URL"
            : "Falha ao buscar URL",
      },
      { status: 502 }
    );
  }
  clearTimeout(timer);

  if (!response.ok) {
    return NextResponse.json(
      { error: `URL retornou status ${response.status}` },
      { status: 502 }
    );
  }

  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("text/html") && !contentType.includes("text/plain")) {
    return NextResponse.json(
      { error: `Content-type nao suportado: ${contentType || "vazio"}` },
      { status: 415 }
    );
  }

  // Cap de bytes — le o body e mede.
  const buf = await response.arrayBuffer();
  if (buf.byteLength > MAX_BYTES) {
    return NextResponse.json({ error: "Resposta excede 2 MB" }, { status: 413 });
  }
  const rawHtml = new TextDecoder("utf-8").decode(buf);

  // Title fallback pro nome do chip
  const titleMatch = rawHtml.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const pageTitle = titleMatch
    ? titleMatch[1].replace(/\s+/g, " ").trim().slice(0, 120)
    : parsedUrl.hostname;

  let extractedText = htmlToPlainText(rawHtml);
  if (extractedText.length > TEXT_CAP) {
    extractedText = extractedText.slice(0, TEXT_CAP) + "\n\n[...texto truncado]";
  }
  if (extractedText.length < 50) {
    return NextResponse.json(
      { error: "Nao foi possivel extrair texto util da pagina" },
      { status: 422 }
    );
  }

  const attachment = await prisma.chatAttachment.create({
    data: {
      sessionId,
      name: pageTitle || parsedUrl.hostname,
      source: "url",
      sourceUrl: url,
      extractedText,
      byteSize: buf.byteLength,
    },
    select: {
      id: true,
      name: true,
      source: true,
      sourceUrl: true,
      byteSize: true,
      createdAt: true,
    },
  });

  return NextResponse.json(
    {
      id: attachment.id,
      name: attachment.name,
      source: attachment.source,
      sourceUrl: attachment.sourceUrl,
      byteSize: attachment.byteSize,
      createdAt: attachment.createdAt.toISOString(),
      extractedChars: extractedText.length,
    },
    { status: 201 }
  );
}
