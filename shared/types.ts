// Types shared by the server and the web client.

export type Role = 'admin' | 'editor' | 'viewer';

export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
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

export interface SopContent {
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
}

/** Fields an editor can change through PUT /api/sops/:id */
export interface SopUpdate {
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
  ai: {
    model: string;
    effort: 'low' | 'medium' | 'high' | 'xhigh';
    maxFrames: number;
    autoHighlight: boolean;
    writingStyle: string;
    extraInstructions: string;
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

export interface GenerationJob {
  id: string;
  type: 'recording' | 'notes' | 'import';
  status: JobStatus;
  progress: number;
  message: string;
  title: string;
  resultSopId: string | null;
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
}
