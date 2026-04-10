import fs from 'fs';
import { ensureDir } from './fs';

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
  const browser = await puppeteer.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    await page.pdf({ path: outputPath, format: format as any, printBackground: true });
  } finally {
    await browser.close();
  }
}
