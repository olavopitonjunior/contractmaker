/**
 * Serviço de envio do resumo consolidado do formulário por e-mail.
 *
 * Gera o PDF (form-summary-pdf), opcionalmente persiste como DealAttachment
 * (replace por categoria), baixa os documentos anexados respeitando um cap
 * cumulativo e envia via sendEmail (com anexos). NUNCA lança — herda a
 * semântica de `sendEmail`; devolve `{ ok }` pra quem chama ler.
 */

import { prisma } from "@/lib/db/prisma";
import { sendEmail, type EmailAttachment } from "@/lib/email/client";
import { FormSummaryEmail } from "@/lib/email/templates/form-summary";
import { generateFormSummaryPdf } from "@/lib/forms/form-summary-pdf";
import { uploadBufferToStorage, downloadBufferFromUrl } from "@/lib/storage/s3";

const DEFAULT_MAX_ATTACH_BYTES = 15 * 1024 * 1024; // 15MB — conservador p/ relay SMTP

function maxAttachBytes(): number {
  const raw = Number(process.env.FORM_SUMMARY_MAX_ATTACH_BYTES);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_MAX_ATTACH_BYTES;
}

export interface SendFormSummaryInput {
  formId: string;
  to: string | string[];
  /** Cópia oculta — destinatários que não podem ver o e-mail um do outro. */
  bcc?: string | string[];
  includeAttachments: boolean;
  /** Persiste o PDF como DealAttachment (quando há deal vinculado). */
  persist: boolean;
}

export interface SendFormSummaryResult {
  ok: boolean;
  emailId: string | null;
  error?: string;
  pdfUrl: string | null;
  attachedCount: number;
  /** Documentos omitidos por estourar o cap OU por o relay recusar os anexos. */
  attachmentsSkipped: boolean;
}

const CATEGORY = "resumo_formulario";

/**
 * Sobe o PDF pra storage e persiste como DealAttachment. Retorna a URL.
 *
 * Era um `deleteMany({ dealId, category })` seguido de `create` — o ÚNICO
 * caminho do sistema que apagava documento sem clique de ninguém, e sem audit.
 * Dois problemas: (1) o `category` do PATCH de anexo não tinha whitelist, então
 * quem reclassificasse um documento seu pra "resumo_formulario" o perdia no
 * próximo envio; (2) o form é reabrível e cada re-finalize re-executava o
 * delete. Agora nada é apagado: a chave do blob é determinística por
 * (dealId, formId), então re-envio sobrescreve o MESMO objeto e a linha
 * existente é atualizada no lugar.
 */
export async function persistFormSummaryPdf(
  dealId: string,
  formId: string,
  buffer: Buffer,
  filename: string
): Promise<string> {
  const key = `form-summary/${dealId}/resumo_${formId.slice(0, 8)}.pdf`;
  const url = await uploadBufferToStorage({
    bucket: process.env.S3_BUCKET,
    key,
    body: buffer,
    contentType: "application/pdf",
  });
  // Casa por URL (determinística) E por `source`, nunca só por categoria: a
  // categoria é editável pelo usuário, a origem não.
  const existing = await prisma.dealAttachment.findFirst({
    where: { dealId, url, source: "form_summary" },
    select: { id: true },
  });
  if (existing) {
    await prisma.dealAttachment.update({
      where: { id: existing.id },
      data: { filename, byteSize: buffer.byteLength, category: CATEGORY },
    });
  } else {
    await prisma.dealAttachment.create({
      data: {
        dealId,
        filename,
        mime: "application/pdf",
        url,
        category: CATEGORY,
        source: "form_summary",
        byteSize: buffer.byteLength,
      },
    });
  }
  return url;
}

export async function sendFormSummary(
  input: SendFormSummaryInput
): Promise<SendFormSummaryResult> {
  const base: SendFormSummaryResult = {
    ok: false,
    emailId: null,
    pdfUrl: null,
    attachedCount: 0,
    attachmentsSkipped: false,
  };

  // 1. Gerar PDF
  let pdf: Awaited<ReturnType<typeof generateFormSummaryPdf>>;
  try {
    pdf = await generateFormSummaryPdf(input.formId);
  } catch (err) {
    return { ...base, error: err instanceof Error ? err.message : String(err) };
  }

  // Metadados do form para o corpo do e-mail.
  const form = await prisma.salesForm.findUnique({
    where: { id: input.formId },
    select: { title: true, org: { select: { name: true } } },
  });
  const formTitle = form?.title || "Resumo do formulário";
  const orgName = form?.org?.name || "";

  // 2. Persistir (replace por categoria) — só se houver deal vinculado
  let pdfUrl: string | null = null;
  if (input.persist) {
    const deal = await prisma.deal.findFirst({
      where: { formId: input.formId },
      select: { id: true },
    });
    if (deal) {
      try {
        pdfUrl = await persistFormSummaryPdf(deal.id, input.formId, pdf.buffer, pdf.filename);
      } catch (err) {
        // Persistência é best-effort — o e-mail ainda vale.
        console.warn("[form-summary] falha ao persistir PDF", err);
        pdfUrl = null;
      }
    }
  }

  // 3. Montar anexos (PDF + documentos dentro do cap cumulativo)
  const attachments: EmailAttachment[] = [
    { filename: pdf.filename, content: pdf.buffer, contentType: "application/pdf" },
  ];
  let attachmentsSkipped = false;
  let attachedDocs = 0;

  if (input.includeAttachments) {
    const docs = await prisma.formAttachment.findMany({
      where: { formId: input.formId, url: { not: "" } },
      select: { filename: true, mime: true, url: true },
      orderBy: { createdAt: "asc" },
    });
    const cap = maxAttachBytes();
    let total = pdf.buffer.byteLength;
    for (const doc of docs) {
      try {
        const buf = await downloadBufferFromUrl(doc.url);
        if (total + buf.byteLength > cap) {
          attachmentsSkipped = true;
          continue;
        }
        total += buf.byteLength;
        attachments.push({
          filename: doc.filename,
          content: buf,
          contentType: doc.mime || undefined,
        });
        attachedDocs += 1;
      } catch (err) {
        console.warn("[form-summary] falha ao baixar anexo", doc.url, err);
        attachmentsSkipped = true;
      }
    }
  }

  // 4. Enviar. Se falhar COM anexos, retry SEM anexos (relay pode recusar).
  const renderEmail = (skipped: boolean, count: number) =>
    FormSummaryEmail({
      orgName,
      formTitle,
      pdfUrl,
      attachedCount: count,
      attachmentsSkipped: skipped,
    });

  const subject = `Resumo do formulário — ${formTitle}`;

  let result = await sendEmail({
    to: input.to,
    bcc: input.bcc,
    subject,
    react: renderEmail(attachmentsSkipped, attachedDocs),
    attachments,
  });

  if (!result.ok && attachments.length > 0) {
    console.warn("[form-summary] envio com anexos falhou, retry sem anexos:", result.error);
    attachmentsSkipped = true;
    attachedDocs = 0;
    result = await sendEmail({
      to: input.to,
      bcc: input.bcc,
      subject,
      react: renderEmail(true, 0),
    });
  }

  return {
    ok: result.ok,
    emailId: result.id,
    error: result.error,
    pdfUrl,
    attachedCount: attachedDocs,
    attachmentsSkipped,
  };
}
