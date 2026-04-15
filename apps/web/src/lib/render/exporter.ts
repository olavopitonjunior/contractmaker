import fs from 'fs';

export interface DocumentStyleExport {
  fontFamily: string;
  fontSizeBase: number;
  lineHeight: number;
  marginTopMm: number;
  marginBottomMm: number;
  marginLeftMm: number;
  marginRightMm: number;
  colorPrimary: string;
  headerHtml: string | null;
  footerHtml: string | null;
  pageNumbers: boolean;
}

function ensureDir(filePath: string): void {
  const dir = require('path').dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
}

function wrapWithStyle(html: string, style: DocumentStyleExport | null): string {
  // Defaults mirror the editor's .a4-page typography so the PDF matches the
  // on-screen preview even when no DocumentStyle preset is configured.
  const fontFamily = style?.fontFamily || '"Times New Roman", "Tinos", Georgia, serif';
  const fontSizeBase = style?.fontSizeBase ?? 12;
  const lineHeight = style?.lineHeight ?? 1.65;
  const colorPrimary = style?.colorPrimary || '#1a1a1a';
  const colorAccent = '#C97B0A';

  // Inline-SVG ornaments mirror the ones in globals.css so the PDF matches.
  const ornamentSmall =
    "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='96' height='10' viewBox='0 0 96 10'><line x1='4' y1='5' x2='40' y2='5' stroke='%23C97B0A' stroke-width='0.75'/><path d='M48 1 L52 5 L48 9 L44 5 Z' fill='%23C97B0A'/><line x1='56' y1='5' x2='92' y2='5' stroke='%23C97B0A' stroke-width='0.75'/></svg>";
  const ornamentLarge =
    "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='140' height='14' viewBox='0 0 140 14'><line x1='0' y1='7' x2='56' y2='7' stroke='%23C97B0A' stroke-width='1'/><path d='M70 1 L76 7 L70 13 L64 7 Z' fill='%23C97B0A'/><line x1='84' y1='7' x2='140' y2='7' stroke='%23C97B0A' stroke-width='1'/></svg>";

  // NOTE: do NOT set `@page { margin: 0 }` here. Puppeteer's `page.pdf({ margin })`
  // option is authoritative — any `@page { margin }` rule in the CSS will fight
  // with it and can result in text hugging the page edge. Let Puppeteer drive.
  const css = `
    <style>
      body {
        font-family: ${fontFamily};
        font-size: ${fontSizeBase}pt;
        line-height: ${lineHeight};
        color: ${colorPrimary};
        margin: 0;
        hyphens: auto;
        -webkit-hyphens: auto;
        font-feature-settings: "liga" 1, "dlig" 1, "kern" 1;
        font-variant-ligatures: common-ligatures discretionary-ligatures;
        font-kerning: normal;
        text-rendering: optimizeLegibility;
      }
      p {
        text-align: justify;
        text-justify: inter-word;
        text-align-last: left;
        margin: 0.75em 0;
        orphans: 3;
        widows: 3;
      }
      h1 {
        text-align: center;
        text-transform: uppercase;
        font-size: 1.5em;
        font-weight: 700;
        letter-spacing: 0.04em;
        margin: 1.6em 0 1em;
        color: ${colorPrimary};
        page-break-after: avoid;
        break-after: avoid;
      }
      h2 {
        text-align: center;
        text-transform: uppercase;
        font-size: 1.15em;
        font-weight: 700;
        letter-spacing: 0.03em;
        margin: 1.5em 0 0.8em;
        color: ${colorAccent};
        page-break-after: avoid;
        break-after: avoid;
      }
      h2::after {
        content: "";
        display: block;
        width: 96px;
        height: 10px;
        margin: 0.35em auto 0;
        background-image: url("${ornamentSmall}");
        background-repeat: no-repeat;
        background-position: center;
        opacity: 0.75;
      }
      h3 {
        text-align: center;
        font-size: 1em;
        font-weight: 700;
        letter-spacing: 0.02em;
        margin: 1.1em 0 0.5em;
        color: ${colorPrimary};
        page-break-after: avoid;
        break-after: avoid;
      }
      hr {
        border: none;
        border-top: 1px solid #888;
        margin: 1.3em 25%;
        opacity: 0.5;
      }
      strong { font-weight: 700; }
      em { font-style: italic; }
      ul, ol { padding-left: 2.25em; margin: 0.8em 0; }
      li { margin: 0.25em 0; text-align: justify; }
      blockquote {
        border-left: 3px solid ${colorAccent};
        padding: 0.5em 1em;
        margin: 1em 0;
        color: #555;
        font-style: italic;
      }
      table { border-collapse: collapse; margin: 1em 0; width: 100%; }
      th, td { border: 1px solid #888; padding: 0.4em 0.6em; font-size: 0.95em; }
      th { background: #f5f1e8; font-weight: 700; text-align: left; }
      .assinaturas { margin-top: 2.5em; }
      .assinaturas p { text-align: center; text-align-last: center; margin: 1.2em 0 0.3em; hyphens: none; }
      .assinaturas h3 { margin-top: 1.8em; font-size: 0.95em; }
      .editor-image { max-width: 100%; height: auto; display: block; margin: 1em auto; }
      .page-break { display: block; page-break-after: always; break-after: page; }
      p.doc-intro { text-indent: 0; margin-top: 1.5em; }
      p.doc-intro::first-letter {
        float: left;
        font-family: Georgia, "Times New Roman", serif;
        font-size: 3.4em;
        line-height: 0.85;
        padding: 0.05em 0.1em 0 0;
        margin-right: 0.05em;
        font-weight: 700;
        color: ${colorAccent};
      }
      /* Cover page */
      .cover-page {
        min-height: 240mm;
        display: flex;
        flex-direction: column;
        align-items: center;
        padding: 30mm 20mm 20mm;
        text-align: center;
        page-break-after: always;
        break-after: page;
      }
      .cover-page .cover-brand {
        font-size: 10pt;
        letter-spacing: 0.2em;
        text-transform: uppercase;
        color: #555;
        padding-bottom: 0.6em;
        border-bottom: 1px solid #555;
        min-width: 240px;
      }
      .cover-page .cover-title {
        font-size: 26pt;
        font-weight: 700;
        line-height: 1.15;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        margin: 40mm 0 0.8em;
        max-width: 85%;
      }
      .cover-page .cover-subtitle {
        font-size: 13pt;
        font-style: italic;
        color: ${colorAccent};
      }
      .cover-page .cover-ornament {
        width: 140px;
        height: 14px;
        margin: 20mm auto 10mm;
        background-image: url("${ornamentLarge}");
        background-repeat: no-repeat;
        background-position: center;
      }
      .cover-page .cover-parties {
        font-size: 12pt;
        line-height: 1.9;
      }
      .cover-page .cover-parties .cover-label {
        text-transform: uppercase;
        letter-spacing: 0.12em;
        font-size: 9pt;
        color: #555;
        display: block;
        margin-top: 1em;
      }
      .cover-page .cover-parties strong {
        display: block;
        font-size: 14pt;
        margin-bottom: 0.3em;
      }
      .cover-page .cover-property {
        margin-top: 14mm;
        padding: 1em 2em;
        border-top: 1px solid #555;
        border-bottom: 1px solid #555;
        max-width: 85%;
        font-style: italic;
      }
      .cover-page .cover-footer {
        font-size: 10pt;
        color: #555;
        margin-top: auto;
        padding-top: 20mm;
        letter-spacing: 0.05em;
      }
      .cover-page p,
      .cover-page div {
        text-align: center;
        text-align-last: center;
        hyphens: none;
      }
    </style>
  `;
  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8">${css}</head><body>${html}</body></html>`;
}

export async function exportHtml(html: string, outputPath: string): Promise<void> {
  ensureDir(outputPath);
  fs.writeFileSync(outputPath, html, 'utf-8');
}

/**
 * Convert mm to twips (Word's internal unit — 1 inch = 1440 twips = 25.4 mm).
 */
function mmToTwip(mm: number): number {
  return Math.round(mm * 56.692913);
}

/**
 * Preprocess the editor HTML into a DOCX-friendly version.
 *
 * html-to-docx ignores most class-based CSS (everything in globals.css is
 * lost during conversion), so we re-express the essential typography as
 * inline styles on the key tags: headings, paragraphs, signature block,
 * cover page. Ornaments, drop caps, and ::before/::after pseudo elements
 * are dropped — DOCX doesn't render them.
 */
function htmlForDocx(
  html: string,
  fontFamily: string,
  fontSizeBase: number,
  colorPrimary: string,
  colorAccent: string
): string {
  let out = html;

  // 1. Cover page — flatten into centered paragraphs with a forced page break
  //    after. The structural <section><div> hierarchy is discarded.
  out = out.replace(
    /<section class="cover-page">([\s\S]*?)<\/section>/g,
    (_match, inner: string) => {
      const transformed = inner
        .replace(
          /<div class="cover-brand">([\s\S]*?)<\/div>/g,
          '<p style="text-align: center; font-size: 10pt; letter-spacing: 2pt; text-transform: uppercase; color: #555; margin: 0 0 8pt;">$1</p>'
        )
        .replace(
          /<div class="cover-title">([\s\S]*?)<\/div>/g,
          `<p style="text-align: center; font-size: 24pt; font-weight: bold; text-transform: uppercase; margin: 60pt 0 12pt; color: ${colorPrimary};">$1</p>`
        )
        .replace(
          /<div class="cover-subtitle">([\s\S]*?)<\/div>/g,
          `<p style="text-align: center; font-size: 13pt; font-style: italic; color: ${colorAccent}; margin: 0 0 24pt;">$1</p>`
        )
        .replace(
          /<div class="cover-ornament"><\/div>/g,
          '<p style="text-align: center; margin: 16pt 0;">❖</p>'
        )
        .replace(
          /<div class="cover-parties">([\s\S]*?)<\/div>/g,
          '<p style="text-align: center; font-size: 12pt; margin: 12pt 0;">$1</p>'
        )
        .replace(
          /<span class="cover-label">([\s\S]*?)<\/span>/g,
          '<span style="font-size: 9pt; letter-spacing: 1pt; text-transform: uppercase; color: #555;">$1</span><br />'
        )
        .replace(
          /<div class="cover-property">([\s\S]*?)<\/div>/g,
          '<p style="text-align: center; font-style: italic; margin: 24pt 40pt; padding: 8pt 0; border-top: 1pt solid #888; border-bottom: 1pt solid #888;">$1</p>'
        )
        .replace(
          /<div class="cover-footer">([\s\S]*?)<\/div>/g,
          '<p style="text-align: center; font-size: 10pt; color: #555; margin: 40pt 0 0;">$1</p>'
        );
      // Trailing paragraph with a forced page break — html-to-docx respects
      // page-break-before on a paragraph.
      return `${transformed}<p style="page-break-before: always;">&nbsp;</p>`;
    }
  );

  // 2. Signature block — centered lines, tight spacing
  out = out.replace(
    /<div class="assinaturas">([\s\S]*?)<\/div>\s*<\/div>\s*$/m,
    (_match, inner: string) => {
      const transformed = inner
        .replace(/<h3>/g, '<h3 style="text-align: center; font-weight: bold; font-size: 11pt; margin: 24pt 0 6pt;">')
        .replace(/<p>/g, '<p style="text-align: center; margin: 10pt 0 2pt;">');
      return `<div>${transformed}</div></div>`;
    }
  );

  // 3. Generic heading injections — only touch tags without an existing `style`
  out = out.replace(
    /<h1(?![^>]*\sstyle=)([^>]*)>/g,
    `<h1$1 style="text-align: center; text-transform: uppercase; font-size: 16pt; font-weight: bold; margin: 24pt 0 14pt; color: ${colorPrimary};">`
  );
  out = out.replace(
    /<h2(?![^>]*\sstyle=)([^>]*)>/g,
    `<h2$1 style="text-align: center; text-transform: uppercase; font-size: 13pt; font-weight: bold; margin: 20pt 0 10pt; color: ${colorAccent};">`
  );
  out = out.replace(
    /<h3(?![^>]*\sstyle=)([^>]*)>/g,
    `<h3$1 style="text-align: center; font-size: 11pt; font-weight: bold; margin: 14pt 0 6pt;">`
  );

  // 4. Paragraphs — justified body text. Skip paragraphs already carrying a
  //    style attribute (e.g. the cover page / signature overrides above).
  out = out.replace(
    /<p(?![^>]*\sstyle=)([^>]*)>/g,
    '<p$1 style="text-align: justify; margin: 6pt 0;">'
  );

  // 5. Horizontal rules — simplified
  out = out.replace(
    /<hr\s*\/?>/g,
    '<p style="text-align: center; margin: 8pt 0; color: #999;">— — —</p>'
  );

  // 6. Wrap the whole thing in a div with the default font so html-to-docx
  //    picks it up when it doesn't find a specific style on a descendant.
  return `<div style="font-family: '${fontFamily}'; font-size: ${fontSizeBase}pt;">${out}</div>`;
}

export async function exportDocx(
  html: string,
  outputPath: string,
  style: DocumentStyleExport | null = null
): Promise<void> {
  ensureDir(outputPath);

  // Defaults mirror the PDF exporter — stay consistent so PDF and DOCX look alike.
  const fontFamily = style?.fontFamily || 'Times New Roman';
  const fontSizeBase = style?.fontSizeBase ?? 12;
  const colorPrimary = style?.colorPrimary || '#1a1a1a';
  const colorAccent = '#C97B0A';
  const marginTopMm = style?.marginTopMm ?? 30;
  const marginBottomMm = style?.marginBottomMm ?? 25;
  const marginLeftMm = style?.marginLeftMm ?? 35;
  const marginRightMm = style?.marginRightMm ?? 25;

  const processed = htmlForDocx(html, fontFamily, fontSizeBase, colorPrimary, colorAccent);

  const defaultFooter = `<p style="text-align:center; font-size:9pt; color:#666;"><span style="font-size:9pt;">Página </span></p>`;
  const footerHtml = style?.footerHtml || defaultFooter;

  const htmlToDocxModule = await import('html-to-docx');
  const htmlToDocx = (htmlToDocxModule.default ?? htmlToDocxModule) as (
    html: string,
    headerHtml: string | null,
    options: Record<string, unknown>,
    footerHtml?: string
  ) => Promise<Buffer>;

  const buffer = await htmlToDocx(
    processed,
    null,
    {
      orientation: 'portrait',
      margins: {
        top: mmToTwip(marginTopMm),
        right: mmToTwip(marginRightMm),
        bottom: mmToTwip(marginBottomMm),
        left: mmToTwip(marginLeftMm),
        header: mmToTwip(12),
        footer: mmToTwip(12),
        gutter: 0,
      },
      font: fontFamily,
      fontSize: fontSizeBase * 2, // html-to-docx uses half-points (24 = 12pt)
      table: { row: { cantSplit: true } },
      footer: true,
      pageNumber: true,
      decodeUnicode: true,
    },
    footerHtml
  );
  fs.writeFileSync(outputPath, buffer);
}

/**
 * Launch Chromium for PDF rendering.
 *
 * Strategy:
 *   1. On Vercel / AWS Lambda: use `@sparticuz/chromium` which ships a
 *      serverless-friendly Chromium binary extracted to /tmp at runtime.
 *   2. Local dev: use `puppeteer-core` pointing at a system Chrome install
 *      (Windows / macOS / Linux common paths).
 *   3. If neither works, throw a descriptive error instead of silently
 *      trying `puppeteer` (full) which downloads Chrome on-demand and fails
 *      inside read-only serverless filesystems.
 */
async function launchBrowser() {
  const isServerless = !!(
    process.env.VERCEL ||
    process.env.AWS_LAMBDA_FUNCTION_NAME ||
    process.env.LAMBDA_TASK_ROOT
  );

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const puppeteer = require('puppeteer-core');

  if (isServerless) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const chromium = require('@sparticuz/chromium');
    const executablePath = await chromium.executablePath();
    if (!executablePath) {
      throw new Error(
        '@sparticuz/chromium retornou executablePath vazio — verifique se o pacote está instalado e se next.config.js tem serverComponentsExternalPackages'
      );
    }
    return puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath,
      headless: chromium.headless ?? true,
    });
  }

  // Local dev: point at a system Chrome installation
  const possiblePaths = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ];
  const executablePath = possiblePaths.find((p) => fs.existsSync(p));
  if (!executablePath) {
    throw new Error(
      'Chrome não encontrado no sistema para dev local. Instale o Google Chrome ou defina PUPPETEER_EXECUTABLE_PATH.'
    );
  }
  return puppeteer.launch({
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || executablePath,
    headless: true,
  });
}

export async function exportPdf(
  html: string,
  outputPath: string,
  format = 'A4',
  style: DocumentStyleExport | null = null
): Promise<void> {
  ensureDir(outputPath);
  const wrapped = wrapWithStyle(html, style);

  const browser = await launchBrowser();

  try {
    const page = await browser.newPage();
    await page.setContent(wrapped, { waitUntil: 'networkidle0' });

    const defaultFooter = `<div style="width:100%;font-size:9pt;padding:0 25mm;color:#666;text-align:center;"><span class="pageNumber"></span> / <span class="totalPages"></span></div>`;
    // Always show the page-number footer unless explicitly disabled by the preset.
    const displayHeaderFooter = style?.pageNumbers !== false;

    // Classic typographic margins when no preset is configured: larger left
    // margin for binding, slightly generous top for header breathing room.
    const classicMargin = { top: '30mm', bottom: '25mm', left: '35mm', right: '25mm' };

    await page.pdf({
      path: outputPath,
      format: format as any,
      printBackground: true,
      displayHeaderFooter,
      headerTemplate: style?.headerHtml || '<div></div>',
      footerTemplate:
        style?.footerHtml || (style?.pageNumbers !== false ? defaultFooter : '<div></div>'),
      margin: style
        ? {
            top: `${style.marginTopMm}mm`,
            bottom: `${style.marginBottomMm}mm`,
            left: `${style.marginLeftMm}mm`,
            right: `${style.marginRightMm}mm`,
          }
        : classicMargin,
    });
  } finally {
    await browser.close();
  }
}
