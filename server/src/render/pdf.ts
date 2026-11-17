import { PDFDocument } from 'pdf-lib';
import puppeteer, { type Browser } from 'puppeteer-core';
import { config } from '../config';
import { resolveAsset } from './assets';
import fs from 'node:fs/promises';

const ORIGIN = 'http://sop.render';
let browserPromise: Promise<Browser> | null = null;
let active = 0;
const waiting: (() => void)[] = [];
const MAX_CONCURRENT = 2;

async function getBrowser(): Promise<Browser> {
  if (!config.chromiumPath) {
    throw new Error('PDF export needs Chromium. Install it or set CHROMIUM_PATH (the Docker image includes it).');
  }
  if (!browserPromise) {
    browserPromise = puppeteer
      .launch({
        executablePath: config.chromiumPath,
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--font-render-hinting=none',
          // The renderer only ever loads our own intercepted assets; keep the browser itself quiet too.
          '--disable-background-networking',
          '--disable-component-update',
          '--disable-sync',
          '--no-first-run',
        ],
      })
      .then((b) => {
        b.on('disconnected', () => {
          browserPromise = null;
        });
        return b;
      })
      .catch((err) => {
        browserPromise = null;
        throw err;
      });
  }
  return browserPromise;
}

async function slot<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= MAX_CONCURRENT) await new Promise<void>((r) => waiting.push(r));
  active += 1;
  try {
    return await fn();
  } finally {
    active -= 1;
    waiting.shift()?.();
  }
}

/**
 * Render paged HTML (Paged.js) to PDF in headless Chromium.
 * All assets are served from disk through request interception; external network is blocked.
 */
/**
 * paged: the document uses Paged.js (SOPs). Otherwise it is a plain page sized with CSS @page
 * (QR placards, binder covers) and is printed as soon as fonts and images have loaded.
 */
export async function htmlToPdf(
  html: string,
  meta: { title: string; author: string; subject: string; keywords: string[] },
  opts: { paged?: boolean } = {},
): Promise<Buffer> {
  const paged = opts.paged !== false;
  return slot(async () => {
    const browser = await getBrowser();
    const page = await browser.newPage();
    try {
      await page.setRequestInterception(true);
      page.on('request', (req) => {
        const url = req.url();
        if (url.startsWith('data:')) return void req.continue();
        if (!url.startsWith(`${ORIGIN}/`)) return void req.abort();
        const path = url.slice(ORIGIN.length);
        if (path === '/__document') {
          return void req.respond({ status: 200, contentType: 'text/html; charset=utf-8', body: html });
        }
        resolveAsset(path)
          .then(async (asset) => {
            if (!asset) return req.respond({ status: 404, body: '' });
            return req.respond({ status: 200, contentType: asset.contentType, body: await fs.readFile(asset.file) });
          })
          .catch(() => req.respond({ status: 500, body: '' }));
      });
      await page.goto(`${ORIGIN}/__document`, { waitUntil: 'load', timeout: 120_000 });
      if (paged) await page.waitForFunction('window.__pagedDone === true', { timeout: 180_000, polling: 100 });
      else await page.evaluate('document.fonts.ready.then(() => true)');
      const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true, timeout: 180_000 });
      const doc = await PDFDocument.load(pdf);
      doc.setTitle(meta.title);
      doc.setAuthor(meta.author);
      doc.setSubject(meta.subject);
      doc.setKeywords(meta.keywords);
      doc.setCreator('SOP Machine');
      doc.setProducer('SOP Machine');
      return Buffer.from(await doc.save());
    } finally {
      await page.close().catch(() => {});
    }
  });
}

export async function pdfEngineStatus(): Promise<{ ok: boolean; detail: string }> {
  try {
    const b = await getBrowser();
    return { ok: true, detail: await b.version() };
  } catch (err) {
    return { ok: false, detail: (err as Error).message };
  }
}

export async function closeBrowser() {
  if (browserPromise) await (await browserPromise).close().catch(() => {});
}
