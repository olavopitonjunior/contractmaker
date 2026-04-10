import fs from 'fs';

function ensureDir(filePath: string): void {
  const dir = require('path').dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
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
    await page.setContent(html, { waitUntil: 'networkidle0' });
    await page.pdf({ path: outputPath, format: format as any, printBackground: true });
  } finally {
    await browser.close();
  }
}
