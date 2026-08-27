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

  // O `wrapWithStyle` do exporter aplica a tipografia de CONTRATO ao que não
  // traz DocumentStyle: h1/h2 centralizados, em CAIXA ALTA, dourados, e o h2
  // com o ornamento (losango) do `h2::after`. Num documento que é uma sequência
  // de tabelas label/valor isso saía como um contrato mal impresso — foi a
  // "quebra de layout" relatada em 2026-08-25. Estas regras vêm DEPOIS no
  // documento, então vencem por ordem, na mesma especificidade.
  const reset = `
      h1, h2, h3 { text-align: left; text-transform: none; letter-spacing: normal; color: inherit; }
      h2::after, h1::after, h3::after { content: none; }
      p { text-align: left; text-indent: 0; hyphens: none; }`;

  const style = `
    <style>${reset}
      .fs-header { display: flex; align-items: center; gap: 14px; border-bottom: 2px solid ${primary}; padding-bottom: 8px; margin-bottom: 18px; }
      .fs-logo { height: 44px; width: auto; max-width: 180px; object-fit: contain; flex: none; }
      .fs-header h1 { font-size: 18pt; margin: 0 0 4px; color: ${primary}; }
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
  /**
   * Prévia para o corpo do e-mail (a tabela de destaques do `FormSummaryEmail`
   * existia e nunca recebia dados). Uma linha por seção-chave.
   */
  highlights: { label: string; value: string }[];
}

/**
 * Perfil de página do RESUMO — não é contrato.
 *
 * Sem isto o exporter caía no `classicMargin` de contrato
 * (30/25/35/25mm, assimétrico para encadernação): sobravam 150mm de coluna útil
 * numa página de tabelas, deslocados para a direita, e o rodapé de numeração —
 * com `padding: 0 25mm` fixo — não batia com os 35mm da esquerda. Era a
 * "quebra de margem" que a corretora viu no PDF.
 *
 * Margens simétricas, fonte sem serifa e entrelinha menor: é um documento para
 * conferir dados, não para ler corrido.
 */
const SUMMARY_PAGE_STYLE = {
  fontFamily: '"Helvetica Neue", Helvetica, Arial, sans-serif',
  fontSizeBase: 10,
  lineHeight: 1.4,
  marginTopMm: 16,
  marginBottomMm: 16,
  marginLeftMm: 16,
  marginRightMm: 16,
  colorPrimary: "#1a1a1a",
  headerHtml: null,
  // Rodapé com o MESMO recuo das margens do corpo (o default do exporter usa
  // 25mm fixos, herdados do contrato).
  footerHtml:
    '<div style="width:100%;font-size:8pt;padding:0 16mm;color:#666;text-align:right;"><span class="pageNumber"></span> / <span class="totalPages"></span></div>',
  pageNumbers: true,
};

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
  // Cada `return null` daqui vira um PDF sem logo, e todos eram MUDOS: quando a
  // corretora reportou "o resumo saiu sem o logo" não havia como saber se o
  // tenant não tinha configurado, se o blob respondeu 404 ou se o fetch estourou
  // o timeout. Agora cada motivo deixa rastro.
  const falhou = (motivo: string, extra?: unknown) => {
    console.warn(`[form-summary] logo não embutido (${motivo})`, extra ?? "");
    return null;
  };
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(LOGO_FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return falhou("HTTP " + res.status, url);
    const mime = res.headers.get("content-type")?.split(";")[0]?.trim() ?? "";
    if (!mime.startsWith("image/")) return falhou("content-type não é imagem", mime);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength === 0) return falhou("arquivo vazio", url);
    if (buf.byteLength > LOGO_MAX_BYTES) {
      return falhou(`arquivo acima de ${LOGO_MAX_BYTES} bytes`, buf.byteLength);
    }
    return `data:${mime};base64,${buf.toString("base64")}`;
  } catch (err) {
    return falhou("fetch falhou ou estourou o timeout", err);
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

  let logoDataUri: string | null = null;
  if (brand?.logoUrl) {
    logoDataUri = await fetchLogoDataUri(brand.logoUrl);
  } else {
    // O caso mais provável de "o resumo saiu sem o logo" é este: o tenant nunca
    // preencheu o logo em Configurações → Perfil. Sem o log, indistinguível de
    // um bug do PDF.
    console.warn(
      `[form-summary] org ${form.orgId} não tem BrandingSettings.logoUrl — PDF sai só com o nome`
    );
  }

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

  const buffer = await exportPdfToBuffer(html, "A4", SUMMARY_PAGE_STYLE);
  return {
    buffer,
    filename: `resumo-formulario-${form.id.slice(0, 8)}.pdf`,
    sectionsCount: sections.length,
    title,
    orgId: form.orgId,
    orgName,
    // Prévia para o corpo do e-mail. O template já tinha a tabela de destaques,
    // mas ninguém passava `highlights` — o e-mail chegava dizendo só "o PDF
    // está anexado". A primeira linha de cada uma das três primeiras seções é
    // a linha IDENTIFICADORA delas (as seções vêm ordenadas Partes → Imóvel →
    // Aluguel/Pagamento), então é o resumo do resumo sem escolher campo a dedo.
    highlights: sections
      .slice(0, 3)
      .map((sec) => sec.rows[0])
      .filter((r) => Boolean(r))
      .map((r) => ({ label: r.label, value: r.value })),
  };
}
