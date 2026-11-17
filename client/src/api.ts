import type {
  Markup,
  ActionCounts,
  CorrectiveAction,
  DashboardData,
  QuizQuestion,
  QuizQuestionPublic,
  QuizResult,
  RosterPerson,
  Schedule,
  ScheduleBoard,
  Team,
  Acknowledgment,
  AppSettings,
  Category,
  ChecklistRun,
  ChecklistRunSummary,
  CheckItemResult,
  GenerationJob,
  LanguageOption,
  MediaItem,
  PublicBranding,
  PublicStationView,
  Revision,
  Sop,
  SopTranslation,
  Station,
  TrainingMatrix,
  TranslatedContent,
  SopStatus,
  SopSummary,
  SopUpdate,
  SystemInfo,
  Template,
  TemplateDesign,
  User,
} from '@shared/types';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public loginRequired = false,
  ) {
    super(message);
  }
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    credentials: 'same-origin',
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw await toError(res);
  const type = res.headers.get('content-type') ?? '';
  return (type.includes('application/json') ? res.json() : res.text()) as Promise<T>;
}

async function toError(res: Response) {
  let message = `Request failed (${res.status})`;
  let loginRequired = false;
  try {
    const data = await res.json();
    if (data?.error) message = data.error;
    loginRequired = !!data?.loginRequired;
  } catch {
    /* not JSON */
  }
  // Public pages (QR stations, checklists) handle their own sign-in prompts.
  if (res.status === 401 && !res.url.includes('/api/public/')) window.dispatchEvent(new Event('sop:unauthorized'));
  return new ApiError(res.status, message, loginRequired);
}

const get = <T>(url: string) => request<T>('GET', url);
const post = <T>(url: string, body?: unknown) => request<T>('POST', url, body ?? {});
const put = <T>(url: string, body: unknown) => request<T>('PUT', url, body);
const del = <T>(url: string) => request<T>('DELETE', url);

/** multipart upload with progress (fetch has no upload progress). */
export function uploadForm<T>(url: string, form: FormData, onProgress?: (pct: number) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    xhr.withCredentials = true;
    xhr.responseType = 'json';
    if (onProgress) xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(Math.round((e.loaded / e.total) * 100));
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve(xhr.response as T);
      else reject(new ApiError(xhr.status, (xhr.response as { error?: string } | null)?.error ?? `Upload failed (${xhr.status})`));
    };
    xhr.onerror = () => reject(new ApiError(0, 'Network error during upload'));
    xhr.send(form);
  });
}

function qs(params: Record<string, string | undefined | null>) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : '';
}

/** Which language to show: English, a translation, or both. */
export interface LangChoice {
  code: string;
  bilingual: boolean;
}
export const EN: LangChoice = { code: 'en', bilingual: false };
const langQuery = (l: LangChoice) => (l.code && l.code !== 'en' ? `&lang=${encodeURIComponent(l.code)}${l.bilingual ? '&bi=1' : ''}` : '');

export const api = {
  auth: {
    me: () => get<User>('/api/auth/me'),
    login: (email: string, password: string) => post<User>('/api/auth/login', { email, password }),
    logout: () => post('/api/auth/logout'),
    updateMe: (body: { name?: string; language?: string; currentPassword?: string; newPassword?: string }) => put<User>('/api/auth/me', body),
  },
  branding: () => get<PublicBranding>('/api/public/branding'),
  sops: {
    list: (f: { search?: string; categoryId?: string; status?: string }) => get<SopSummary[]>(`/api/sops${qs(f)}`),
    get: (id: string) => get<Sop>(`/api/sops/${id}`),
    create: (body: { title: string; categoryId: string | null; templateId?: string | null }) => post<Sop>('/api/sops', body),
    update: (id: string, body: SopUpdate) => put<Sop>(`/api/sops/${id}`, body),
    remove: (id: string) => del(`/api/sops/${id}`),
    duplicate: (id: string) => post<Sop>(`/api/sops/${id}/duplicate`),
    setStatus: (id: string, body: { status: SopStatus; summary?: string; version?: string }) => post<Sop>(`/api/sops/${id}/status`, body),
    revisions: (id: string) => get<Revision[]>(`/api/sops/${id}/revisions`),
    renderUrl: (id: string, mode: 'web' | 'paged', version: string | number, lang: LangChoice = EN) =>
      `/api/sops/${id}/render?mode=${mode}&v=${encodeURIComponent(String(version))}${langQuery(lang)}`,
    exportUrl: (id: string, format: 'pdf' | 'docx', lang: LangChoice = EN) => `/api/sops/${id}/export?format=${format}${langQuery(lang)}`,
    languages: (id: string) => get<LanguageOption[]>(`/api/sops/${id}/languages`),
    translations: (id: string) => get<SopTranslation[]>(`/api/sops/${id}/translations`),
    translate: (id: string, language: string) => post<GenerationJob>(`/api/sops/${id}/translations`, { language }),
    translation: (id: string, lang: string) =>
      get<{ source: { content: TranslatedContent; strings: Record<string, string> }; translation: SopTranslation }>(`/api/sops/${id}/translations/${lang}`),
    saveTranslation: (id: string, lang: string, body: { content: TranslatedContent; strings?: Record<string, string>; reviewed: boolean }) =>
      put<SopTranslation>(`/api/sops/${id}/translations/${lang}`, body),
    removeTranslation: (id: string, lang: string) => del(`/api/sops/${id}/translations/${lang}`),
    acknowledgments: (id: string) => get<{ mine: Acknowledgment | null; all: Acknowledgment[] }>(`/api/sops/${id}/acknowledgments`),
    acknowledge: (id: string, answers: Record<string, number> = {}, language = 'en') =>
      post<{ created: boolean; version: string; quiz?: QuizResult }>(`/api/sops/${id}/acknowledge`, { answers, language }),
    quiz: (id: string, lang = 'en') => get<{ questions: QuizQuestionPublic[] }>(`/api/sops/${id}/quiz?lang=${encodeURIComponent(lang)}`),
    suggestQuiz: (id: string, count: number) => post<QuizQuestion[]>(`/api/sops/${id}/quiz/suggest`, { count }),
    recordTraining: (id: string, people: { name: string; employeeId: string }[], note: string) =>
      post<{ created: number }>(`/api/sops/${id}/acknowledgments`, { people, note }),
    stations: (id: string) => get<Station[]>(`/api/sops/${id}/stations`),
    startRun: (id: string, language: string) => post<ChecklistRun>(`/api/sops/${id}/runs`, { language }),
  },
  media: {
    upload: (files: File[], opts: { parentId?: string; markup?: Markup; onProgress?: (pct: number) => void } = {}) => {
      const form = new FormData();
      if (opts.parentId) form.append('parentId', opts.parentId);
      if (opts.markup) form.append('markup', JSON.stringify(opts.markup));
      for (const f of files) form.append('files', f, f.name);
      return uploadForm<MediaItem[]>('/api/media', form, opts.onProgress);
    },
    get: (id: string) => get<MediaItem>(`/api/media/${id}`),
  },
  templates: {
    list: () => get<Template[]>('/api/templates'),
    create: (body: { name: string; description?: string; design?: unknown; copyFrom?: string }) => post<Template>('/api/templates', body),
    update: (id: string, body: { name?: string; description?: string; design?: TemplateDesign; isDefault?: boolean }) =>
      put<Template>(`/api/templates/${id}`, body),
    remove: (id: string) => del(`/api/templates/${id}`),
    /** Returns a same-origin URL for the rendered preview (load it in an iframe). */
    preview: (body: { design: TemplateDesign; sopId?: string | null; mode?: 'paged' | 'web'; settings?: Partial<AppSettings> }) =>
      post<{ url: string }>('/api/templates/preview', body),
  },
  categories: {
    list: () => get<Category[]>('/api/categories'),
    create: (c: Omit<Category, 'id'>) => post<Category>('/api/categories', c),
    update: (id: string, c: Omit<Category, 'id'>) => put<Category>(`/api/categories/${id}`, c),
    remove: (id: string) => del(`/api/categories/${id}`),
  },
  users: {
    list: () => get<User[]>('/api/users'),
    create: (u: { email: string; name: string; role: string; password: string }) => post<User>('/api/users', u),
    update: (id: string, u: { name?: string; role?: string; disabled?: boolean; password?: string; teamId?: string | null }) => put<User>(`/api/users/${id}`, u),
    remove: (id: string) => del(`/api/users/${id}`),
  },
  settings: {
    get: () => get<AppSettings>('/api/settings'),
    update: (patch: Partial<AppSettings>) => put<AppSettings>('/api/settings', patch),
    uploadLogo: (file: File) => {
      const form = new FormData();
      form.append('file', file, file.name);
      return uploadForm<AppSettings>('/api/settings/logo', form);
    },
    removeLogo: () => del<AppSettings>('/api/settings/logo'),
  },
  directory: () => get<{ id: string; name: string; role: string; teamId: string | null }[]>('/api/directory'),
  actions: {
    list: (f: { status?: string; mine?: string; overdue?: string; sopId?: string; stationId?: string }) => get<CorrectiveAction[]>(`/api/actions${qs(f)}`),
    counts: () => get<ActionCounts>('/api/actions/counts'),
    get: (id: string) => get<CorrectiveAction>(`/api/actions/${id}`),
    create: (a: Partial<CorrectiveAction>) => post<CorrectiveAction>('/api/actions', a),
    update: (id: string, a: Partial<CorrectiveAction>) => put<CorrectiveAction>(`/api/actions/${id}`, a),
    remove: (id: string) => del(`/api/actions/${id}`),
  },
  schedules: {
    list: () => get<(Schedule & { description: string })[]>('/api/schedules'),
    board: (days = 7) => get<ScheduleBoard>(`/api/schedules/board?days=${days}`),
    create: (s: Omit<Schedule, 'id' | 'sopNumber' | 'sopTitle' | 'createdAt'>) => post<Schedule>('/api/schedules', s),
    update: (id: string, s: Omit<Schedule, 'id' | 'sopNumber' | 'sopTitle' | 'createdAt'>) => put<Schedule>(`/api/schedules/${id}`, s),
    remove: (id: string) => del(`/api/schedules/${id}`),
  },
  teams: {
    list: () => get<Team[]>('/api/teams'),
    create: (t: { name: string; categoryIds: string[]; sopIds: string[] }) => post<Team>('/api/teams', t),
    update: (id: string, t: { name: string; categoryIds: string[]; sopIds: string[] }) => put<Team>(`/api/teams/${id}`, t),
    remove: (id: string) => del(`/api/teams/${id}`),
  },
  roster: {
    list: () => get<RosterPerson[]>('/api/roster'),
    create: (p: Omit<RosterPerson, 'id'>) => post<RosterPerson>('/api/roster', p),
    update: (id: string, p: Omit<RosterPerson, 'id'>) => put<RosterPerson>(`/api/roster/${id}`, p),
    remove: (id: string) => del(`/api/roster/${id}`),
    importText: (text: string, teamId: string | null) => post<{ added: number; updated: number }>('/api/roster/import', { text, teamId }),
  },
  dashboard: (days: number) => get<DashboardData>(`/api/dashboard?days=${days}`),
  system: () => get<SystemInfo>('/api/system'),
  migrateStorage: () => post<GenerationJob>('/api/system/storage/migrate'),
  testEmail: (to: string) => post('/api/settings/test-email', { to }),
  notifications: () => get<{ id: string; kind: string; recipients: string; subject: string; status: string; error: string | null; createdAt: string }[]>('/api/settings/notifications'),
  stations: {
    list: () => get<Station[]>('/api/stations'),
    create: (s: { name: string; area: string; sopIds: string[]; publicAccess: boolean; supervisorUserId: string | null }) => post<Station>('/api/stations', s),
    update: (id: string, s: { name: string; area: string; sopIds: string[]; publicAccess: boolean; supervisorUserId: string | null }) => put<Station>(`/api/stations/${id}`, s),
    rotate: (id: string) => post<Station>(`/api/stations/${id}/rotate`),
    remove: (id: string) => del(`/api/stations/${id}`),
  },
  training: {
    matrix: (categoryId?: string) => get<TrainingMatrix>(`/api/training/matrix${qs({ categoryId })}`),
    removeAck: (id: string) => del(`/api/acknowledgments/${id}`),
  },
  runs: {
    list: (f: { sopId?: string; status?: string; failed?: string }) => get<ChecklistRunSummary[]>(`/api/runs${qs(f)}`),
    get: (id: string) => get<ChecklistRun>(`/api/runs/${id}`),
    remove: (id: string) => del(`/api/runs/${id}`),
  },
  binders: {
    create: (b: { title?: string; categoryId: string | null; includeDrafts: boolean; language: string; bilingual: boolean }) => post<GenerationJob>('/api/binders', b),
  },
  /** QR station pages and checklist runs (no login needed when the station is open). */
  pub: {
    station: (token: string) => get<PublicStationView>(`/api/public/stations/${token}`),
    stationRenderUrl: (token: string, sopId: string, lang: LangChoice) => `/api/public/stations/${token}/sops/${sopId}/render?x=1${langQuery(lang)}`,
    acknowledge: (token: string, sopId: string, body: { name: string; employeeId: string; answers?: Record<string, number>; language?: string }) =>
      post<{ created: boolean; version: string; quiz?: QuizResult }>(`/api/public/stations/${token}/sops/${sopId}/acknowledge`, body),
    quiz: (token: string, sopId: string, lang: string) => get<{ questions: QuizQuestionPublic[] }>(`/api/public/stations/${token}/sops/${sopId}/quiz?lang=${encodeURIComponent(lang)}`),
    startRun: (token: string, sopId: string, body: { name: string; employeeId: string; language: string }) =>
      post<ChecklistRun>(`/api/public/stations/${token}/sops/${sopId}/runs`, body),
    run: (token: string) => get<ChecklistRun>(`/api/public/runs/${token}`),
    updateRun: (token: string, body: { fields?: Record<string, string>; results?: Record<string, Partial<CheckItemResult>> }) =>
      put<ChecklistRun>(`/api/public/runs/${token}`, body),
    completeRun: (token: string, signature: string) => post<ChecklistRun>(`/api/public/runs/${token}/complete`, { signature }),
    uploadPhoto: (token: string, file: File) => {
      const form = new FormData();
      form.append('photo', file, file.name || 'photo.jpg');
      return uploadForm<MediaItem>(`/api/public/runs/${token}/photos`, form);
    },
  },
  generate: {
    status: () => get<{ configured: boolean }>('/api/generate/status'),
    recording: (form: FormData, onProgress?: (pct: number) => void) => uploadForm<GenerationJob>('/api/generate/recording', form, onProgress),
    notes: (form: FormData, onProgress?: (pct: number) => void) => uploadForm<GenerationJob>('/api/generate/notes', form, onProgress),
    import: (form: FormData, onProgress?: (pct: number) => void) => uploadForm<GenerationJob[]>('/api/generate/import', form, onProgress),
  },
  jobs: {
    list: (types?: string) => get<GenerationJob[]>(`/api/jobs${qs({ types })}`),
    get: (id: string) => get<GenerationJob>(`/api/jobs/${id}`),
  },
};

/** Download a generated file (keeps the session cookie, shows progress state in the UI). */
export async function downloadFile(url: string) {
  const res = await fetch(url, { credentials: 'same-origin' });
  if (!res.ok) throw await toError(res);
  const blob = await res.blob();
  const disposition = res.headers.get('content-disposition') ?? '';
  const match = /filename\*=UTF-8''([^;]+)/i.exec(disposition) ?? /filename="([^"]+)"/i.exec(disposition);
  const name = match ? decodeURIComponent(match[1]) : 'download';
  const href = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = href;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 10_000);
}

export const mediaUrl = (id: string, variant: 'thumb' | 'display' | 'display-hq' | 'poster' | 'file' = 'thumb') => `/api/media/${id}/${variant}`;
