/**
 * Render do resumo consolidado do formulário em HTML e PDF.
 *
 * `generateFormSummaryPdf(formId)` carrega o SalesForm (+ org, attachments),
 * monta as seções via buildConsolidatedFormSummary e gera um PDF em memória
 * (Buffer) com exportPdfToBuffer. O DocumentStyle do CONTRATO continua não se
 * aplicando (style=null); o branding do tenant (logo + cor primária de
 * getOrgBrand) entra direto no HTML do corpo — o headerTemplate do Chromium
 * não tem rede e não carregaria um logo remoto.
 */

import { prisma } from "@/lib/db/prisma";
import { exportPdfToBuffer } from "@/lib/render/exporter";
import { getOrgBrand, type OrgBrand } from "@/lib/tenant/branding";
import {
  buildConsolidatedFormSummary,
  type FormSummaryAttachment,
} from "@/lib/forms/form-summary";
import type { SummarySection } from "@/lib/forms/negotiation-summary";
import { enrichContractData } from "@/lib/services/contract-generation";

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
  /**
   * Quando os dados do form foram alterados pela última vez. O PDF é um
   * SNAPSHOT: se o cliente editar o form depois, o arquivo já enviado por
   * e-mail (e o que fica na pasta do deal) continua com o conteúdo velho, e
   * nada indicava isso — o leitor achava que o campo estava vazio quando na
   * verdade o PDF é que era anterior ao preenchimento.
   */
  dataUpdatedAtLabel?: string;
  /** Logo do tenant (BrandingSettings.logoUrl). Sem logo, o header fica igual ao de antes. */
  logoUrl?: string | null;
  /** Cor primária do tenant em hex; inválida/ausente cai no #1a1a1a original. */
  primaryColor?: string;
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
  // Só comprimentos que o CSS aceita (3/4/6/8) — 5 e 7 dígitos passariam pro
  // <style> e o Chromium descartaria a declaração inteira, header sem régua.
  const primary = /^#([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(
    meta.primaryColor ?? ""
  )
    ? (meta.primaryColor as string)
    : "#1a1a1a";

  const style = `
    <style>
      .fs-header { display: flex; align-items: center; gap: 14px; border-bottom: 2px solid ${primary}; padding-bottom: 8px; margin-bottom: 18px; }
      .fs-logo { height: 44px; width: auto; max-width: 180px; object-fit: contain; flex: none; }
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

  const logo = meta.logoUrl
    ? `<img class="fs-logo" src="${esc(meta.logoUrl)}" alt="${esc(meta.orgName)}">`
    : "";

  const header = `
    <div class="fs-header">
      ${logo}
      <div class="fs-heading">
        <h1>${esc(meta.formTitle)}</h1>
        <div class="fs-meta">${esc(meta.orgName)} · Gerado em ${esc(meta.generatedAtLabel)}${
          meta.statusLabel ? ` · ${esc(meta.statusLabel)}` : ""
        }${
          meta.dataUpdatedAtLabel
            ? ` · Dados de ${esc(meta.dataUpdatedAtLabel)}`
            : ""
        }</div>
      </div>
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
  /** Metadados do form já carregados aqui — poupa um findUnique do caller. */
  title: string;
  orgId: string;
  orgName: string;
}

const LOGO_FETCH_TIMEOUT_MS = 5000;
const LOGO_MAX_BYTES = 2 * 1024 * 1024;

/**
 * Baixa o logo e devolve como data URI. O exporter renderiza com
 * `waitUntil: "networkidle0"` — um `<img>` remoto no HTML faria TODO PDF
 * brandado bloquear no fetch do blob host (até ~30s de navigation timeout) e
 * um 404 imprimiria o glifo de imagem quebrada no documento. Inline com
 * timeout curto: falhou, o header sai limpo sem logo.
 */
async function fetchLogoDataUri(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(LOGO_FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const mime = res.headers.get("content-type")?.split(";")[0]?.trim() ?? "";
    if (!mime.startsWith("image/")) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength === 0 || buf.byteLength > LOGO_MAX_BYTES) return null;
    return `data:${mime};base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
}

const STATUS_LABEL: Record<string, string> = {
  rascunho: "Rascunho",
  completo: "Formulário completo",
  vinculado: "Vinculado ao contrato",
};

/**
 * Passa o dataJson cru do form pelo mesmo enriquecimento que a geração de
 * contrato usa, ANTES de montar o resumo.
 *
 * Sem isso o resumo mente por omissão: `pagamento.sinal_arras`,
 * `recursos_proprios`, `fgts`, `cessao_consorcio` e `alienacao_fiduciaria` são
 * buckets DERIVADOS de `parcelas[].tipo` (ver validation.ts, step5Schema) — no
 * dataJson do form eles são estruturalmente `0` por default do Zod. O gerador
 * lia o cru, via zero em tudo e simplesmente não emitia a seção Pagamento,
 * mesmo num negócio com parcelas preenchidas. Idem `config.municipio_imovel` e
 * `config.data_assinatura`, que só existem depois da ponte do enrich.
 *
 * Clone profundo é obrigatório: `enrichContractData` faz `{...data}` (raso) e
 * MUTA `config` nested — sem clone, contaminaríamos o dataJson em memória.
 * A função é pura (sem DB) e já é chamada sem ctx pelo preview de template.
 * Falha aqui não derruba o resumo: cai pro dado cru.
 */
function prepareDataForSummary(
  dataJson: Record<string, unknown> | null
): Record<string, unknown> | null {
  if (!dataJson) return null;
  try {
    return enrichContractData(structuredClone(dataJson));
  } catch (err) {
    console.warn("[form-summary] enrich falhou, usando dataJson cru:", err);
    return dataJson;
  }
}

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
      updatedAt: true,
      orgId: true,
      org: { select: { name: true } },
      attachments: {
        select: { filename: true, category: true },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!form) throw new Error(`SalesForm ${formId} não encontrado`);

  // O builder cobre venda e locação (2026-08). Qualquer outro schemaType
  // devolveria [] e a gente gerava, persistia na pasta do deal e MANDAVA POR
  // E-MAIL um PDF com "Nenhuma informação preenchida." — falha silenciosa pior
  // que erro; por isso o guard continua, só que com a lista suportada.
  const SUPPORTED_SCHEMAS = [
    "compra_venda_v1",
    "locacao_residencial_v1",
    "locacao_comercial_v1",
  ];
  if (!SUPPORTED_SCHEMAS.includes(form.schemaType)) {
    throw new Error(
      "Resumo consolidado disponível apenas para formulários de venda e locação"
    );
  }

  const attachments: FormSummaryAttachment[] = form.attachments.map((a) => ({
    filename: a.filename,
    category: a.category,
  }));

  // O enrich é de VENDA (buckets de pagamento derivados de parcelas[].tipo);
  // locação já guarda os valores canônicos no dataJson e passa cru.
  const preparedData =
    form.schemaType === "compra_venda_v1"
      ? prepareDataForSummary(form.dataJson as Record<string, unknown> | null)
      : (form.dataJson as Record<string, unknown> | null);

  const sections = buildConsolidatedFormSummary(preparedData, {
    schemaType: form.schemaType,
    attachments,
  });

  // Branding é best-effort: falha na resolução não pode derrubar o resumo.
  let brand: OrgBrand | null = null;
  try {
    brand = await getOrgBrand(form.orgId);
  } catch (err) {
    console.warn("[form-summary] falha ao resolver branding, PDF sem logo:", err);
  }

  const logoDataUri = brand?.logoUrl
    ? await fetchLogoDataUri(brand.logoUrl)
    : null;

  const orgName = form.org?.name ?? "Contractmaker";
  const title = form.title || "Resumo do formulário";

  const html = renderFormSummaryHtml(sections, {
    orgName,
    logoUrl: logoDataUri,
    primaryColor: brand?.primaryColor,
    formTitle: title,
    generatedAtLabel: new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }),
    statusLabel: STATUS_LABEL[form.status] ?? undefined,
    dataUpdatedAtLabel: form.updatedAt.toLocaleString("pt-BR", {
      timeZone: "America/Sao_Paulo",
    }),
  });

  const buffer = await exportPdfToBuffer(html, "A4", null);
  return {
    buffer,
    filename: `resumo-formulario-${form.id.slice(0, 8)}.pdf`,
    sectionsCount: sections.length,
    title,
    orgId: form.orgId,
    orgName,
  };
}
