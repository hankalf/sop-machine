import type {
  AppSettings,
  CalloutType,
  ChecklistConfig,
  FontKey,
  LanguageOption,
  SectionConfig,
  SectionKey,
  SopContent,
  TemplateDesign,
} from './types';

export const FONT_OPTIONS: { key: FontKey; label: string; family: string; serif: boolean }[] = [
  { key: 'inter', label: 'Inter', family: 'Inter', serif: false },
  { key: 'roboto', label: 'Roboto', family: 'Roboto', serif: false },
  { key: 'open-sans', label: 'Open Sans', family: 'Open Sans', serif: false },
  { key: 'lato', label: 'Lato', family: 'Lato', serif: false },
  { key: 'montserrat', label: 'Montserrat', family: 'Montserrat', serif: false },
  { key: 'oswald', label: 'Oswald (condensed, industrial)', family: 'Oswald', serif: false },
  { key: 'source-serif-4', label: 'Source Serif (formal)', family: 'Source Serif 4', serif: true },
];

export const SECTION_DEFAULT_LABELS: Record<SectionKey, string> = {
  docInfo: 'Document Information',
  toc: 'Contents',
  purpose: 'Purpose',
  scope: 'Scope',
  responsibilities: 'Roles & Responsibilities',
  safety: 'Safety & PPE',
  tools: 'Equipment, Tools & Systems',
  procedure: 'Procedure',
  notes: 'Notes & References',
  attachments: 'Reference Media',
  revisions: 'Revision History',
  approvals: 'Approvals',
};

export const SECTION_DESCRIPTIONS: Record<SectionKey, string> = {
  docInfo: 'Table with document number, version, owner, dates',
  toc: 'Contents list with page numbers',
  purpose: 'Why this SOP exists',
  scope: 'Where and to whom it applies',
  responsibilities: 'Who does what',
  safety: 'Required PPE and hazards',
  tools: 'Equipment, tools and computer systems needed',
  procedure: 'The numbered steps',
  notes: 'Extra notes and references',
  attachments: 'Full walkthrough videos and extra images',
  revisions: 'Version history table',
  approvals: 'Sign-off block for printed copies',
};

export const ALL_SECTIONS: SectionKey[] = [
  'docInfo',
  'toc',
  'purpose',
  'scope',
  'responsibilities',
  'safety',
  'tools',
  'procedure',
  'notes',
  'attachments',
  'revisions',
  'approvals',
];

export function defaultSections(enabled: Partial<Record<SectionKey, boolean>> = {}): SectionConfig[] {
  return ALL_SECTIONS.map((key) => ({
    key,
    label: SECTION_DEFAULT_LABELS[key],
    enabled: enabled[key] ?? key !== 'toc',
  }));
}

export const CALLOUT_META: Record<Exclude<CalloutType, 'none'>, { label: string; color: string; bg: string }> = {
  danger: { label: 'DANGER', color: '#b91c1c', bg: '#fef2f2' },
  warning: { label: 'WARNING', color: '#c2410c', bg: '#fff7ed' },
  caution: { label: 'CAUTION', color: '#a16207', bg: '#fefce8' },
  note: { label: 'NOTE', color: '#1d4ed8', bg: '#eff6ff' },
  tip: { label: 'TIP', color: '#15803d', bg: '#f0fdf4' },
};

export const PPE_SUGGESTIONS = [
  'High-visibility vest',
  'Steel-toe safety boots',
  'Cut-resistant gloves',
  'Safety glasses',
  'Hearing protection',
  'Hard hat',
  'Back support belt',
  'Forklift seatbelt fastened',
];

export const TEMPLATE_TOKENS: { token: string; description: string }[] = [
  { token: '{company}', description: 'Company name' },
  { token: '{title}', description: 'SOP title' },
  { token: '{number}', description: 'SOP number' },
  { token: '{version}', description: 'Version' },
  { token: '{status}', description: 'Status' },
  { token: '{category}', description: 'Category' },
  { token: '{effectiveDate}', description: 'Effective date' },
  { token: '{printedDate}', description: 'Date exported' },
];

export function defaultDesign(): TemplateDesign {
  return {
    page: { size: 'Letter', orientation: 'portrait', margins: 'normal' },
    typography: { bodyFont: 'inter', headingFont: 'inter', baseSize: 10.5, lineHeight: 1.5 },
    colors: {
      primary: '#1e3a8a',
      accent: '#f59e0b',
      text: '#1f2937',
      muted: '#6b7280',
      stepBadge: '#1e3a8a',
      stepBadgeText: '#ffffff',
    },
    style: {
      headingStyle: 'underline',
      stepStyle: 'badge',
      calloutStyle: 'filled',
      cornerRadius: 6,
      uppercaseHeadings: false,
    },
    steps: {
      layout: 'side-by-side',
      imagePosition: 'right',
      imageSize: 'medium',
      imageBorder: true,
      keepTogether: true,
      showDividers: true,
    },
    cover: {
      enabled: true,
      style: 'band',
      subtitle: 'Standard Operating Procedure',
      showQr: true,
    },
    header: {
      enabled: true,
      showLogo: true,
      left: '{title}',
      right: '{number} · Rev {version}',
    },
    footer: {
      enabled: true,
      left: 'Uncontrolled when printed. Verify the current version before use.',
      center: '{company}',
      showPageNumbers: true,
    },
    sections: defaultSections(),
    watermark: { enabled: true, text: 'DRAFT' },
    word: { font: 'Calibri' },
  };
}

/** Starter templates created on first boot. */
export function starterTemplates(): { name: string; description: string; design: TemplateDesign; isDefault: boolean }[] {
  const standard = defaultDesign();

  const systems = defaultDesign();
  systems.colors.primary = '#0f766e';
  systems.colors.accent = '#0ea5e9';
  systems.colors.stepBadge = '#0ea5e9';
  systems.steps.layout = 'stacked';
  systems.steps.imageSize = 'large';
  systems.style.stepStyle = 'card';
  systems.style.headingStyle = 'leftbar';
  systems.cover.style = 'centered';
  systems.sections = defaultSections({ toc: true, safety: false });

  const floor = defaultDesign();
  floor.colors.primary = '#111827';
  floor.colors.accent = '#facc15';
  floor.colors.stepBadge = '#facc15';
  floor.colors.stepBadgeText = '#111827';
  floor.typography.headingFont = 'oswald';
  floor.typography.baseSize = 11.5;
  floor.style.headingStyle = 'band';
  floor.style.uppercaseHeadings = true;
  floor.style.cornerRadius = 2;
  floor.steps.imageSize = 'large';
  floor.cover.style = 'full';
  floor.sections = defaultSections({ toc: false, responsibilities: false });

  return [
    {
      name: 'Standard SOP',
      description: 'Balanced layout for any warehouse process. Screenshots beside each step.',
      design: standard,
      isDefault: true,
    },
    {
      name: 'Computer Systems SOP',
      description: 'Large full-width screenshots for WMS/ERP and other system procedures.',
      design: systems,
      isDefault: false,
    },
    {
      name: 'Floor & Trailer Quick Guide',
      description: 'High-contrast, big photos and bold headings for dock, trailer and equipment work.',
      design: floor,
      isDefault: false,
    },
  ];
}

export const STARTER_CATEGORIES: { name: string; code: string; color: string; description: string; template: number }[] = [
  { name: 'Computer Systems', code: 'SYS', color: '#0f766e', description: 'WMS, ERP, label printing and other software procedures', template: 1 },
  { name: 'Trailer & Dock', code: 'TRL', color: '#b45309', description: 'Trailer check-in, dock locks, loading and unloading', template: 2 },
  { name: 'Receiving', code: 'RCV', color: '#2563eb', description: 'Inbound receipt, inspection and put-away', template: 0 },
  { name: 'Shipping', code: 'SHP', color: '#7c3aed', description: 'Picking, packing, staging and outbound', template: 0 },
  { name: 'Inventory Control', code: 'INV', color: '#0891b2', description: 'Cycle counts, adjustments and audits', template: 0 },
  { name: 'Equipment', code: 'EQP', color: '#4b5563', description: 'Forklifts, pallet jacks, scanners and other equipment', template: 2 },
  { name: 'Safety', code: 'SAF', color: '#dc2626', description: 'Safety programs, emergency and incident procedures', template: 2 },
];

export function defaultSettings(): AppSettings {
  return {
    branding: {
      companyName: 'Your Company',
      siteName: 'SOP Machine',
      logoMediaId: null,
      appColor: '#1e3a8a',
    },
    numbering: { prefix: 'WH', digits: 3 },
    export: {
      defaultFormat: 'pdf',
      filenamePattern: '{number} - {title} (Rev {version})',
      videoHandling: 'qr',
      imageQuality: 'standard',
      allowViewerExport: true,
    },
    workflow: { requireApproval: true, reviewIntervalMonths: 12 },
    training: { enabled: true },
    languages: { enabled: ['es'], autoTranslate: false, glossary: '' },
    notifications: {
      enabled: true,
      reviewReminderDays: 30,
      onSubmitted: true,
      onApproved: true,
      onNewRevision: true,
      extraRecipients: '',
    },
    ai: {
      model: 'claude-opus-5-5',
      effort: 'high',
      maxFrames: 40,
      autoHighlight: true,
      writingStyle:
        'Plain, direct language for frontline warehouse associates. Imperative voice ("Scan the pallet label"). One action per step. Put exact on-screen button, field and menu names in bold.',
      extraInstructions: '',
      useNarration: true,
    },
  };
}

export function defaultChecklist(): ChecklistConfig {
  return { enabled: false, style: 'passfail', fields: [], requireSignature: true, requireNoteOnFail: true };
}

export function emptyContent(): SopContent {
  return {
    checklist: defaultChecklist(),
    purpose: '',
    scope: '',
    responsibilities: '',
    safety: [],
    tools: [],
    steps: [],
    notes: '',
    attachments: [],
  };
}

/** Merge a possibly-partial object onto defaults so older saved data keeps working after upgrades. */
export function deepMerge<T>(base: T, patch: unknown): T {
  if (patch === undefined) return base;
  // Nullable fields (e.g. logoMediaId) default to null: accept null or a primitive value.
  if (base === null) return (patch === null || typeof patch !== 'object' ? patch : base) as T;
  if (patch === null) return base;
  if (Array.isArray(base)) return (Array.isArray(patch) ? patch : base) as T;
  if (typeof base === 'object' && base !== null) {
    if (typeof patch !== 'object' || Array.isArray(patch)) return base;
    const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
    for (const [k, v] of Object.entries(patch as Record<string, unknown>)) {
      if (k in out) out[k] = deepMerge(out[k], v);
    }
    return out as T;
  }
  return (typeof patch === typeof base ? patch : base) as T;
}

/** Ensure every section key exists exactly once (new sections added in upgrades get appended). */
export function normalizeSections(sections: SectionConfig[]): SectionConfig[] {
  const seen = new Set<SectionKey>();
  const out: SectionConfig[] = [];
  for (const s of sections) {
    if (ALL_SECTIONS.includes(s.key) && !seen.has(s.key)) {
      seen.add(s.key);
      out.push({ key: s.key, label: s.label || SECTION_DEFAULT_LABELS[s.key], enabled: !!s.enabled });
    }
  }
  for (const key of ALL_SECTIONS) {
    if (!seen.has(key)) out.push({ key, label: SECTION_DEFAULT_LABELS[key], enabled: false });
  }
  return out;
}

export function normalizeDesign(design: unknown): TemplateDesign {
  const merged = deepMerge(defaultDesign(), design);
  merged.sections = normalizeSections(merged.sections);
  merged.typography.baseSize = clamp(merged.typography.baseSize, 8, 14);
  merged.typography.lineHeight = clamp(merged.typography.lineHeight, 1.1, 2);
  merged.style.cornerRadius = clamp(merged.style.cornerRadius, 0, 16);
  return merged;
}

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Number.isFinite(n) ? n : min));
}

export function fillTokens(text: string, values: Record<string, string>): string {
  return text.replace(/\{(\w+)\}/g, (m, key: string) => (key in values ? values[key] : m));
}

export const STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  review: 'In Review',
  approved: 'Approved',
  archived: 'Archived',
};

export const LANGUAGES: LanguageOption[] = [
  { code: 'es', name: 'Spanish', native: 'Español' },
  { code: 'fr', name: 'French', native: 'Français' },
  { code: 'pt', name: 'Portuguese', native: 'Português' },
  { code: 'ht', name: 'Haitian Creole', native: 'Kreyòl ayisyen' },
  { code: 'vi', name: 'Vietnamese', native: 'Tiếng Việt' },
  { code: 'zh', name: 'Chinese (Simplified)', native: '简体中文' },
  { code: 'tl', name: 'Tagalog', native: 'Tagalog' },
  { code: 'ko', name: 'Korean', native: '한국어' },
  { code: 'ar', name: 'Arabic', native: 'العربية', rtl: true },
  { code: 'so', name: 'Somali', native: 'Soomaali' },
  { code: 'ne', name: 'Nepali', native: 'नेपाली' },
  { code: 'my', name: 'Burmese', native: 'မြန်မာ' },
  { code: 'sw', name: 'Swahili', native: 'Kiswahili' },
  { code: 'ru', name: 'Russian', native: 'Русский' },
  { code: 'uk', name: 'Ukrainian', native: 'Українська' },
  { code: 'pl', name: 'Polish', native: 'Polski' },
  { code: 'hi', name: 'Hindi', native: 'हिन्दी' },
  { code: 'de', name: 'German', native: 'Deutsch' },
];

export const languageInfo = (code: string): LanguageOption => LANGUAGES.find((l) => l.code === code) ?? { code, name: code.toUpperCase(), native: code.toUpperCase() };

/**
 * Fixed wording printed on every SOP. Translated together with the SOP content so a
 * Spanish export is Spanish throughout (labels, tables, callouts, footer).
 */
export const DOC_STRINGS = {
  docNo: 'Document No.',
  version: 'Version',
  status: 'Status',
  category: 'Category',
  effectiveDate: 'Effective date',
  nextReview: 'Next review',
  owner: 'Owner',
  approver: 'Approver',
  onApproval: 'On approval',
  statusDraft: 'Draft',
  statusReview: 'In Review',
  statusApproved: 'Approved',
  statusArchived: 'Archived',
  step: 'Step',
  video: 'Video',
  scanVideo: 'Scan to watch the video',
  length: 'Length',
  openDigital: 'Open the digital SOP to watch.',
  scanLatest: 'Scan for the latest version',
  revDate: 'Date',
  revChange: 'Description of change',
  revApprovedBy: 'Approved by',
  initialRelease: 'Initial release (pending approval)',
  role: 'Role',
  name: 'Name',
  signature: 'Signature',
  date: 'Date',
  preparedBy: 'Prepared by',
  reviewedBy: 'Reviewed by',
  approvedBy: 'Approved by',
  danger: 'DANGER',
  warning: 'WARNING',
  caution: 'CAUTION',
  note: 'NOTE',
  tip: 'TIP',
  noSteps: 'No steps yet.',
} as const;

export type DocStringKey = keyof typeof DOC_STRINGS;
