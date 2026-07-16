import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/db/prisma";
import { getDriveClient, getServiceAccountEmail } from "@/lib/google/client";
import { logError } from "@/lib/observability/log";

export const runtime = "nodejs";

/**
 * Classifica a origem da edição do Google Doc olhando `lastModifyingUser`:
 * a IA/sistema edita via SERVICE ACCOUNT (getGoogleAuth), então quem editou
 * === e-mail da SA → "system"; qualquer outra conta = humano no iframe →
 * "user". Antes TODA edição virava "system", quebrando a dimensão IA×humano
 * (em prod 348 "system" vs 4 "user"). Best-effort: se a Drive API falhar ou
 * não trouxer o autor, mantém o default seguro "system".
 */
async function classifyEditSource(googleDocId: string | null): Promise<string> {
  if (!googleDocId) return "system";
  const saEmail = getServiceAccountEmail();
  if (!saEmail) return "system"; // sem como comparar → default seguro
  try {
    const drive = getDriveClient();
    const meta = await drive.files.get({
      fileId: googleDocId,
      fields: "lastModifyingUser/emailAddress",
      supportsAllDrives: true,
    });
    const editor = meta.data.lastModifyingUser?.emailAddress;
    if (!editor) return "system";
    return editor.toLowerCase() === saEmail.toLowerCase() ? "system" : "user";
  } catch (err) {
    logError("google-drive-webhook/classify", err, { googleDocId });
    return "system";
  }
}

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

  const source = await classifyEditSource(contract.googleDocId);

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
      source,
    },
  });

  return NextResponse.json({ ok: true });
}

// Drive faz uma chamada GET de health-check ao registrar o watch — responder 200.
export async function GET() {
  return NextResponse.json({ ok: true, service: "google-drive-webhook" });
}
