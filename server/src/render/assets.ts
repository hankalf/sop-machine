import fs from 'node:fs';
import path from 'node:path';
import { FONT_OPTIONS } from '../../../shared/defaults';
import type { FontKey } from '../../../shared/types';
import { config } from '../config';
import { ensureVariant, findMedia, type Variant } from '../services/media';
import { getSettings } from '../services/settings';

export interface Asset {
  file: string;
  contentType: string;
}

const STATIC: Record<string, Asset> = {
  'paged.polyfill.js': {
    file: path.join(config.appRoot, 'node_modules/pagedjs/dist/paged.polyfill.min.js'),
    contentType: 'application/javascript; charset=utf-8',
  },
  'paged-config.js': {
    file: path.join(config.appRoot, 'server/assets/paged-config.js'),
    contentType: 'application/javascript; charset=utf-8',
  },
  'paged-preview.js': {
    file: path.join(config.appRoot, 'server/assets/paged-preview.js'),
    contentType: 'application/javascript; charset=utf-8',
  },
};

const fontDir = (key: string) => path.join(config.appRoot, 'node_modules/@fontsource', key, 'files');

/** Weights available for a font (latin subset). */
const weightCache = new Map<string, number[]>();
export function fontWeights(key: FontKey): number[] {
  if (weightCache.has(key)) return weightCache.get(key)!;
  const re = new RegExp(`^${key}-latin-(\\d+)-normal\\.woff2$`);
  let weights: number[] = [];
  try {
    weights = fs
      .readdirSync(fontDir(key))
      .map((f) => re.exec(f)?.[1])
      .filter(Boolean)
      .map(Number)
      .sort((a, b) => a - b);
  } catch {
    weights = [];
  }
  weightCache.set(key, weights);
  return weights;
}

export function fontFaceCss(keys: FontKey[]): string {
  const css: string[] = [];
  for (const key of new Set(keys)) {
    const opt = FONT_OPTIONS.find((f) => f.key === key);
    if (!opt) continue;
    for (const w of fontWeights(key).filter((w) => [400, 500, 600, 700].includes(w))) {
      css.push(
        `@font-face{font-family:'${opt.family}';font-style:normal;font-weight:${w};font-display:block;src:url('/render-assets/fonts/${key}/${key}-latin-${w}-normal.woff2') format('woff2');}`,
      );
      if (fs.existsSync(path.join(fontDir(key), `${key}-latin-${w}-italic.woff2`))) {
        css.push(
          `@font-face{font-family:'${opt.family}';font-style:italic;font-weight:${w};font-display:block;src:url('/render-assets/fonts/${key}/${key}-latin-${w}-italic.woff2') format('woff2');}`,
        );
      }
    }
  }
  return css.join('\n');
}

/**
 * Resolve a URL path used inside rendered SOP HTML to a file on disk.
 * Shared by the Express routes (in-app preview) and the headless browser (PDF export),
 * so the PDF engine never needs network access or a login session.
 */
export async function resolveAsset(urlPath: string): Promise<Asset | null> {
  const p = decodeURIComponent(urlPath.split('?')[0]);
  let m = /^\/render-assets\/fonts\/([a-z0-9-]+)\/([a-z0-9-]+\.woff2)$/.exec(p);
  if (m) {
    const [, key, file] = m;
    if (!FONT_OPTIONS.some((f) => f.key === key)) return null;
    const full = path.join(fontDir(key), file);
    return fs.existsSync(full) ? { file: full, contentType: 'font/woff2' } : null;
  }
  m = /^\/render-assets\/([a-z.-]+\.js)$/.exec(p);
  if (m) return STATIC[m[1]] ?? null;
  m = /^\/api\/media\/([a-z0-9]+)\/(thumb|display|display-hq|poster)$/.exec(p);
  if (m) {
    if (!findMedia(m[1])) return null;
    return ensureVariant(m[1], m[2] as Variant);
  }
  if (p === '/api/public/logo') {
    const id = getSettings().branding.logoMediaId;
    if (!id || !findMedia(id)) return null;
    return ensureVariant(id, 'display');
  }
  return null;
}
