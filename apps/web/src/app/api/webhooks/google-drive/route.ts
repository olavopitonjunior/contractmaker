import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/db/prisma";

export const runtime = "nodejs";

/** Comparação constant-time de tokens (evita timing oracle). */
function tokensMatch(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/**
 * Webhook do Google Drive: cada `files.watch` registrado posta aqui quando o
 * arquivo muda. Headers relevantes:
 *  - X-Goog-Channel-Id: channelId que registramos
 *  - X-Goog-Channel-Token: shared secret (validamos contra GOOGLE_WATCH_TOKEN)
 *  - X-Goog-Resource-State: "sync" (initial) | "update" | "trash" | "remove"
 *  - X-Goog-Resource-Id: id opaco do recurso assinado
 *
 * Setup manual (uma vez por contrato — chame `watchFile` em lib/google/watch.ts
 * passando esta URL):
 *   https://imobpro.ia.br/api/webhooks/google-drive
 *
 * E renove o watch antes do `googleWatchExpires` via cron job. Drive limita
 * cada channel a 7 dias.
 */
export async function POST(req: NextRequest) {
  const channelId = req.headers.get("x-goog-channel-id");
  const channelToken = req.headers.get("x-goog-channel-token");
  const resourceState = req.headers.get("x-goog-resource-state");
  const resourceId = req.headers.get("x-goog-resource-id");

  // Fail-closed: sem GOOGLE_WATCH_TOKEN configurado, rejeita (antes o check era
  // pulado e qualquer POST com um channelId válido injetava ChangeLog forjado).
  const expectedToken = process.env.GOOGLE_WATCH_TOKEN?.trim();
  if (!expectedToken) {
    console.error(
      "[google-drive webhook] GOOGLE_WATCH_TOKEN não configurado — rejeitando request"
    );
    return NextResponse.json(
      { error: "webhook not configured" },
      { status: 503 }
    );
  }
  if (!channelToken || !tokensMatch(channelToken, expectedToken)) {
    return NextResponse.json({ error: "invalid token" }, { status: 401 });
  }

  if (!channelId) {
    return NextResponse.json({ error: "missing channel id" }, { status: 400 });
  }

  // Sync inicial (logo após watchFile) — ignorar.
  if (resourceState === "sync") {
    return NextResponse.json({ ok: true, ignored: "sync" });
  }

  const contract = await prisma.contract.findFirst({
    where: { googleWatchChannel: channelId },
    select: { id: true, googleDocId: true },
  });

  if (!contract) {
    console.warn(`[drive-webhook] channel ${channelId} sem contract associado`);
    return NextResponse.json({ ok: true, unmatched: true });
  }

  // Ping cru (mantido — outras partes contam com google_doc_updated pra "doc
  // mudou"; a retention limpa em 90d).
  await prisma.contractChangeLog.create({
    data: {
      contractId: contract.id,
      action: "google_doc_updated",
      summary: `Edição detectada no Google Doc (${resourceState})`,
      details: {
        resourceState,
        resourceId,
        channelId,
        timestamp: new Date().toISOString(),
      },
      source: "system",
    },
  });

  // Atribuição IA×humano: se o Doc NÃO foi editado programaticamente há pouco
  // (sem marcador), este ping é edição MANUAL humana no iframe → registra uma
  // entry atribuída (sem diff — ver human-doc-edit). "echo" (edição do app/IA, já
  // logada como source:"ai") e "unknown" (Redis indisponível — fail-safe) NÃO
  // viram atribuição humana.
  if (resourceState === "update" && contract.googleDocId) {
    try {
      const { checkDocEcho } = await import("@/lib/google/doc-edit-marker");
      if ((await checkDocEcho(contract.googleDocId)) === "manual") {
        const { recordHumanDocEdit } = await import(
          "@/lib/contracts/human-doc-edit"
        );
        await recordHumanDocEdit(
          { db: prisma, now: () => new Date() },
          { contractId: contract.id, details: { channelId, resourceId } }
        );
      }
    } catch (err) {
      // Nunca derruba o webhook por causa da atribuição.
      console.error("[drive-webhook] atribuição humana falhou:", err);
    }
  }

  return NextResponse.json({ ok: true });
}

// Drive faz uma chamada GET de health-check ao registrar o watch — responder 200.
export async function GET() {
  return NextResponse.json({ ok: true, service: "google-drive-webhook" });
}
