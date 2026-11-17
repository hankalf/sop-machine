import type {
  AppSettings,
  Category,
  GenerationJob,
  MediaItem,
  PublicBranding,
  Revision,
  Sop,
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
  try {
    const data = await res.json();
    if (data?.error) message = data.error;
  } catch {
    /* not JSON */
  }
  if (res.status === 401) window.dispatchEvent(new Event('sop:unauthorized'));
  return new ApiError(res.status, message);
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

export const api = {
  auth: {
    me: () => get<User>('/api/auth/me'),
    login: (email: string, password: string) => post<User>('/api/auth/login', { email, password }),
    logout: () => post('/api/auth/logout'),
    updateMe: (body: { name?: string; currentPassword?: string; newPassword?: string }) => put<User>('/api/auth/me', body),
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
    renderUrl: (id: string, mode: 'web' | 'paged', version: string | number) => `/api/sops/${id}/render?mode=${mode}&v=${encodeURIComponent(String(version))}`,
  },
  media: {
    upload: (files: File[], opts: { parentId?: string; onProgress?: (pct: number) => void } = {}) => {
      const form = new FormData();
      for (const f of files) form.append('files', f, f.name);
      if (opts.parentId) form.append('parentId', opts.parentId);
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
    update: (id: string, u: { name?: string; role?: string; disabled?: boolean; password?: string }) => put<User>(`/api/users/${id}`, u),
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
  system: () => get<SystemInfo>('/api/system'),
  generate: {
    status: () => get<{ configured: boolean }>('/api/generate/status'),
    recording: (form: FormData, onProgress?: (pct: number) => void) => uploadForm<GenerationJob>('/api/generate/recording', form, onProgress),
    notes: (form: FormData, onProgress?: (pct: number) => void) => uploadForm<GenerationJob>('/api/generate/notes', form, onProgress),
    import: (form: FormData, onProgress?: (pct: number) => void) => uploadForm<GenerationJob[]>('/api/generate/import', form, onProgress),
  },
  jobs: {
    list: () => get<GenerationJob[]>('/api/jobs'),
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
