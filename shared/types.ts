// Types shared by the server and the web client.

export type Role = 'admin' | 'editor' | 'viewer';

export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
  language: string;
  disabled: boolean;
  createdAt: string;
  lastLoginAt: string | null;
}

// ---------------------------------------------------------------------------
// SOP documents
// ---------------------------------------------------------------------------

export type SopStatus = 'draft' | 'review' | 'approved' | 'archived';
export type CalloutType = 'none' | 'danger' | 'warning' | 'caution' | 'note' | 'tip';
export type SopSource = 'manual' | 'ai-recording' | 'ai-notes' | 'ai-import';

export interface StepMedia {
  mediaId: string;
  caption: string;
}

export interface Step {
  id: string;
  /** "section" rows are phase headings (e.g. "Pre-unload checks") and are not numbered. */
  kind: 'step' | 'section';
  title: string;
  /** Markdown subset: paragraphs, **bold**, *italic*, bullet and numbered lists. */
  body: string;
  callout: { type: CalloutType; text: string };
  media: StepMedia[];
}

export interface ChecklistField {
  id: string;
  label: string;
  required: boolean;
}

/** Lets an SOP be run as a fill-in checklist (e.g. a trailer pre-load inspection). */
export interface ChecklistConfig {
  enabled: boolean;
  style: 'check' | 'passfail';
  /** Record fields filled in at the start, e.g. Trailer #, Door, Seal #. */
  fields: ChecklistField[];
  requireSignature: boolean;
  requireNoteOnFail: boolean;
}

export interface SopContent {
  checklist: ChecklistConfig;
  purpose: string;
  scope: string;
  responsibilities: string;
  safety: string[];
  tools: string[];
  steps: Step[];
  notes: string;
  /** Reference media shown at the end (e.g. the full walkthrough video). */
  attachments: StepMedia[];
}

export interface SopSummary {
  id: string;
  number: string;
  title: string;
  categoryId: string | null;
  templateId: string | null;
  status: SopStatus;
  version: string;
  owner: string;
  source: SopSource;
  tags: string[];
  coverMediaId: string | null;
  stepCount: number;
  /** Can be run as a fill-in checklist. */
  checklist: boolean;
  publishedVersion: string | null;
  reviewDate: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Sop extends SopSummary {
  approver: string;
  effectiveDate: string | null;
  content: SopContent;
  createdBy: string | null;
  updatedBy: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  publishedRevisionId: string | null;
  ownerUserId: string | null;
}

/** Fields an editor can change through PUT /api/sops/:id */
export interface SopUpdate {
  ownerUserId?: string | null;
  number?: string;
  title?: string;
  categoryId?: string | null;
  templateId?: string | null;
  owner?: string;
  approver?: string;
  effectiveDate?: string | null;
  reviewDate?: string | null;
  tags?: string[];
  content?: SopContent;
}

export interface Revision {
  id: string;
  sopId: string;
  version: string;
  summary: string;
  createdByName: string | null;
  createdAt: string;
}

export interface Category {
  id: string;
  name: string;
  code: string;
  color: string;
  description: string;
  templateId: string | null;
  sortOrder: number;
}

export interface MediaItem {
  id: string;
  kind: 'image' | 'video';
  mime: string;
  originalName: string;
  size: number;
  width: number | null;
  height: number | null;
  duration: number | null;
  parentId: string | null;
  processing: boolean;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Templates (designed in the Template Designer)
// ---------------------------------------------------------------------------

export type FontKey =
  | 'inter'
  | 'roboto'
  | 'open-sans'
  | 'lato'
  | 'montserrat'
  | 'oswald'
  | 'source-serif-4';

export type SectionKey =
  | 'docInfo'
  | 'toc'
  | 'purpose'
  | 'scope'
  | 'responsibilities'
  | 'safety'
  | 'tools'
  | 'procedure'
  | 'notes'
  | 'attachments'
  | 'revisions'
  | 'approvals';

export interface SectionConfig {
  key: SectionKey;
  label: string;
  enabled: boolean;
}

export interface TemplateDesign {
  page: {
    size: 'Letter' | 'A4' | 'Legal';
    orientation: 'portrait' | 'landscape';
    margins: 'narrow' | 'normal' | 'wide';
  };
  typography: {
    bodyFont: FontKey;
    headingFont: FontKey;
    /** Body size in points. */
    baseSize: number;
    lineHeight: number;
  };
  colors: {
    primary: string;
    accent: string;
    text: string;
    muted: string;
    stepBadge: string;
    stepBadgeText: string;
  };
  style: {
    headingStyle: 'underline' | 'band' | 'leftbar' | 'plain';
    stepStyle: 'badge' | 'label' | 'card';
    calloutStyle: 'filled' | 'outlined';
    cornerRadius: number;
    uppercaseHeadings: boolean;
  };
  steps: {
    layout: 'side-by-side' | 'stacked';
    imagePosition: 'right' | 'left';
    imageSize: 'small' | 'medium' | 'large';
    imageBorder: boolean;
    keepTogether: boolean;
    showDividers: boolean;
  };
  cover: {
    enabled: boolean;
    style: 'band' | 'centered' | 'full';
    subtitle: string;
    showQr: boolean;
  };
  header: {
    enabled: boolean;
    showLogo: boolean;
    left: string;
    right: string;
  };
  footer: {
    enabled: boolean;
    left: string;
    center: string;
    showPageNumbers: boolean;
  };
  sections: SectionConfig[];
  watermark: {
    enabled: boolean;
    text: string;
  };
  word: {
    font: string;
  };
}

export interface Template {
  id: string;
  name: string;
  description: string;
  design: TemplateDesign;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Global settings (Admin panel)
// ---------------------------------------------------------------------------

export interface AppSettings {
  branding: {
    companyName: string;
    siteName: string;
    logoMediaId: string | null;
    appColor: string;
  };
  numbering: {
    prefix: string;
    digits: number;
  };
  export: {
    defaultFormat: 'pdf' | 'docx';
    filenamePattern: string;
    videoHandling: 'qr' | 'thumbnail' | 'omit';
    imageQuality: 'standard' | 'high';
    allowViewerExport: boolean;
  };
  workflow: {
    requireApproval: boolean;
    reviewIntervalMonths: number;
  };
  training: {
    /** Ask everyone to sign off ("read and understood") on approved SOPs. */
    enabled: boolean;
  };
  languages: {
    /** Translation targets, e.g. ["es"]. */
    enabled: string[];
    /** Re-translate automatically when an SOP is approved. */
    autoTranslate: boolean;
    /** Terms to keep as-is or translate a certain way. */
    glossary: string;
  };
  notifications: {
    enabled: boolean;
    reviewReminderDays: number;
    onSubmitted: boolean;
    onApproved: boolean;
    onNewRevision: boolean;
    /** Extra addresses (comma separated) copied on review and approval emails. */
    extraRecipients: string;
  };
  ai: {
    model: string;
    effort: 'low' | 'medium' | 'high' | 'xhigh';
    maxFrames: number;
    autoHighlight: boolean;
    writingStyle: string;
    extraInstructions: string;
    /** Transcribe narration in recordings when a speech-to-text service is configured. */
    useNarration: boolean;
  };
}

/** Subset of settings any visitor can read (login page). */
export interface PublicBranding {
  companyName: string;
  siteName: string;
  hasLogo: boolean;
  logoVersion: string | null;
  appColor: string;
}

// ---------------------------------------------------------------------------
// AI generation jobs
// ---------------------------------------------------------------------------

export type JobStatus = 'queued' | 'running' | 'done' | 'error';

export type JobType = 'recording' | 'notes' | 'import' | 'translate' | 'binder' | 'storage';

export interface GenerationJob {
  id: string;
  type: JobType;
  status: JobStatus;
  progress: number;
  message: string;
  title: string;
  resultSopId: string | null;
  /** Set when the job produced a file to download (binders). */
  downloadUrl: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SystemInfo {
  aiConfigured: boolean;
  aiModel: string;
  appUrl: string;
  dataDir: string;
  disk: { uploadsBytes: number; databaseBytes: number; freeBytes: number | null; totalBytes: number | null };
  counts: { sops: number; media: number; users: number; templates: number };
  versions: { app: string; node: string };
  pdfEngine: { ok: boolean; detail: string };
  storage: { driver: 'local' | 's3'; bucket: string | null; localFiles: number; objectFiles: number };
  email: { configured: boolean; from: string | null };
  transcription: { configured: boolean; model: string | null };
}

// ---------------------------------------------------------------------------
// Translations
// ---------------------------------------------------------------------------

export interface LanguageOption {
  code: string;
  name: string;
  native: string;
  rtl?: boolean;
}

export interface TranslatedContent {
  title: string;
  purpose: string;
  scope: string;
  responsibilities: string;
  notes: string;
  safety: string[];
  tools: string[];
  steps: { id: string; title: string; body: string; callout: string; captions: string[] }[];
  attachments: string[];
  checklistFields: string[];
}

export interface SopTranslation {
  id: string;
  sopId: string;
  language: string;
  content: TranslatedContent;
  /** Fixed document wording (labels, section names, footer) in this language. */
  strings: Record<string, string>;
  sourceVersion: string;
  status: 'machine' | 'reviewed';
  /** True when the SOP text changed after this translation was made. */
  outdated: boolean;
  updatedAt: string;
  updatedByName: string | null;
}

export type LanguageMode = 'en' | 'tr' | 'bi';

// ---------------------------------------------------------------------------
// Training sign-off
// ---------------------------------------------------------------------------

export interface Acknowledgment {
  id: string;
  sopId: string;
  version: string;
  personKey: string;
  personName: string;
  employeeId: string;
  userId: string | null;
  method: 'app' | 'station' | 'recorded';
  recordedByName: string | null;
  stationName: string | null;
  note: string;
  createdAt: string;
  /** Signed the version that is currently published. */
  current: boolean;
}

export interface TrainingPerson {
  key: string;
  name: string;
  employeeId: string;
  userId: string | null;
  role: Role | null;
}

export interface TrainingMatrix {
  people: TrainingPerson[];
  sops: { id: string; number: string; title: string; version: string; categoryId: string | null }[];
  /** cells[personKey][sopId] */
  cells: Record<string, Record<string, { version: string; current: boolean; at: string }>>;
}

// ---------------------------------------------------------------------------
// Stations & QR placards
// ---------------------------------------------------------------------------

export interface Station {
  id: string;
  name: string;
  area: string;
  token: string;
  sopIds: string[];
  publicAccess: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface StationSopSummary {
  id: string;
  number: string;
  title: string;
  version: string;
  effectiveDate: string | null;
  categoryName: string | null;
  categoryColor: string | null;
  checklist: boolean;
  languages: string[];
  /** SOP title per available language. */
  titles: Record<string, string>;
}

export interface PublicStationView {
  station: { id: string; name: string; area: string; publicAccess: boolean };
  branding: PublicBranding;
  sops: StationSopSummary[];
  trainingEnabled: boolean;
  languages: LanguageOption[];
  signedIn: boolean;
}

// ---------------------------------------------------------------------------
// Checklist runs
// ---------------------------------------------------------------------------

export type CheckResult = 'pass' | 'fail' | 'na' | 'done';

export interface CheckItemResult {
  result: CheckResult | null;
  note: string;
  mediaIds: string[];
  at: string | null;
}

export interface ChecklistRunSummary {
  id: string;
  token: string;
  sopId: string;
  sopNumber: string;
  sopTitle: string;
  version: string;
  stationName: string | null;
  performerName: string;
  employeeId: string;
  fields: Record<string, string>;
  /** Record fields with their (English) labels, for lists and exports. */
  fieldValues: { label: string; value: string }[];
  status: 'in_progress' | 'completed';
  failCount: number;
  startedAt: string;
  completedAt: string | null;
}

export interface ChecklistRunStep {
  id: string;
  kind: 'step' | 'section';
  number: number;
  title: string;
  bodyHtml: string;
  callout: { type: CalloutType; html: string; label: string };
  mediaIds: string[];
}

export interface ChecklistRun extends ChecklistRunSummary {
  language: string;
  results: Record<string, CheckItemResult>;
  signature: string;
  checklist: ChecklistConfig;
  fieldLabels: Record<string, string>;
  steps: ChecklistRunStep[];
  mediaBase: string;
}
