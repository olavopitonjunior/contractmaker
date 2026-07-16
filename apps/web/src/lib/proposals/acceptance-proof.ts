import { createHash } from "crypto";
import { prisma } from "@/lib/db/prisma";
import { exportPdfToBuffer } from "@/lib/render/exporter";
import { uploadBufferToStorage } from "@/lib/storage/s3";
import { renderProposalVia } from "./render";
import { selectPropostaTemplate } from "./template-select";

/**
 * Comprovante DURÁVEL do Aceite via WhatsApp.
 *
 * Requisito do usuário: *"o aceite deve ter algum registro automático que evita
 * o usuário eventualmente apagar a mensagem."* A mensagem no WhatsApp é efêmera;
 * a prova não pode viver só nela. Guardamos, do nosso lado, um PDF que consolida
 * (a) o documento que a pessoa viu e (b) os fatos do aceite. Isso vira
 * `ProposalAttachment` e sobrevive à conversão (pasta do deal).
 */

/**
 * Texto de vinculação do Aceite via WhatsApp — a manifestação de vontade que a
 * pessoa aceita. PURO e compartilhado entre o ENVIO (vira o `message` do
 * acceptance_term, ≤1500 chars) e o COMPROVANTE (vira o `acceptedText`), pra
 * garantir que o comprovante reproduza exatamente o que foi aceito.
 */
export function buildAcceptanceMessage(input: {
  numero: string | number;
  title: string;
  link: string;
}): string {
  return (
    `Proposta nº ${input.numero} — ${input.title}. ` +
    `Declaro que li a Proposta cujo inteiro teor está em ${input.link} ` +
    `e aceito integralmente suas condições.`
  ).slice(0, 1500);
}

export interface AcceptanceFacts {
  numero: string | number;
  signerName: string;
  signerPhone: string;
  acceptanceId: string; // id do acceptance_term na ClickSign
  sentAt?: string | null;
  completedAt?: string | null;
  acceptedText: string; // o texto exato que a pessoa aceitou
}

function esc(s: string | number | null | undefined): string {
  return String(s ?? "").replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string
  );
}

/**
 * Página de rosto + documento. Parte PURA e testável — os fatos do aceite têm
 * que aparecer no HTML, é isso que dá valor probatório ao comprovante.
 */
export function buildAcceptanceProofHtml(input: {
  proposalHtml: string;
  facts: AcceptanceFacts;
}): string {
  const f = input.facts;
  const cover = `
<div style="font-family: 'EB Garamond', Georgia, serif; color: #111; max-width: 720px; margin: 0 auto; line-height: 1.5;">
  <h1 style="text-align: center; font-size: 18pt; margin: 0 0 4px;">COMPROVANTE DE ACEITE</h1>
  <p style="text-align: center; font-size: 10pt; color: #555; margin: 0 0 24px;">Aceite via WhatsApp · Proposta nº ${esc(f.numero)}</p>

  <table style="width: 100%; font-size: 10pt; border-collapse: collapse;">
    <tr><td style="padding:6px 0;width:38%;color:#555;">Aceitante</td><td style="padding:6px 0;font-weight:600;">${esc(f.signerName)}</td></tr>
    <tr><td style="padding:6px 0;color:#555;">WhatsApp</td><td style="padding:6px 0;font-weight:600;">${esc(f.signerPhone)}</td></tr>
    <tr><td style="padding:6px 0;color:#555;">Identificador ClickSign</td><td style="padding:6px 0;font-weight:600;">${esc(f.acceptanceId)}</td></tr>
    <tr><td style="padding:6px 0;color:#555;">Enviado em</td><td style="padding:6px 0;font-weight:600;">${esc(f.sentAt) || "—"}</td></tr>
    <tr><td style="padding:6px 0;color:#555;">Aceito em</td><td style="padding:6px 0;font-weight:600;">${esc(f.completedAt) || "—"}</td></tr>
  </table>

  <h2 style="font-size: 12pt; margin: 24px 0 8px;">Texto aceito</h2>
  <p style="font-size: 10pt; border-left: 3px solid #0f766e; padding-left: 12px; color: #333;">${esc(f.acceptedText)}</p>

  <p style="margin-top: 24px; font-size: 9pt; color: #555;">
    Este comprovante consolida a manifestação de vontade registrada via Aceite por
    WhatsApp da ClickSign e o inteiro teor da proposta, reproduzido a seguir.
  </p>
</div>
<div style="page-break-before: always;"></div>
${input.proposalHtml}`;
  return cover;
}

/**
 * Gera e guarda o comprovante. Idempotente por `Proposal.dossierUrl` — o mesmo
 * campo é o "documento final" da proposta nos dois modos (envelope → dossiê;
 * aceite → comprovante). Chamado no webhook `acceptance_term_completed`.
 */
export async function buildAcceptanceProof(
  proposalId: string,
  facts: Omit<AcceptanceFacts, "numero" | "acceptedText"> & {
    acceptedText: string;
  }
): Promise<{ url: string } | { skipped: "already_built" | "not_found" }> {
  const proposal = await prisma.proposal.findUnique({ where: { id: proposalId } });
  if (!proposal) return { skipped: "not_found" };
  if (proposal.dossierUrl) return { skipped: "already_built" };

  // Documento como a pessoa REALMENTE viu no envio: usa o snapshot CONGELADO,
  // nunca re-renderiza o template atual (que pode ter mudado via sync-templates
  // entre o envio e o aceite — reproduzir um doc diferente do aceito anula o
  // valor probatório). Fallback ao re-render só pra propostas antigas sem
  // snapshot.
  let proposalHtml = proposal.sentSnapshotHtml ?? "";
  if (!proposalHtml) {
    const dataJson = (proposal.dataJson ?? {}) as Record<string, unknown>;
    const tpl = proposal.templateId
      ? await prisma.contractTemplate.findUnique({ where: { id: proposal.templateId } })
      : (await selectPropostaTemplate(proposal.orgId, proposal.schemaType))?.template ?? null;
    proposalHtml = tpl?.handlebarsSource
      ? renderProposalVia({
          templateSource: tpl.handlebarsSource,
          schemaType: proposal.schemaType,
          dataJson,
          hiddenPaths: [],
          via: "completa",
          numero: proposal.id.slice(-8),
          comissaoIncluida: proposal.comissaoIncluida,
        })
      : (proposal.htmlContent ?? "<p>Proposta</p>");
  }

  const html = buildAcceptanceProofHtml({
    proposalHtml,
    facts: { ...facts, numero: proposal.id.slice(-8) },
  });
  const pdf = await exportPdfToBuffer(html, "A4", null);
  const contentHash = createHash("sha256").update(pdf).digest("hex");

  const url = await uploadBufferToStorage({
    key: `proposals/${proposalId}/comprovante-aceite.pdf`, // key estável → re-run sobrescreve
    body: pdf,
    contentType: "application/pdf",
  });

  await prisma.$transaction([
    prisma.proposalAttachment.create({
      data: {
        proposalId,
        filename: "Comprovante de Aceite.pdf",
        mime: "application/pdf",
        url,
        category: "aceite_comprovante",
        source: "clicksign_acceptance",
        contentHash,
        byteSize: pdf.length,
      },
    }),
    prisma.proposal.update({
      where: { id: proposalId },
      data: { dossierUrl: url, dossierBuiltAt: new Date() },
    }),
  ]);

  return { url };
}
