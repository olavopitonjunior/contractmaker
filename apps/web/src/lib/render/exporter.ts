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
  if (!style) return html;
  const css = `
    <style>
      @page { margin: 0; }
      body {
        font-family: ${style.fontFamily};
        font-size: ${style.fontSizeBase}pt;
        line-height: ${style.lineHeight};
        color: ${style.colorPrimary};
        margin: 0;
      }
      .editor-image { max-width: 100%; height: auto; }
    </style>
  `;
  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8">${css}</head><body>${html}</body></html>`;
}

export async function exportHtml(html: string, outputPath: string): Promise<void> {
  ensureDir(outputPath);
  fs.writeFileSync(outputPath, html, 'utf-8');
}

export async function exportDocx(html: string, outputPath: string): Promise<void> {
  ensureDir(outputPath);
  const htmlToDocxModule = await import('html-to-docx');
  const htmlToDocx = htmlToDocxModule.default ?? htmlToDocxModule;
  const buffer = await htmlToDocx(html, null, {
    table: { row: { cantSplit: true } },
    footer: true,
    pageNumber: true
  });
  fs.writeFileSync(outputPath, buffer);
}

export async function exportPdf(
  html: string,
  outputPath: string,
  format = 'A4',
  style: DocumentStyleExport | null = null
): Promise<void> {
  ensureDir(outputPath);
  const wrapped = wrapWithStyle(html, style);

  let browser;
  try {
    // Try puppeteer-core + @sparticuz/chromium (Vercel/serverless)
    const puppeteer = require('puppeteer-core');
    let executablePath: string;

    try {
      const chromium = require('@sparticuz/chromium');
      executablePath = await chromium.executablePath();
    } catch {
      // Fallback: look for system Chrome/Chromium
      const possiblePaths = [
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        '/usr/bin/chromium-browser',
        '/usr/bin/google-chrome',
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      ];
      executablePath = possiblePaths.find(p => fs.existsSync(p)) || '';
    }

    if (!executablePath) {
      // Final fallback: try full puppeteer
      const puppeteerFull = require('puppeteer');
      browser = await puppeteerFull.launch({ headless: true });
    } else {
      browser = await puppeteer.launch({
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
        executablePath,
        headless: true,
      });
    }
  } catch {
    // If puppeteer-core not available, try full puppeteer
    const puppeteerFull = require('puppeteer');
    browser = await puppeteerFull.launch({ headless: true });
  }

  try {
    const page = await browser.newPage();
    await page.setContent(wrapped, { waitUntil: 'networkidle0' });

    const defaultFooter = `<div style="width:100%;font-size:9pt;padding:0 25mm;color:#666;text-align:center;"><span class="pageNumber"></span> / <span class="totalPages"></span></div>`;
    const displayHeaderFooter =
      !!style &&
      (!!style.headerHtml ||
        !!style.footerHtml ||
        style.pageNumbers === true);

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
        : undefined,
    });
  } finally {
    await browser.close();
  }
}
