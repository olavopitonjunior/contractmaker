/**
 * Render do resumo consolidado do formulário em HTML e PDF.
 *
 * `generateFormSummaryPdf(formId)` carrega o SalesForm (+ org, attachments),
 * monta as seções via buildConsolidatedFormSummary e gera um PDF em memória
 * (Buffer) com exportPdfToBuffer. Estilo default (style=null) — resumo não
 * precisa do branding do contrato.
 */

import { prisma } from "@/lib/db/prisma";
import { exportPdfToBuffer } from "@/lib/render/exporter";
import {
  buildConsolidatedFormSummary,
  type FormSummaryAttachment,
} from "@/lib/forms/form-summary";
import type { SummarySection } from "@/lib/forms/negotiation-summary";

function esc(v: string): string {
  return v
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export interface FormSummaryMeta {
  orgName: string;
  formTitle: string;
  generatedAtLabel: string;
  statusLabel?: string;
}

/**
 * Monta o fragmento HTML (cabeçalho + tabela por seção). O wrapWithStyle do
 * exporter injeta o `<html>/<body>` e a tipografia; aqui só o conteúdo + um
 * `<style>` escopado pras tabelas.
 */
export function renderFormSummaryHtml(
  sections: SummarySection[],
  meta: FormSummaryMeta
): string {
  const style = `
    <style>
      .fs-header { border-bottom: 2px solid #1a1a1a; padding-bottom: 8px; margin-bottom: 18px; }
      .fs-header h1 { font-size: 18pt; margin: 0 0 4px; }
      .fs-header .fs-meta { font-size: 9pt; color: #555; }
      .fs-section { margin: 0 0 16px; page-break-inside: avoid; }
      .fs-section h2 { font-size: 12pt; margin: 0 0 6px; padding: 4px 0; border-bottom: 1px solid #ccc; }
      table.fs-table { width: 100%; border-collapse: collapse; font-size: 10pt; }
      table.fs-table td { padding: 3px 6px; vertical-align: top; }
      table.fs-table td.fs-label { width: 34%; color: #444; font-weight: 600; }
      table.fs-table tr:nth-child(even) { background: #f6f6f6; }
      .fs-empty { font-size: 10pt; color: #888; font-style: italic; }
    </style>`;

  const header = `
    <div class="fs-header">
      <h1>${esc(meta.formTitle)}</h1>
      <div class="fs-meta">${esc(meta.orgName)} · Gerado em ${esc(meta.generatedAtLabel)}${
        meta.statusLabel ? ` · ${esc(meta.statusLabel)}` : ""
      }</div>
    </div>`;

  const body = sections.length
    ? sections
        .map((sec) => {
          const rows = sec.rows
            .map(
              (r) =>
                `<tr><td class="fs-label">${esc(r.label)}</td><td>${esc(r.value)}</td></tr>`
            )
            .join("");
          return `<div class="fs-section"><h2>${esc(sec.title)}</h2><table class="fs-table">${rows}</table></div>`;
        })
        .join("")
    : `<p class="fs-empty">Nenhuma informação preenchida.</p>`;

  return `${style}${header}${body}`;
}

export interface GeneratedPdf {
  buffer: Buffer;
  filename: string;
  sectionsCount: number;
}

const STATUS_LABEL: Record<string, string> = {
  rascunho: "Rascunho",
  completo: "Formulário completo",
  vinculado: "Vinculado ao contrato",
};

/**
 * Gera o PDF consolidado do formulário. Lança se o form não existir.
 */
export async function generateFormSummaryPdf(formId: string): Promise<GeneratedPdf> {
  const form = await prisma.salesForm.findUnique({
    where: { id: formId },
    select: {
      id: true,
      title: true,
      schemaType: true,
      status: true,
      dataJson: true,
      createdAt: true,
      org: { select: { name: true } },
      attachments: {
        select: { filename: true, category: true },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!form) throw new Error(`SalesForm ${formId} não encontrado`);

  const attachments: FormSummaryAttachment[] = form.attachments.map((a) => ({
    filename: a.filename,
    category: a.category,
  }));

  const sections = buildConsolidatedFormSummary(
    form.dataJson as Record<string, unknown> | null,
    { schemaType: form.schemaType, attachments }
  );

  const html = renderFormSummaryHtml(sections, {
    orgName: form.org?.name ?? "Contractmaker",
    formTitle: form.title || "Resumo do formulário",
    generatedAtLabel: new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }),
    statusLabel: STATUS_LABEL[form.status] ?? undefined,
  });

  const buffer = await exportPdfToBuffer(html, "A4", null);
  return {
    buffer,
    filename: `resumo-formulario-${form.id.slice(0, 8)}.pdf`,
    sectionsCount: sections.length,
  };
}
