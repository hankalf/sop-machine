import QRCode from 'qrcode';
import { languageInfo } from '../../../shared/defaults';
import type { AppSettings, Category, LanguageMode, MediaItem, Revision, Sop, SopTranslation, TemplateDesign } from '../../../shared/types';
import { config } from '../config';
import { mediaMap } from '../services/media';
import { getSettings } from '../services/settings';
import { listRevisions } from '../services/sops';
import { getCategory, resolveTemplate } from '../services/templates';

export type RenderMode = 'web' | 'paged';
export type RenderPurpose = 'view' | 'preview' | 'pdf';

export interface RenderLanguage {
  mode: LanguageMode;
  code: string;
  rtl: boolean;
  t: SopTranslation | null;
}

export interface RenderContext {
  lang: RenderLanguage;
  /** URL prefix for media; public station pages use their own token-scoped prefix. */
  mediaBase: string;
  sop: Sop;
  category: Category | null;
  design: TemplateDesign;
  templateName: string;
  settings: AppSettings;
  revisions: Revision[];
  media: Map<string, MediaItem>;
  mode: RenderMode;
  purpose: RenderPurpose;
  sopUrl: string;
  sopQr: string | null;
  videoQrs: Map<string, string>;
  printedDate: string;
}

export function sopUrl(sopId: string) {
  return `${config.appUrl}/sops/${sopId}`;
}

export function videoUrl(sopId: string, mediaId: string) {
  return `${config.appUrl}/sops/${sopId}?media=${mediaId}`;
}

export function referencedMediaIds(sop: Sop): string[] {
  return [
    ...sop.content.steps.flatMap((s) => s.media.map((m) => m.mediaId)),
    ...sop.content.attachments.map((m) => m.mediaId),
  ];
}

export async function qrDataUri(text: string): Promise<string> {
  return QRCode.toDataURL(text, { margin: 1, width: 240, errorCorrectionLevel: 'M' });
}

export async function buildContext(
  sop: Sop,
  opts: {
    mode: RenderMode;
    purpose: RenderPurpose;
    design?: TemplateDesign;
    revisions?: Revision[];
    settings?: AppSettings;
    category?: Category | null;
    /** Language code to render ('en' or a translated language). */
    language?: string;
    bilingual?: boolean;
    /** Translation to use (already looked up by the caller). */
    translation?: SopTranslation | null;
    mediaBase?: string;
  },
): Promise<RenderContext> {
  const category = opts.category !== undefined ? opts.category : getCategory(sop.categoryId);
  const template = opts.design ? null : resolveTemplate(sop.templateId, category);
  const design = opts.design ?? template!.design;
  const settings = opts.settings ?? getSettings();
  const media = mediaMap(referencedMediaIds(sop));
  const url = sopUrl(sop.id);

  const videoQrs = new Map<string, string>();
  if (opts.mode === 'paged' && settings.export.videoHandling === 'qr') {
    for (const m of media.values()) {
      if (m.kind === 'video') videoQrs.set(m.id, await qrDataUri(videoUrl(sop.id, m.id)));
    }
  }

  const t = opts.language && opts.language !== 'en' ? (opts.translation ?? null) : null;
  const lang: RenderLanguage = t
    ? { mode: opts.bilingual ? 'bi' : 'tr', code: t.language, rtl: !!languageInfo(t.language).rtl, t }
    : { mode: 'en', code: 'en', rtl: false, t: null };

  return {
    lang,
    mediaBase: opts.mediaBase ?? '/api/media',
    sop,
    category,
    design,
    templateName: template?.name ?? '',
    settings,
    revisions: opts.revisions ?? listRevisions(sop.id),
    media,
    mode: opts.mode,
    purpose: opts.purpose,
    sopUrl: url,
    sopQr: design.cover.showQr ? await qrDataUri(url) : null,
    videoQrs,
    printedDate: new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }),
  };
}
