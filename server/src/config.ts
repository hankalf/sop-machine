import fs from 'node:fs';
import path from 'node:path';

function int(name: string, fallback: number): number {
  const v = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(v) ? v : fallback;
}

const port = int('PORT', 3001);
const dataDir = path.resolve(process.env.DATA_DIR ?? path.join(process.cwd(), 'data'));

function detectChromium(): string | null {
  const candidates = [
    process.env.CHROMIUM_PATH,
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
    '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome',
  ].filter(Boolean) as string[];
  for (const c of candidates) if (fs.existsSync(c)) return c;
  // Playwright's bundled browser folder (local development containers)
  const pw = '/opt/pw-browsers';
  if (fs.existsSync(pw)) {
    for (const dir of fs.readdirSync(pw).filter((d) => d.startsWith('chromium-')).sort().reverse()) {
      const p = path.join(pw, dir, 'chrome-linux64', 'chrome');
      if (fs.existsSync(p)) return p;
    }
  }
  return null;
}

function appUrl(): string {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, '');
  if (process.env.RAILWAY_PUBLIC_DOMAIN) return `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`;
  return `http://localhost:${port}`;
}

export const config = {
  port,
  isProd: process.env.NODE_ENV === 'production',
  appRoot: process.cwd(),
  dataDir,
  uploadsDir: path.join(dataDir, 'uploads'),
  derivedDir: path.join(dataDir, 'derived'),
  tmpDir: path.join(dataDir, 'tmp'),
  dbPath: path.join(dataDir, 'sop-machine.db'),
  appUrl: appUrl(),
  sessionSecret: process.env.SESSION_SECRET ?? '',
  adminEmail: process.env.ADMIN_EMAIL ?? 'admin@example.com',
  adminPassword: process.env.ADMIN_PASSWORD ?? '',
  maxUploadMb: int('MAX_UPLOAD_MB', 1024),
  chromiumPath: detectChromium(),
  anthropicConfigured: Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN),
};

for (const dir of [config.dataDir, config.uploadsDir, config.derivedDir, config.tmpDir]) {
  fs.mkdirSync(dir, { recursive: true });
}
