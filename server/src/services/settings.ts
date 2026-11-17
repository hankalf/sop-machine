import { deepMerge, defaultSettings } from '../../../shared/defaults';
import type { AppSettings, PublicBranding } from '../../../shared/types';
import { getMeta, setMeta } from '../db';
import { badRequest } from '../util';
import { validTimeZone } from './zoned';

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
  if (next.schedule.timezone && !validTimeZone(next.schedule.timezone)) throw badRequest(`Unknown time zone "${next.schedule.timezone}"`);
  const hm = /^([01]\d|2[0-3]):[0-5]\d$/;
  next.schedule.shifts = next.schedule.shifts
    .filter((s) => s && s.name?.trim())
    .map((s, i) => {
      if (!hm.test(s.start) || !hm.test(s.end)) throw badRequest(`Shift "${s.name}" needs start and end times like 06:00`);
      if (s.start === s.end) throw badRequest(`Shift "${s.name}" starts and ends at the same time`);
      return { id: s.id || `s${Date.now().toString(36)}${i}`, name: s.name.trim().slice(0, 40), start: s.start, end: s.end };
    });
  next.actions.defaultDueDays = Math.min(60, Math.max(0, Math.round(next.actions.defaultDueDays)));
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
