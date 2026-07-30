import { createHash } from "crypto";
import { prisma } from "@/lib/db/prisma";
import { logError } from "@/lib/observability/log";
import { uploadBufferToStorage } from "@/lib/storage/s3";
import { updateInspectionSignedLaudo } from "@/lib/locacao/inspection-signature";
import { safeFetch } from "@/lib/security/ssrf";
import { listEnvelopeDocuments } from "@/lib/clicksign/envelopes";
import { resolveClickSignCreds } from "@/lib/clicksign/account";

/**
 * Baixa o PDF assinado do ClickSign, sobe no storage, grava
 * `Envelope.signedDocumentUrl` e espelha como `DealAttachment` na pasta do deal.
 *
 * Antes essa lógica estava DUPLICADA (idêntica) no webhook (`api/webhooks/
 * clicksign/route.ts`) e no cron de reconciliação (`lib/clicksign/sync.ts`),
 * com risco de divergência. Agora os dois caminhos chamam este helper.
 *
 * `url` é sempre a do documento PRIMARY (o sujeito do envelope). Quando o
 * envelope carrega documentos EXTRA (`EnvelopeDocument` kind="attachment", ex.:
 * laudo de vistoria enviado junto do contrato), cada um deles é baixado a
 * seguir por `persistExtraSignedDocuments`. Envelope sem rows de
 * `EnvelopeDocument` (todos os anteriores a essa tabela) → no-op, caminho antigo
 * intacto.
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
  await persistPrimarySignedPdf(envelopeId, url, logPrefix);
  await persistExtraSignedDocuments(envelopeId, logPrefix);
}

async function persistPrimarySignedPdf(
  envelopeId: string,
  url: string,
  logPrefix: string
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
    await prisma.envelopeDocument.updateMany({
      where: { envelopeId, kind: "primary" },
      data: { signedPdfUrl: stored },
    });

    // Laudo de vistoria (locação): a versão assinada vira o laudoPdfUrl final.
    // No-op quando o envelope não é de laudo.
    //
    // GATE: num envelope UNIFICADO (contrato + laudo) a `Inspection.envelopeId`
    // aponta pra este mesmo envelope, e o PDF primary é o CONTRATO — gravá-lo
    // como laudoPdfUrl trocaria o laudo pelo contrato. Nesse caso quem grava é
    // `persistExtraSignedDocuments`, com o PDF do documento certo.
    const extraCount = await prisma.envelopeDocument.count({
      where: { envelopeId, kind: "attachment" },
    });
    if (extraCount === 0) {
      await updateInspectionSignedLaudo(envelopeId, stored);
    }

    const env = await prisma.envelope.findUnique({
      where: { id: envelopeId },
      select: {
        dealId: true,
        proposalId: true,
        via: true,
        source: true,
        name: true,
        contract: { select: { version: true, kind: true } },
      },
    });

    // Envelope de PROPOSTA: o PDF assinado vira ProposalAttachment (o deal só
    // nasce na conversão). Dedupe por url/contentHash (corrida webhook×cron).
    if (env?.proposalId) {
      const dup = await prisma.proposalAttachment.findFirst({
        where: { proposalId: env.proposalId, OR: [{ url: stored }, { contentHash }] },
        select: { id: true },
      });
      if (dup) return;
      const category =
        env.via === "reduzida"
          ? "proposta_assinada_reduzida"
          : "proposta_assinada_completa";
      await prisma.proposalAttachment.create({
        data: {
          proposalId: env.proposalId,
          filename: `${env.name} (assinado).pdf`,
          mime: "application/pdf",
          url: stored,
          category,
          source: "clicksign_signed",
          byteSize: buf.byteLength,
          contentHash,
        },
      });
      // Único ponto onde signedDocumentUrl acabou de ser gravado — se este era o
      // último envelope pendente da proposta, o dossiê é montado agora. Guardado
      // por dossierUrl; no-op enquanto houver envelope sem PDF.
      const { buildDossier } = await import("@/lib/proposals/dossier");
      await buildDossier(env.proposalId).catch((e) =>
        console.error(`${logPrefix} falha ao montar dossiê:`, e)
      );
      return;
    }

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

    // Categoria kind-aware: o contrato de administração de locação vira uma
    // categoria própria na pasta (senão apareceria como "contrato assinado" da
    // locação e poluiria o gate de instrumento principal).
    const isAdmin = env.contract?.kind === "administracao";
    const category =
      env.source === "attachment"
        ? "documento_assinado"
        : isAdmin
          ? "contrato_administracao_assinado"
          : "contrato_assinado";
    const filename = env.contract
      ? isAdmin
        ? `Contrato de administração assinado v${env.contract.version}.pdf`
        : `Contrato assinado v${env.contract.version}.pdf`
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
    // Erro aqui = contrato assinado NÃO chega na pasta do deal (perda de dado
    // legal). Log estruturado pra virar alerta.
    logError("clicksign/persist-signed-pdf", err, { envelopeId });
  }
}

/**
 * Baixa o PDF assinado de cada documento EXTRA do envelope (`EnvelopeDocument`
 * kind="attachment") e espelha na pasta do deal.
 *
 * No-op — e barato (um findMany no índice de `envelopeId`) — quando o envelope
 * não tem documentos extra: é o caso de TODOS os envelopes criados antes da
 * tabela e de todo envelope de documento único. O caminho antigo fica intacto.
 *
 * A URL do assinado não vem no payload do webhook (que só carrega o documento
 * do evento), então resolvemos via `GET /documents` e casamos pelo id do
 * documento — `links.files.signed` (fallback `original`).
 *
 * Idempotente: pula documento que já tem `signedPdfUrl`; key de storage estável
 * por documento; DealAttachment deduplicado por url/contentHash.
 */
async function persistExtraSignedDocuments(
  envelopeId: string,
  logPrefix: string
): Promise<void> {
  try {
    const pending = await prisma.envelopeDocument.findMany({
      where: { envelopeId, kind: "attachment", signedPdfUrl: null },
      orderBy: { position: "asc" },
    });
    if (pending.length === 0) return;

    const env = await prisma.envelope.findUnique({
      where: { id: envelopeId },
      select: { orgId: true, dealId: true, clicksignId: true },
    });
    if (!env?.clicksignId || !env.dealId) return;

    const creds = await resolveClickSignCreds(env.orgId);
    if (!creds) return;
    const remote = await listEnvelopeDocuments(env.clicksignId, creds);
    const remoteData = (remote as { data?: unknown }).data;
    const remoteList = (
      Array.isArray(remoteData) ? remoteData : remoteData ? [remoteData] : []
    ) as Array<{
      id?: string;
      links?: { files?: { signed?: string; original?: string } };
    }>;
    const urlById = new Map<string, string>();
    for (const doc of remoteList) {
      const signedUrl = doc.links?.files?.signed ?? doc.links?.files?.original;
      if (doc.id && signedUrl) urlById.set(doc.id, signedUrl);
    }

    for (const doc of pending) {
      const signedUrl = urlById.get(doc.documentClicksignId);
      if (!signedUrl) continue;

      const res = await safeFetch(signedUrl);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      const contentHash = createHash("sha256").update(buf).digest("hex");

      const stored = await uploadBufferToStorage({
        bucket: process.env.S3_BUCKET,
        key: `envelopes/${envelopeId}/documents/${doc.documentClicksignId}/signed.pdf`,
        body: buf,
        contentType: "application/pdf",
      });
      await prisma.envelopeDocument.update({
        where: { id: doc.id },
        data: { signedPdfUrl: stored },
      });

      // Laudo de vistoria: a versão assinada vira o `laudoPdfUrl` final da
      // Inspection — mesma semântica do envio avulso, só que o envelope agora é
      // compartilhado com o contrato.
      const sourceCategory = doc.sourceAttachmentId
        ? (
            await prisma.dealAttachment.findUnique({
              where: { id: doc.sourceAttachmentId },
              select: { category: true },
            })
          )?.category ?? null
        : null;
      if (sourceCategory === "laudo_vistoria") {
        await updateInspectionSignedLaudo(envelopeId, stored);
      }

      const existing = await prisma.dealAttachment.findFirst({
        where: { dealId: env.dealId, OR: [{ url: stored }, { contentHash }] },
        select: { id: true },
      });
      if (existing) continue;

      // Mesma categoria do fluxo avulso ("documento_assinado"): já reconhecida
      // pela pasta do deal (SIGNED_CATS) — o nome do arquivo é que identifica
      // que é o laudo. Criar uma categoria nova exigiria tocar os filtros da UI
      // sem ganho real.
      await prisma.dealAttachment.create({
        data: {
          dealId: env.dealId,
          filename: `${doc.filename.replace(/\.pdf$/i, "")} (assinado).pdf`,
          mime: "application/pdf",
          url: stored,
          category: "documento_assinado",
          source: "clicksign_signed",
          byteSize: buf.byteLength,
          contentHash,
        },
      });
    }
  } catch (err) {
    logError("clicksign/persist-signed-extra-documents", err, { envelopeId });
    console.error(`${logPrefix} falha ao persistir documentos extra:`, err);
  }
}
