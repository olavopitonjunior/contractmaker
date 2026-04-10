import fs from 'fs';
import path from 'path';
import { ensureDir } from '../utils/fs';

export interface ExportOptions {
  htmlPath?: string;
  pdfPath?: string;
  docxPath?: string;
  pdfFormat?: string;
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

export async function exportPdf(html: string, outputPath: string, format = 'A4'): Promise<void> {
  ensureDir(outputPath);
  const puppeteerModule = await import('puppeteer');
  const puppeteer = puppeteerModule.default ?? puppeteerModule;
  const browser = await puppeteer.launch({ headless: 'new' });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    await page.pdf({ path: outputPath, format, printBackground: true });
  } finally {
    await browser.close();
  }
}

export async function exportContrato(html: string, options: ExportOptions): Promise<void> {
  const { htmlPath, pdfPath, docxPath, pdfFormat } = options;
  if (htmlPath) {
    await exportHtml(html, htmlPath);
  }
  if (docxPath) {
    await exportDocx(html, docxPath);
  }
  if (pdfPath) {
    await exportPdf(html, pdfPath, pdfFormat);
  }
}

export function buildOutputPaths(outDir: string, baseName: string): ExportOptions {
  return {
    htmlPath: path.join(outDir, `${baseName}.html`),
    docxPath: path.join(outDir, `${baseName}.docx`),
    pdfPath: path.join(outDir, `${baseName}.pdf`)
  };
}
