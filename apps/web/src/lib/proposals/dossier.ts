import { createHash } from "crypto";
import { prisma } from "@/lib/db/prisma";
import { uploadBufferToStorage } from "@/lib/storage/s3";
import { safeFetch } from "@/lib/security/ssrf";

/**
 * Dossiê da proposta assinada por ENVELOPE (modo Plus / e-mail).
 *
 * Junta os PDFs assinados dos envelopes fechados da proposta (via completa e,
 * quando há ocultação, a reduzida) num único PDF, grava em `Proposal.dossierUrl`
 * e cria um `ProposalAttachment(category="dossie")`.
 *
 * Idempotente por `dossierUrl` (o "documento final" da proposta — o mesmo campo
 * que o Aceite usa pro comprovante). NÃO usar `dossierBuiltAt` como guard: um
 * timestamp de tentativa transforma falha transitória em corrupção permanente.
 *
 * Gate por `status === "completa"`: a proposta só chega a `completa` quando o
 * ÚLTIMO envelope esperado fecha (a reduzida do proprietário, quando há
 * encadeamento). Sem esse gate havia uma corrida — o `persistSignedPdf` do
 * envelope completo (proponente) rodava `buildDossier` ANTES do 2º envelope
 * (reduzida) existir, montando um dossiê incompleto e travando o rebuild pelo
 * guard de `dossierUrl`. Com o gate, só monta depois que a reduzida fecha e o
 * `onProposalEnvelopeClosed` move pra `completa` (awaited antes do buildDossier).
 */
export async function buildDossier(
  proposalId: string
): Promise<{ url: string } | { skipped: "already_built" | "pending" | "empty" }> {
  const proposal = await prisma.proposal.findUnique({
    where: { id: proposalId },
    select: { id: true, dossierUrl: true, status: true },
  });
  if (!proposal) return { skipped: "empty" };
  if (proposal.dossierUrl) return { skipped: "already_built" };
  // Ainda há via pendente (ex.: proponente assinou mas o proprietário não) →
  // não montar até a proposta estar completa.
  if (proposal.status !== "completa") return { skipped: "pending" };

  const envelopes = await prisma.envelope.findMany({
    where: { proposalId, source: "proposal" },
    select: { id: true, via: true, signedDocumentUrl: true, status: true },
    orderBy: { via: "asc" }, // "completa" antes de "reduzida"
  });
  if (envelopes.length === 0) return { skipped: "empty" };
  // Ainda há envelope sem PDF assinado → o dossiê seria incompleto. Espera.
  if (envelopes.some((e) => !e.signedDocumentUrl)) return { skipped: "pending" };

  const { PDFDocument } = await import("pdf-lib");
  const out = await PDFDocument.create();
  for (const e of envelopes) {
    const res = await safeFetch(e.signedDocumentUrl as string);
    if (!res.ok) return { skipped: "pending" }; // reprocessa depois
    const src = await PDFDocument.load(await res.arrayBuffer());
    const pages = await out.copyPages(src, src.getPageIndices());
    pages.forEach((p) => out.addPage(p));
  }
  const merged = Buffer.from(await out.save());
  const contentHash = createHash("sha256").update(merged).digest("hex");

  const url = await uploadBufferToStorage({
    bucket: process.env.S3_BUCKET,
    key: `proposals/${proposalId}/dossie.pdf`, // key estável → re-run sobrescreve
    body: merged,
    contentType: "application/pdf",
  });

  await prisma.$transaction([
    prisma.proposalAttachment.create({
      data: {
        proposalId,
        filename: "Dossiê da proposta.pdf",
        mime: "application/pdf",
        url,
        category: "dossie",
        source: "dossier",
        contentHash,
        byteSize: merged.length,
      },
    }),
    prisma.proposal.update({
      where: { id: proposalId },
      data: { dossierUrl: url, dossierBuiltAt: new Date() },
    }),
  ]);

  return { url };
}
