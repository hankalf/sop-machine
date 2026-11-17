import { useQuery, useQueryClient } from '@tanstack/react-query';
import { BookMarked, CheckCircle2, Download, Loader2 } from 'lucide-react';
import { useState } from 'react';
import type { Category } from '@shared/types';
import { languageInfo } from '@shared/defaults';
import { api, downloadFile } from '../api';
import { useCan } from '../auth';
import { useToast } from './Toast';
import { Button, ErrorText, Field, Input, Modal, Select, Toggle, timeAgo } from './ui';

/** Export a whole category (or everything) as one PDF with a master table of contents. */
export function BinderModal({ open, onClose, categories, defaultCategory }: { open: boolean; onClose: () => void; categories: Category[]; defaultCategory: string }) {
  const isEditor = useCan('editor');
  const qc = useQueryClient();
  const toast = useToast();
  const [categoryId, setCategoryId] = useState(defaultCategory);
  const [title, setTitle] = useState('');
  const [includeDrafts, setIncludeDrafts] = useState(false);
  const [language, setLanguage] = useState('en');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const settings = useQuery({ queryKey: ['settings'], queryFn: api.settings.get, enabled: open });
  const jobs = useQuery({
    queryKey: ['jobs', 'binder'],
    queryFn: () => api.jobs.list('binder'),
    enabled: open,
    refetchInterval: (q) => (q.state.data?.some((j) => j.status === 'queued' || j.status === 'running') ? 1200 : false),
  });

  const build = async () => {
    setBusy(true);
    setError(null);
    try {
      const [code, bi] = language.split('+');
      await api.binders.create({ title: title.trim() || undefined, categoryId: categoryId || null, includeDrafts, language: code, bilingual: bi !== undefined });
      await qc.invalidateQueries({ queryKey: ['jobs', 'binder'] });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  const langs = settings.data?.languages.enabled ?? [];
  return (
    <Modal open={open} onClose={onClose} title={<span className="flex items-center gap-2"><BookMarked className="size-4" /> Export a binder</span>} width="max-w-xl">
      <div className="space-y-4">
        <p className="text-sm text-slate-600">One PDF with a cover, a contents page with page numbers, and every SOP in its own template. Good for the printed binder at the dock or an auditor.</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Which SOPs">
            <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">All categories</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Language">
            <Select value={language} onChange={(e) => setLanguage(e.target.value)}>
              <option value="en">English</option>
              {langs.map((c) => (
                <option key={c} value={c}>
                  {languageInfo(c).native}
                </option>
              ))}
              {langs.map((c) => (
                <option key={`${c}+`} value={`${c}+`}>
                  English + {languageInfo(c).native}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Binder title (optional)" className="sm:col-span-2">
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={categories.find((c) => c.id === categoryId)?.name ? `${categories.find((c) => c.id === categoryId)!.name} SOPs` : 'All SOPs'} />
          </Field>
        </div>
        {isEditor && <Toggle checked={includeDrafts} onChange={setIncludeDrafts} label="Include drafts" description="Otherwise only the last approved version of each SOP is included." />}
        <ErrorText error={error} />
        <Button variant="primary" icon={<BookMarked className="size-4" />} onClick={build} loading={busy}>
          Build binder
        </Button>

        {!!jobs.data?.length && (
          <ul className="divide-y divide-slate-100 rounded-lg ring-1 ring-slate-200">
            {jobs.data.slice(0, 5).map((j) => (
              <li key={j.id} className="flex items-center gap-3 px-3 py-2.5 text-sm">
                {j.status === 'done' ? <CheckCircle2 className="size-4 shrink-0 text-emerald-600" /> : j.status === 'error' ? <span className="size-4 shrink-0 text-red-600">!</span> : <Loader2 className="size-4 shrink-0 animate-spin text-brand" />}
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{j.title}</div>
                  <div className={j.status === 'error' ? 'text-xs text-red-700' : 'text-xs text-slate-500'}>
                    {j.status === 'error' ? j.error : j.message} · {timeAgo(j.createdAt)}
                  </div>
                  {(j.status === 'running' || j.status === 'queued') && (
                    <div className="mt-1 h-1 overflow-hidden rounded-full bg-slate-100">
                      <div className="h-full bg-brand transition-all" style={{ width: `${Math.max(3, j.progress)}%` }} />
                    </div>
                  )}
                </div>
                {j.downloadUrl && (
                  <Button size="sm" icon={<Download className="size-3.5" />} onClick={() => downloadFile(j.downloadUrl!).catch(toast.error)}>
                    Download
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-slate-500">Binders are kept for 24 hours. You can close this window while one is building.</p>
      </div>
    </Modal>
  );
}
