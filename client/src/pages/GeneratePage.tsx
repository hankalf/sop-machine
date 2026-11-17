import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, CheckCircle2, FileText, FileUp, Film, Loader2, Monitor, NotebookPen, Sparkles, Truck, UploadCloud, X } from 'lucide-react';
import { useEffect, useRef, useState, type DragEvent, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import type { Category, GenerationJob, Template } from '@shared/types';
import { api } from '../api';
import { useToast } from '../components/Toast';
import { Button, Card, cx, ErrorText, Field, formatBytes, Input, Select, Textarea, Toggle, timeAgo } from '../components/ui';

type Tab = 'recording' | 'import' | 'notes';

export default function GeneratePage() {
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab) ?? 'recording';
  const status = useQuery({ queryKey: ['ai-status'], queryFn: api.generate.status });
  const categories = useQuery({ queryKey: ['categories'], queryFn: api.categories.list });
  const templates = useQuery({ queryKey: ['templates'], queryFn: api.templates.list });
  const jobs = useQuery({
    queryKey: ['jobs'],
    queryFn: api.jobs.list,
    refetchInterval: (q) => (q.state.data?.some((j) => j.status === 'queued' || j.status === 'running') ? 1500 : false),
  });

  const tabs: { id: Tab; label: string; icon: ReactNode; blurb: string }[] = [
    { id: 'recording', label: 'From a recording', icon: <Film className="size-4" />, blurb: 'Screen recording of a computer system, or a phone video of a floor task' },
    { id: 'import', label: 'Import existing SOPs', icon: <FileUp className="size-4" />, blurb: 'Convert old PDF or Word SOPs into your new template, in bulk' },
    { id: 'notes', label: 'From notes', icon: <NotebookPen className="size-4" />, blurb: 'Rough notes or a description of how the job is done' },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
          <Sparkles className="size-6 text-violet-600" /> Generate & import
        </h1>
        <p className="text-sm text-slate-500">AI writes the first draft in your standard format. You review and edit it before anyone sees it.</p>
      </div>

      {status.data && !status.data.configured && (
        <div className="flex gap-3 rounded-xl bg-amber-50 p-4 text-sm text-amber-900 ring-1 ring-amber-200">
          <AlertCircle className="size-5 shrink-0" />
          <div>
            <strong>AI is not set up yet.</strong> An administrator needs to add an <code className="rounded bg-amber-100 px-1">ANTHROPIC_API_KEY</code> variable to the Railway service, then redeploy.
          </div>
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-3">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setParams({ tab: t.id })}
            className={cx('rounded-xl p-4 text-left ring-1 transition', tab === t.id ? 'bg-white shadow-sm ring-2 ring-brand' : 'bg-white/60 ring-slate-200 hover:bg-white')}
          >
            <div className={cx('flex items-center gap-2 text-sm font-semibold', tab === t.id ? 'text-brand' : 'text-slate-800')}>
              {t.icon} {t.label}
            </div>
            <p className="mt-1 text-xs text-slate-500">{t.blurb}</p>
          </button>
        ))}
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div>
          {tab === 'recording' && <RecordingForm categories={categories.data ?? []} />}
          {tab === 'import' && <ImportForm categories={categories.data ?? []} templates={templates.data ?? []} />}
          {tab === 'notes' && <NotesForm categories={categories.data ?? []} />}
        </div>
        <Card title="Recent runs" bodyClassName="p-0">
          {!jobs.data?.length ? (
            <p className="px-5 py-4 text-sm text-slate-500">Nothing yet. Your generated drafts will appear here.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {jobs.data.map((j) => (
                <JobRow key={j.id} job={j} />
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

function JobRow({ job }: { job: GenerationJob }) {
  const icon = job.type === 'recording' ? <Film className="size-4" /> : job.type === 'import' ? <FileUp className="size-4" /> : <NotebookPen className="size-4" />;
  return (
    <li className="px-5 py-3">
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 text-slate-400">{icon}</span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-sm font-medium">{job.title}</span>
            {job.status === 'done' ? (
              <CheckCircle2 className="size-4 shrink-0 text-emerald-600" />
            ) : job.status === 'error' ? (
              <AlertCircle className="size-4 shrink-0 text-red-600" />
            ) : (
              <Loader2 className="size-4 shrink-0 animate-spin text-brand" />
            )}
          </div>
          {job.status === 'error' ? (
            <p className="mt-0.5 text-xs text-red-700">{job.error}</p>
          ) : (
            <p className="mt-0.5 text-xs text-slate-500">{job.message}</p>
          )}
          {(job.status === 'running' || job.status === 'queued') && (
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100">
              <div className="h-full rounded-full bg-brand transition-all" style={{ width: `${Math.max(4, job.progress)}%` }} />
            </div>
          )}
          <div className="mt-1 flex items-center justify-between text-[11px] text-slate-400">
            <span>{timeAgo(job.createdAt)}</span>
            {job.resultSopId && (
              <Link to={`/sops/${job.resultSopId}/edit`} className="font-semibold text-brand hover:underline">
                Review draft →
              </Link>
            )}
          </div>
        </div>
      </div>
    </li>
  );
}

function DropZone({ accept, multiple, files, onFiles, title, hint }: { accept: string; multiple?: boolean; files: File[]; onFiles: (f: File[]) => void; title: string; hint: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    const dropped = Array.from(e.dataTransfer.files);
    onFiles(multiple ? [...files, ...dropped] : dropped.slice(0, 1));
  };
  return (
    <div>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
        onClick={() => input.current?.click()}
        className={cx('flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-10 text-center transition', over ? 'border-brand bg-brand/5' : 'border-slate-300 bg-slate-50 hover:border-brand/60')}
      >
        <UploadCloud className="mb-2 size-8 text-slate-400" />
        <p className="text-sm font-semibold text-slate-800">{title}</p>
        <p className="mt-1 text-xs text-slate-500">{hint}</p>
        <input
          ref={input}
          type="file"
          accept={accept}
          multiple={multiple}
          className="hidden"
          onChange={(e) => {
            const picked = Array.from(e.target.files ?? []);
            onFiles(multiple ? [...files, ...picked] : picked.slice(0, 1));
            e.target.value = '';
          }}
        />
      </div>
      {files.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {files.map((f, i) => (
            <li key={`${f.name}-${i}`} className="flex items-center gap-2 rounded-lg bg-white px-3 py-2 text-sm ring-1 ring-slate-200">
              <FileText className="size-4 text-slate-400" />
              <span className="min-w-0 flex-1 truncate">{f.name}</span>
              <span className="text-xs text-slate-500">{formatBytes(f.size)}</span>
              <button onClick={() => onFiles(files.filter((_, j) => j !== i))} className="text-slate-400 hover:text-red-600" aria-label="Remove file">
                <X className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function useJobStarter() {
  const qc = useQueryClient();
  const toast = useToast();
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<unknown>(null);
  const start = async (fn: (onProgress: (n: number) => void) => Promise<unknown>, success: string) => {
    setError(null);
    setProgress(0);
    try {
      await fn(setProgress);
      toast.success(success);
      void qc.invalidateQueries({ queryKey: ['jobs'] });
      return true;
    } catch (e) {
      setError(e);
      return false;
    } finally {
      setProgress(null);
    }
  };
  return { start, progress, error };
}

function CategorySelect({ categories, value, onChange, auto }: { categories: Category[]; value: string; onChange: (v: string) => void; auto?: boolean }) {
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value)}>
      {auto && <option value="auto">Detect automatically</option>}
      <option value="">No category</option>
      {categories.map((c) => (
        <option key={c.id} value={c.id}>
          {c.name}
        </option>
      ))}
    </Select>
  );
}

function RecordingForm({ categories }: { categories: Category[] }) {
  const [files, setFiles] = useState<File[]>([]);
  const [type, setType] = useState<'screen' | 'physical'>('screen');
  const [processName, setProcessName] = useState('');
  const [systemName, setSystemName] = useState('');
  const [audience, setAudience] = useState('');
  const [notes, setNotes] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const { start, progress, error } = useJobStarter();

  useEffect(() => {
    if (!categoryId && categories.length) setCategoryId(categories.find((c) => c.code === (type === 'screen' ? 'SYS' : 'TRL'))?.id ?? '');
  }, [categories, type, categoryId]);

  const submit = async () => {
    const form = new FormData();
    form.append('recordingType', type);
    form.append('processName', processName);
    form.append('systemName', systemName);
    form.append('audience', audience);
    form.append('notes', notes);
    form.append('categoryId', categoryId);
    form.append('video', files[0]);
    if (await start((p) => api.generate.recording(form, p), 'Upload complete. The AI is writing your SOP.')) setFiles([]);
  };

  return (
    <Card bodyClassName="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2">
        <TypeOption active={type === 'screen'} onClick={() => setType('screen')} icon={<Monitor className="size-5" />} title="Computer screen" text="WMS, ERP, label printing… Screenshots of each step are captured and the button to click is highlighted." />
        <TypeOption active={type === 'physical'} onClick={() => setType('physical')} icon={<Truck className="size-5" />} title="Floor task video" text="Trailer, dock, forklift or packing work filmed on a phone. Clear frames become step photos." />
      </div>
      <DropZone accept="video/*,.mov,.mkv,.avi" files={files} onFiles={setFiles} title="Drop the video here or click to choose" hint="MP4, MOV, WebM… Long recordings work; 1–10 minutes is ideal." />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="What process is this?">
          <Input value={processName} onChange={(e) => setProcessName(e.target.value)} placeholder={type === 'screen' ? 'e.g. Receive a purchase order' : 'e.g. Trailer pre-load inspection'} />
        </Field>
        <Field label={type === 'screen' ? 'System / application' : 'Equipment / area'}>
          <Input value={systemName} onChange={(e) => setSystemName(e.target.value)} placeholder={type === 'screen' ? 'e.g. Manhattan WMS' : 'e.g. Dock doors 1–12'} />
        </Field>
        <Field label="Who does it?">
          <Input value={audience} onChange={(e) => setAudience(e.target.value)} placeholder="e.g. Receiving clerk" />
        </Field>
        <Field label="Category">
          <CategorySelect categories={categories} value={categoryId} onChange={setCategoryId} />
        </Field>
      </div>
      <Field label="Anything the AI should know?" hint="Site rules, things that aren't visible on screen, warnings to include.">
        <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Always use printer ZBR-04 at the receiving desk." />
      </Field>
      <ErrorText error={error} />
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="primary" size="lg" icon={<Sparkles className="size-4" />} disabled={!files.length} loading={progress !== null} onClick={submit}>
          {progress !== null ? `Uploading ${progress}%` : 'Generate SOP'}
        </Button>
        <span className="text-xs text-slate-500">Usually takes 1–4 minutes. You can leave this page.</span>
      </div>
      <details className="rounded-lg bg-slate-50 p-4 text-sm text-slate-600">
        <summary className="cursor-pointer font-semibold text-slate-800">Tips for a great recording</summary>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>Windows: press <kbd className="rounded bg-white px-1 ring-1 ring-slate-300">Win</kbd>+<kbd className="rounded bg-white px-1 ring-1 ring-slate-300">Alt</kbd>+<kbd className="rounded bg-white px-1 ring-1 ring-slate-300">R</kbd> (Game Bar) or use Snipping Tool → Record. Mac: <kbd className="rounded bg-white px-1 ring-1 ring-slate-300">⌘</kbd>+<kbd className="rounded bg-white px-1 ring-1 ring-slate-300">Shift</kbd>+<kbd className="rounded bg-white px-1 ring-1 ring-slate-300">5</kbd>.</li>
          <li>Work slowly and pause about a second after each click so every screen is captured clearly.</li>
          <li>Use test data where you can. Customer names and addresses can be blacked out afterwards with the Redact tool.</li>
          <li>For floor videos, hold the phone steady and film each action from where the associate stands.</li>
        </ul>
      </details>
    </Card>
  );
}

function TypeOption({ active, onClick, icon, title, text }: { active: boolean; onClick: () => void; icon: ReactNode; title: string; text: string }) {
  return (
    <button onClick={onClick} className={cx('flex gap-3 rounded-xl p-4 text-left ring-1 transition', active ? 'bg-brand/5 ring-2 ring-brand' : 'ring-slate-200 hover:ring-slate-400')}>
      <span className={cx('mt-0.5', active ? 'text-brand' : 'text-slate-400')}>{icon}</span>
      <span>
        <span className="block text-sm font-semibold">{title}</span>
        <span className="mt-0.5 block text-xs text-slate-500">{text}</span>
      </span>
    </button>
  );
}

function ImportForm({ categories, templates }: { categories: Category[]; templates: Template[] }) {
  const [files, setFiles] = useState<File[]>([]);
  const [categoryId, setCategoryId] = useState('auto');
  const [templateId, setTemplateId] = useState('');
  const [keepNumbers, setKeepNumbers] = useState(true);
  const { start, progress, error } = useJobStarter();

  const submit = async () => {
    const form = new FormData();
    for (const f of files) form.append('documents', f, f.name);
    form.append('categoryId', categoryId);
    form.append('templateId', templateId);
    form.append('keepNumbers', String(keepNumbers));
    if (await start((p) => api.generate.import(form, p), `Importing ${files.length} SOP${files.length === 1 ? '' : 's'}. Each one appears on the right as it finishes.`)) setFiles([]);
  };

  return (
    <Card bodyClassName="space-y-5">
      <div className="rounded-lg bg-violet-50 p-4 text-sm text-violet-900 ring-1 ring-violet-200">
        Upload the SOPs you already have. Each one is rebuilt in the unified format: the same steps, safety rules and screenshots, with your branding and template. Each one comes in as a <strong>draft</strong> for review.
      </div>
      <DropZone accept=".pdf,.docx,.txt,.md,application/pdf" multiple files={files} onFiles={setFiles} title="Drop existing SOPs here or click to choose" hint="PDF or Word (.docx), up to 25 files at a time. Save old .doc files as .docx first." />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Category" hint="Detecting automatically also picks each category's template.">
          <CategorySelect categories={categories} value={categoryId} onChange={setCategoryId} auto />
        </Field>
        <Field label="Template">
          <Select value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
            <option value="">Use the category's template</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Toggle checked={keepNumbers} onChange={setKeepNumbers} label="Keep original SOP numbers and revisions" description="When the original has a number that isn't already used, keep it. Otherwise a new number is assigned." />
      <ErrorText error={error} />
      <Button variant="primary" size="lg" icon={<FileUp className="size-4" />} disabled={!files.length} loading={progress !== null} onClick={submit}>
        {progress !== null ? `Uploading ${progress}%` : `Import ${files.length || ''} SOP${files.length === 1 ? '' : 's'}`}
      </Button>
    </Card>
  );
}

function NotesForm({ categories }: { categories: Category[] }) {
  const [text, setText] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [processName, setProcessName] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const { start, progress, error } = useJobStarter();
  const navigate = useNavigate();

  const submit = async () => {
    const form = new FormData();
    form.append('text', text);
    form.append('processName', processName);
    form.append('categoryId', categoryId);
    if (files[0]) form.append('document', files[0]);
    if (await start((p) => api.generate.notes(form, p), 'The AI is writing your SOP.')) {
      setText('');
      setFiles([]);
      navigate('/generate?tab=notes');
    }
  };

  return (
    <Card bodyClassName="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="What process is this?">
          <Input value={processName} onChange={(e) => setProcessName(e.target.value)} placeholder="e.g. Cycle count a pick face" />
        </Field>
        <Field label="Category">
          <CategorySelect categories={categories} value={categoryId} onChange={setCategoryId} />
        </Field>
      </div>
      <Field label="Notes" hint="Bullet points are fine. Include system names, screen labels, locations and safety rules.">
        <Textarea value={text} onChange={(e) => setText(e.target.value)} className="min-h-56" placeholder={'- log into RF gun, menu 3 cycle count\n- scan location, count cases, enter qty\n- if variance > 5 call lead\n- wear gloves, watch for forklifts in aisle'} />
      </Field>
      <DropZone accept=".pdf,.docx,.txt,.md" files={files} onFiles={setFiles} title="Optional: add a reference document" hint="A PDF or Word file with extra information" />
      <ErrorText error={error} />
      <Button variant="primary" size="lg" icon={<Sparkles className="size-4" />} disabled={!text.trim() && !files.length} loading={progress !== null} onClick={submit}>
        Generate SOP
      </Button>
    </Card>
  );
}
