// Types shared by the server and the web client.

export type Role = 'admin' | 'editor' | 'viewer';

export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
  language: string;
  teamId: string | null;
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

export interface QuizQuestion {
  id: string;
  question: string;
  options: string[];
  /** Index into options. Hidden from viewers (sent as -1). */
  correctIndex: number;
  /** Shown when someone picks a wrong answer. */
  explanation: string;
}

/** A few questions people must answer correctly before they can sign off. */
export interface QuizConfig {
  enabled: boolean;
  questions: QuizQuestion[];
}

/** A quiz question as shown to the person answering (no answer key). */
export interface QuizQuestionPublic {
  id: string;
  question: string;
  options: string[];
}

export interface QuizResult {
  passed: boolean;
  wrong: string[];
  explanations: Record<string, string>;
}

export interface SopContent {
  checklist: ChecklistConfig;
  quiz: QuizConfig;
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
  /** Set on a marked-up image: the shapes, so the markup can be edited again on top of `baseId`. */
  markup: Markup | null;
}

export type MarkupTool = 'rect' | 'ellipse' | 'arrow' | 'line' | 'pen' | 'highlight' | 'marker' | 'text' | 'note' | 'redact';

/**
 * One shape on an image. Coordinates are fractions (0–1) of the image's width and height.
 * rect/ellipse/highlight/redact: corners (x1,y1)-(x2,y2). arrow/line: tail (x1,y1) to tip (x2,y2).
 * pen: `points`. marker: centre (x1,y1), number `n`, optional key text. text: top-left (x1,y1).
 * note: box top-left (x1,y1); when `pointer`, a line runs from the box to (x2,y2).
 */
export interface MarkupShape {
  id: string;
  tool: MarkupTool;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: string;
  size: 's' | 'm' | 'l';
  text?: string;
  n?: number;
  points?: [number, number][];
  pointer?: boolean;
}

export interface Markup {
  v: 1;
  /** The image the shapes are drawn on (the clean original). */
  baseId: string;
  shapes: MarkupShape[];
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
  /** Site time zone and shifts, used by scheduled checklists. */
  schedule: {
    /** IANA name, e.g. America/Chicago. Empty until an admin sets it (UTC is used meanwhile). */
    timezone: string;
    shifts: ShiftDef[];
  };
  actions: {
    /** Open a corrective action for every failed checklist item. */
    autoCreate: boolean;
    defaultDueDays: number;
  };
  notifications: {
    enabled: boolean;
    reviewReminderDays: number;
    onSubmitted: boolean;
    onApproved: boolean;
    onNewRevision: boolean;
    onChecklistFailed: boolean;
    onActionAssigned: boolean;
    onMissedChecklist: boolean;
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

export interface ShiftDef {
  id: string;
  name: string;
  /** Local time HH:MM. An end at or before the start means the shift runs past midnight. */
  start: string;
  end: string;
}

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
  quiz: { question: string; options: string[]; explanation: string }[];
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
  teamId: string | null;
  /** Set for people on the roster (no account). */
  rosterId: string | null;
}

/** A group of people and the SOPs they must sign. No categories and no SOPs means every SOP. */
export interface Team {
  id: string;
  name: string;
  categoryIds: string[];
  sopIds: string[];
  memberCount: number;
}

/** An associate without an account, so sign-off rates have a real denominator. */
export interface RosterPerson {
  id: string;
  name: string;
  employeeId: string;
  teamId: string | null;
  active: boolean;
}

export interface TrainingMatrix {
  teams: Team[];
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
  /** Gets failed-checklist and missed-checklist emails and is the default owner of actions here. */
  supervisorUserId: string | null;
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
  /** Sign-off needs a short quiz. */
  quiz: boolean;
  /** Scheduled checklist state for the current period at this station. */
  due: 'due' | 'done' | null;
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

// ---------------------------------------------------------------------------
// Corrective actions
// ---------------------------------------------------------------------------

export type ActionStatus = 'open' | 'in_progress' | 'done' | 'cancelled';

export interface CorrectiveAction {
  id: string;
  title: string;
  detail: string;
  status: ActionStatus;
  priority: 'normal' | 'high';
  sopId: string | null;
  sopNumber: string | null;
  sopTitle: string | null;
  stationId: string | null;
  stationName: string | null;
  runId: string | null;
  stepId: string | null;
  reportedBy: string;
  mediaIds: string[];
  assigneeId: string | null;
  assigneeName: string | null;
  dueDate: string | null;
  overdue: boolean;
  resolution: string;
  resolvedByName: string | null;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ActionCounts {
  open: number;
  overdue: number;
  mine: number;
}

// ---------------------------------------------------------------------------
// Scheduled checklists
// ---------------------------------------------------------------------------

export type ScheduleFrequency = 'shift' | 'daily' | 'weekly' | 'monthly';

export interface Schedule {
  id: string;
  sopId: string;
  sopNumber: string;
  sopTitle: string;
  /** One checklist is expected per station per period. Empty means once per period, anywhere. */
  stationIds: string[];
  frequency: ScheduleFrequency;
  /** Days of the week it applies (0 = Sunday). Used by shift and daily schedules. */
  days: number[];
  /** Shifts it applies to. Empty means every shift. */
  shiftIds: string[];
  active: boolean;
  createdAt: string;
}

export type OccurrenceStatus = 'done' | 'failed' | 'missed' | 'due' | 'upcoming';

export interface Occurrence {
  scheduleId: string;
  sopId: string;
  sopNumber: string;
  sopTitle: string;
  stationId: string | null;
  stationName: string | null;
  start: string;
  end: string;
  /** e.g. "Mon Nov 17 · 1st shift" */
  label: string;
  /** Local calendar day the period belongs to (YYYY-MM-DD). */
  day: string;
  status: OccurrenceStatus;
  runId: string | null;
  performer: string | null;
  completedAt: string | null;
}

export interface ScheduleBoard {
  timezone: string;
  timezoneSet: boolean;
  now: Occurrence[];
  history: Occurrence[];
  stats: { done: number; missed: number; failed: number; compliancePct: number | null; dueNow: number };
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

export interface DashboardData {
  days: number;
  library: { total: number; approved: number; drafts: number; inReview: number; reviewDue: number; reviewOverdue: number };
  training: {
    current: number;
    required: number;
    pct: number | null;
    needResign: number;
    teams: { id: string | null; name: string; members: number; current: number; required: number; pct: number | null }[];
  };
  quiz: { sopId: string; number: string; title: string; people: number; firstTryPct: number }[];
  checklists: {
    completed: number;
    withFailures: number;
    perDay: { date: string; passed: number; failed: number }[];
    topFailed: { sopId: string; number: string; sopTitle: string; stepTitle: string; fails: number; checks: number; rate: number }[];
  };
  schedules: { compliancePct: number | null; done: number; missed: number; dueNow: number; active: number };
  actions: { open: number; overdue: number; closed: number; avgDaysToClose: number | null };
  views: {
    trackedSince: string | null;
    floorViews: number;
    unopened: { sopId: string; number: string; title: string; approvedAt: string | null; lastFloorView: string | null }[];
    mostViewed: { sopId: string; number: string; title: string; floorViews: number; totalViews: number }[];
  };
}
