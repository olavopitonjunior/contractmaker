import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { signatureMatchesMime } from "@/lib/security/file-signature";
import { downloadBufferFromUrl, deleteFromStorage } from "@/lib/storage/s3";
import { RateLimits } from "@/lib/security/ratelimit";
import { persistProposalDocument } from "@/lib/proposals/attachments";
import { notifyProposalMilestone } from "@/lib/proposals/notify-proposal";
import { publicRequestIpHash } from "@/lib/proposals/public-request";
import {
  resolvePublicUploadScope,
  publicUploadDenialStatus,
  parsePublicAssignment,
  PUBLIC_UPLOAD_DENIAL_MESSAGE,
  PUBLIC_UPLOAD_MAX_BYTES,
  PUBLIC_UPLOAD_MIMES,
  PUBLIC_UPLOAD_BLOB_PREFIX,
  MAX_PUBLIC_FILES_PER_PROPOSAL,
} from "@/lib/proposals/public-upload";

export const runtime = "nodejs";
export const maxDuration = 60;

const bodySchema = z.object({
  url: z.string().url().max(2048),
  filename: z.string().min(1).max(255),
  mime: z.string().min(1).max(255),
  assignment: z.unknown().optional(),
});

/** Balde de hora para o sino: N uploads seguidos = 1 aviso ao corretor. */
function hourBucket(d: Date): string {
  return d.toISOString().slice(0, 13).replace(/[-T]/g, "");
}

/** `Content-Length` do objeto via HEAD, ou null se o host não informar / falhar. */
async function declaredContentLength(url: string): Promise<number | null> {
  try {
    const head = await fetch(url, { method: "HEAD" });
    const raw = head.headers.get("content-length");
    if (!raw) return null;
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? n : null;
  } catch {
    return null;
  }
}

/**
 * POST /api/public/proposals/:token/attachments/finalize  (PÚBLICO)
 *
 * Registra como ProposalAttachment (`source: "public"`) um arquivo que o LEAD
 * subiu direto pro Blob via `../blob-upload`. Espelho do finalize público do
 * formulário: é AQUI que os bytes são conferidos — o servidor baixa o objeto
 * do storage e roda `signatureMatchesMime`; conteúdo que não casa com o tipo
 * declarado é REMOVIDO do storage e nada é criado.
 *
 * O que o lead informa é só "de quem é" (`assignment`): validado contra as
 * opções desta proposta, e qualquer coisa fora cai no locatário 1 — nunca
 * 400, o lead não tem como consertar um payload. A escolha entra como humana
 * (`assignmentPersisted: true`): o corretor reatribui na tela interna se
 * precisar, e é ela que alimenta o convert.
 */
export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
  const r = await resolvePublicUploadScope(params.token);
  if (!r.ok) {
    return NextResponse.json(
      { error: PUBLIC_UPLOAD_DENIAL_MESSAGE[r.reason] },
      { status: publicUploadDenialStatus(r.reason) }
    );
  }
  const { scope } = r;
  const ipHash = publicRequestIpHash(req);

  // Mesmo balde do handshake: os dois caminhos criam anexo na mesma proposta.
  const rl = await RateLimits.proposalAttachmentPerToken(params.token, ipHash);
  if (!rl.success) {
    return NextResponse.json({ error: "Muitos envios. Tente novamente mais tarde." }, { status: 429 });
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 });
  }
  const { url, filename, mime } = parsed.data;

  if (!PUBLIC_UPLOAD_MIMES.includes(mime)) {
    return NextResponse.json({ error: `Tipo de arquivo não suportado: ${mime}` }, { status: 400 });
  }

  // Propriedade da URL: só objeto do nosso store, sob o prefixo PÚBLICO. Sem
  // isto daria pra registrar URL externa arbitrária ou um objeto da árvore
  // interna (`proposal-attachments/<id>/`) de outra proposta.
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    return NextResponse.json({ error: "URL inválida" }, { status: 400 });
  }
  const isBlobHost = parsedUrl.hostname.endsWith(".blob.vercel-storage.com");
  const inPublicTree = parsedUrl.pathname.startsWith(`/${PUBLIC_UPLOAD_BLOB_PREFIX}`);
  if (parsedUrl.protocol !== "https:" || !isBlobHost || !inPublicTree) {
    return NextResponse.json({ error: "URL não pertence a esta proposta" }, { status: 403 });
  }

  // Posse: o objeto tem que ser um upload NOVO, ainda não reivindicado — o
  // prefixo genérico sozinho não prova nada (o cliente escolhe o pathname).
  const [claimedByProposal, claimedByDeal] = await Promise.all([
    prisma.proposalAttachment.findFirst({ where: { url }, select: { id: true } }),
    prisma.dealAttachment.findFirst({ where: { url }, select: { id: true } }),
  ]);
  if (claimedByProposal || claimedByDeal) {
    return NextResponse.json({ error: "Este arquivo já está anexado" }, { status: 409 });
  }

  // Teto por proposta (R7): link anônimo não vira depósito ilimitado.
  const publicCount = await prisma.proposalAttachment.count({
    where: { proposalId: scope.proposalId, source: "public" },
  });
  if (publicCount >= MAX_PUBLIC_FILES_PER_PROPOSAL) {
    await deleteFromStorage(url);
    return NextResponse.json(
      { error: `Limite de ${MAX_PUBLIC_FILES_PER_PROPOSAL} documentos atingido. Fale com a imobiliária.` },
      { status: 409 }
    );
  }

  // Tamanho ANTES de baixar: o host/prefixo não provam que o objeto veio do
  // nosso handshake (qualquer conta do Blob publica nesse caminho), e o
  // download bufferiza o corpo inteiro. Um HEAD com Content-Length acima do
  // teto recusa sem consumir memória; sem Content-Length, o teto é conferido
  // sobre o buffer como sempre.
  const declared = await declaredContentLength(url);
  if (declared != null && declared > PUBLIC_UPLOAD_MAX_BYTES) {
    await deleteFromStorage(url);
    return NextResponse.json(
      { error: `Arquivo excede o limite de ${PUBLIC_UPLOAD_MAX_BYTES / 1024 / 1024} MB` },
      { status: 413 }
    );
  }

  let buffer: Buffer;
  try {
    buffer = await downloadBufferFromUrl(url);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `Falha ao ler o arquivo enviado: ${msg}` }, { status: 502 });
  }
  if (buffer.length === 0) {
    await deleteFromStorage(url);
    return NextResponse.json({ error: "Conteúdo vazio" }, { status: 400 });
  }
  if (buffer.length > PUBLIC_UPLOAD_MAX_BYTES) {
    await deleteFromStorage(url);
    return NextResponse.json(
      { error: `Arquivo excede o limite de ${PUBLIC_UPLOAD_MAX_BYTES / 1024 / 1024} MB` },
      { status: 413 }
    );
  }
  // Magic bytes: o content-type é escolhido pelo cliente e é forjável.
  if (!signatureMatchesMime(buffer, mime)) {
    await deleteFromStorage(url);
    return NextResponse.json(
      { error: "O conteúdo do arquivo não corresponde ao tipo informado." },
      { status: 400 }
    );
  }

  const assignment = parsePublicAssignment(parsed.data.assignment, scope.dataJson);

  const { attachment, deduped } = await persistProposalDocument({
    proposalId: scope.proposalId,
    buffer,
    url,
    filename,
    mime,
    category: "documento",
    source: "public",
    status: "awaiting_user",
    extractedData: { assignment, assignmentPersisted: true },
    // Rota pública: o rastro é o ipHash, não o IP cru (LGPD) — mesmo valor
    // que vai para o ProposalEvent.
    auditCtx: {
      orgId: scope.orgId,
      userId: null,
      ipAddress: ipHash,
      userAgent: req.headers.get("user-agent") ?? null,
    },
    auditMetadata: { via: "public_lead" },
  });
  // Mesmo conteúdo já anexado: o blob recém-subido é cópia redundante.
  if (deduped && attachment.url !== url) {
    await deleteFromStorage(url);
  }

  const now = new Date();
  if (!deduped) {
    await prisma.proposalEvent
      .create({
        data: {
          proposalId: scope.proposalId,
          eventName: "document_uploaded",
          source: "public",
          ipHash,
          payload: { attachmentId: attachment.id, mime, assignment: { ...assignment } },
        },
      })
      .catch(() => {});
    // Sino do dono, 1 por hora — fire-and-forget, nunca lança.
    await notifyProposalMilestone({
      proposalId: scope.proposalId,
      orgId: scope.orgId,
      userId: scope.userId,
      kind: "documents_received",
      dedupeSuffix: hourBucket(now),
    }).catch(() => {});
  }

  // Sem `url`: a URL do Blob não é devolvida ao lead (nem é necessária —
  // ele não abre o documento por aqui; remove pelo id).
  return NextResponse.json(
    {
      id: attachment.id,
      filename: attachment.filename,
      mime: attachment.mime,
      status: attachment.status,
      createdAt: attachment.createdAt,
      assignment,
      deduped,
    },
    { status: 201 }
  );
}
