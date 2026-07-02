import { createHash } from "crypto";
import { prisma } from "@/lib/db/prisma";
import { uploadBufferToStorage } from "@/lib/storage/s3";
import { updateInspectionSignedLaudo } from "@/lib/locacao/inspection-signature";
import { safeFetch } from "@/lib/security/ssrf";

/**
 * Baixa o PDF assinado do ClickSign, sobe no storage, grava
 * `Envelope.signedDocumentUrl` e espelha como `DealAttachment` na pasta do deal.
 *
 * Antes essa lógica estava DUPLICADA (idêntica) no webhook (`api/webhooks/
 * clicksign/route.ts`) e no cron de reconciliação (`lib/clicksign/sync.ts`),
 * com risco de divergência. Agora os dois caminhos chamam este helper.
 *
 * Idempotente: ClickSign pode reentregar `close` e o cron roda em paralelo —
 * a key de storage é estável (`envelopes/<id>/signed.pdf`) e o DealAttachment
 * é deduplicado por url + contentHash. Best-effort: erros são logados, nunca
 * propagados (o caller é fire-and-forget).
 */
export async function persistSignedPdf(
  envelopeId: string,
  url: string,
  logPrefix = "[clicksign]"
): Promise<void> {
  try {
    // SSRF guard: `url` vem do payload/da API ClickSign. safeFetch revalida o
    // host (e cada redirect) pra impedir fetch de IMDS/rede interna (#76 Fase 0).
    const res = await safeFetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    const contentHash = createHash("sha256").update(buf).digest("hex");

    const stored = await uploadBufferToStorage({
      bucket: process.env.S3_BUCKET,
      key: `envelopes/${envelopeId}/signed.pdf`,
      body: buf,
      contentType: "application/pdf",
    });
    await prisma.envelope.update({
      where: { id: envelopeId },
      data: { signedDocumentUrl: stored },
    });

    // Laudo de vistoria (locação): a versão assinada vira o laudoPdfUrl final.
    // No-op quando o envelope não é de laudo.
    await updateInspectionSignedLaudo(envelopeId, stored);

    const env = await prisma.envelope.findUnique({
      where: { id: envelopeId },
      select: {
        dealId: true,
        source: true,
        name: true,
        contract: { select: { version: true } },
      },
    });
    if (!env?.dealId) return;

    // Dedupe por url estável OU por conteúdo (corrida webhook×cron).
    const existing = await prisma.dealAttachment.findFirst({
      where: {
        dealId: env.dealId,
        OR: [{ url: stored }, { contentHash }],
      },
      select: { id: true },
    });
    if (existing) return;

    const category =
      env.source === "attachment" ? "documento_assinado" : "contrato_assinado";
    const filename = env.contract
      ? `Contrato assinado v${env.contract.version}.pdf`
      : `${env.name} (assinado).pdf`;
    await prisma.dealAttachment.create({
      data: {
        dealId: env.dealId,
        filename,
        mime: "application/pdf",
        url: stored,
        category,
        source: "clicksign_signed",
        byteSize: buf.byteLength,
        contentHash,
      },
    });
  } catch (err) {
    console.error(`${logPrefix} falha ao persistir PDF assinado:`, err);
  }
}
