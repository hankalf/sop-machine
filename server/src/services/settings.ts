import { deepMerge, defaultSettings } from '../../../shared/defaults';
import type { AppSettings, PublicBranding } from '../../../shared/types';
import { getMeta, setMeta } from '../db';

let cache: AppSettings | null = null;

export function getSettings(): AppSettings {
  if (cache) return cache;
  const raw = getMeta('settings');
  cache = deepMerge(defaultSettings(), raw ? JSON.parse(raw) : {});
  return cache;
}

export function updateSettings(patch: unknown): AppSettings {
  const next = deepMerge(getSettings(), patch);
  next.numbering.digits = Math.min(6, Math.max(1, Math.round(next.numbering.digits)));
  next.ai.maxFrames = Math.min(80, Math.max(5, Math.round(next.ai.maxFrames)));
  next.workflow.reviewIntervalMonths = Math.min(60, Math.max(0, Math.round(next.workflow.reviewIntervalMonths)));
  setMeta('settings', JSON.stringify(next));
  cache = next;
  return next;
}

export function publicBranding(): PublicBranding {
  const s = getSettings();
  return {
    companyName: s.branding.companyName,
    siteName: s.branding.siteName,
    hasLogo: !!s.branding.logoMediaId,
    logoVersion: s.branding.logoMediaId,
    appColor: s.branding.appColor,
  };
}
