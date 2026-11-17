import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowLeft, Check, CloudOff, Eye, EyeOff, Loader2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { MediaItem, Sop, SopContent } from '@shared/types';
import { PPE_SUGGESTIONS } from '@shared/defaults';
import { api } from '../api';
import { ListEditor, MarkdownField } from '../components/editor-fields';
import { LivePreview } from '../components/LivePreview';
import { StatusBadge } from '../components/status';
import { MediaGrid, StepsEditor, useUploader } from '../components/StepsEditor';
import { Button, Card, ErrorText, Field, IconButton, Input, PageLoader, Segmented, Select, Toggle, cx } from '../components/ui';
import { ListChecks, Plus, Trash2 } from 'lucide-react';
import type { ChecklistConfig } from '@shared/types';
import { ImagePlus } from 'lucide-react';
import { useDebounced, useUnsavedWarning } from '../hooks';

type SaveState = 'saved' | 'dirty' | 'saving' | 'error';

export default function SopEditorPage() {
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const loaded = useQuery({ queryKey: ['sop', id], queryFn: () => api.sops.get(id), refetchOnMount: 'always' });
  const categories = useQuery({ queryKey: ['categories'], queryFn: api.categories.list });
  const templates = useQuery({ queryKey: ['templates'], queryFn: api.templates.list });
  const directory = useQuery({ queryKey: ['directory'], queryFn: api.directory });

  const [doc, setDoc] = useState<Sop | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('saved');
  const [saveError, setSaveError] = useState<unknown>(null);
  const [savedAt, setSavedAt] = useState(0);
  const [media, setMedia] = useState<Map<string, MediaItem>>(new Map());
  const [showPreview, setShowPreview] = useState(() => localStorage.getItem('sop:editor-preview') !== 'off' && window.innerWidth >= 1280);
  const [focusTarget, setFocusTarget] = useState<string | null>(null);
  const [tagsText, setTagsText] = useState('');

  const docRef = useRef<Sop | null>(null);
  docRef.current = doc;
  const saving = useRef(false);
  const again = useRef(false);
  const timer = useRef<number>(0);
  const uploaders = useRef(new Map<string, (files: File[]) => void>());
  const activeTarget = useRef<string | null>(null);

  useUnsavedWarning(saveState === 'dirty' || saveState === 'saving');

  // Initialize from the server once.
  useEffect(() => {
    if (loaded.data && !doc) {
      setDoc(loaded.data);
      setTagsText(loaded.data.tags.join(', '));
    }
  }, [loaded.data, doc]);

  // Load metadata for all referenced media (kind, processing state).
  const mediaIds = useMemo(
    () => (doc ? [...doc.content.steps.flatMap((s) => s.media.map((m) => m.mediaId)), ...doc.content.attachments.map((m) => m.mediaId)] : []),
    [doc],
  );
  useEffect(() => {
    const missing = mediaIds.filter((m) => !media.has(m));
    if (!missing.length) return;
    void Promise.all(missing.map((m) => api.media.get(m).catch(() => null))).then((items) => {
      setMedia((prev) => {
        const next = new Map(prev);
        for (const it of items) if (it) next.set(it.id, it);
        return next;
      });
    });
  }, [mediaIds, media]);
  const addMedia = useCallback((m: MediaItem) => setMedia((prev) => new Map(prev).set(m.id, m)), []);

  const save = useCallback(async () => {
    const current = docRef.current;
    if (!current) return;
    if (saving.current) {
      again.current = true;
      return;
    }
    saving.current = true;
    setSaveState('saving');
    try {
      const updated = await api.sops.update(id, {
        number: current.number,
        title: current.title,
        categoryId: current.categoryId,
        templateId: current.templateId,
        owner: current.owner,
        approver: current.approver,
        ownerUserId: current.ownerUserId,
        reviewDate: current.reviewDate,
        tags: current.tags,
        content: current.content,
      });
      // Keep local edits; take server-controlled fields.
      setDoc((d) => (d ? { ...d, status: updated.status, version: updated.version, updatedAt: updated.updatedAt, number: updated.number } : d));
      qc.setQueryData(['sop', id], updated);
      void qc.invalidateQueries({ queryKey: ['sops'] });
      setSaveError(null);
      setSavedAt(Date.now());
      setSaveState(again.current ? 'dirty' : 'saved');
    } catch (e) {
      setSaveError(e);
      setSaveState('error');
    } finally {
      saving.current = false;
      if (again.current) {
        again.current = false;
        void save();
      }
    }
  }, [id, qc]);

  const patch = useCallback(
    (fn: (d: Sop) => Sop) => {
      setDoc((d) => (d ? fn(d) : d));
      setSaveState('dirty');
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => void save(), 900);
    },
    [save],
  );
  const patchContent = useCallback((fn: (c: SopContent) => SopContent) => patch((d) => ({ ...d, content: fn(d.content) })), [patch]);

  // Ctrl+S saves immediately; Ctrl+V pastes screenshots into the step you are working on.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        window.clearTimeout(timer.current);
        void save();
      }
    };
    const onPaste = (e: ClipboardEvent) => {
      const files = Array.from(e.clipboardData?.files ?? []).filter((f) => f.type.startsWith('image/'));
      if (!files.length || !activeTarget.current) return;
      const up = uploaders.current.get(activeTarget.current);
      if (!up) return;
      e.preventDefault();
      up(files.map((f, i) => new File([f], f.name && f.name !== 'image.png' ? f.name : `screenshot-${Date.now()}-${i}.png`, { type: f.type })));
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('paste', onPaste);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('paste', onPaste);
    };
  }, [save]);

  const registerUploader = useCallback((key: string, fn: (files: File[]) => void) => uploaders.current.set(key, fn), []);
  const attachments = useUploader((items) => {
    items.forEach(addMedia);
    patchContent((c) => ({ ...c, attachments: [...c.attachments, ...items.map((m) => ({ mediaId: m.id, caption: '' }))] }));
  });
  registerUploader('attachments', attachments.upload);

  // Preview refreshes after each successful save.
  const previewKey = useDebounced(savedAt, 300);

  const togglePreview = () => {
    setShowPreview((v) => {
      localStorage.setItem('sop:editor-preview', v ? 'off' : 'on');
      return !v;
    });
  };

  if (loaded.isLoading || (!doc && !loaded.error)) return <PageLoader />;
  if (loaded.error || !doc) return <div className="p-6"><ErrorText error={loaded.error} /></div>;
  const c = doc.content;
  const category = categories.data?.find((x) => x.id === doc.categoryId);
  const categoryTemplate = templates.data?.find((t) => t.id === category?.templateId) ?? templates.data?.find((t) => t.isDefault);
  const wasApproved = loaded.data?.status === 'approved' && doc.status === 'approved';

  return (
    <div className="flex h-screen flex-col bg-slate-100">
      <header className="z-20 flex h-14 shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-3 sm:px-4">
        <Link to={`/sops/${id}`} className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900" aria-label="Back">
          <ArrowLeft className="size-5" />
        </Link>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="hidden font-mono text-xs text-slate-500 sm:inline">{doc.number}</span>
            <StatusBadge status={doc.status} />
            <span className="text-xs text-slate-500">Rev {doc.version}</span>
          </div>
          <div className="truncate text-sm font-semibold">{doc.title || 'Untitled'}</div>
        </div>
        <SaveIndicator state={saveState} />
        <Button size="sm" variant="ghost" onClick={togglePreview} icon={showPreview ? <EyeOff className="size-4" /> : <Eye className="size-4" />} className="hidden md:inline-flex">
          {showPreview ? 'Hide preview' : 'Show preview'}
        </Button>
        <Button
          size="sm"
          variant="primary"
          icon={<Check className="size-4" />}
          onClick={async () => {
            window.clearTimeout(timer.current);
            await save();
            navigate(`/sops/${id}`);
          }}
        >
          Done
        </Button>
      </header>

      <div className={cx('grid min-h-0 flex-1', showPreview ? 'md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] 2xl:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]' : 'grid-cols-1')}>
        <div className="min-h-0 overflow-y-auto scrollbar-thin">
          <div className="mx-auto max-w-3xl space-y-5 p-4 sm:p-6">
            {saveState === 'error' && <ErrorText error={saveError} />}
            {wasApproved && (
              <div className="flex gap-2 rounded-lg bg-amber-50 px-3 py-2.5 text-sm text-amber-900 ring-1 ring-amber-200">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                This SOP is approved. Your first change starts a new draft revision. Everyone keeps seeing the approved version until the draft is approved.
              </div>
            )}

            <Card title="Document" bodyClassName="space-y-4">
              <Field label="Title">
                <Input value={doc.title} onChange={(e) => patch((d) => ({ ...d, title: e.target.value }))} className="h-10 text-base font-semibold" />
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="SOP number">
                  <Input value={doc.number} onChange={(e) => patch((d) => ({ ...d, number: e.target.value }))} className="font-mono" />
                </Field>
                <Field label="Category">
                  <Select value={doc.categoryId ?? ''} onChange={(e) => patch((d) => ({ ...d, categoryId: e.target.value || null }))}>
                    <option value="">No category</option>
                    {categories.data?.map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Template" hint="Controls the look of the PDF and Word export.">
                  <Select value={doc.templateId ?? ''} onChange={(e) => patch((d) => ({ ...d, templateId: e.target.value || null }))}>
                    <option value="">{category ? `Category default (${categoryTemplate?.name ?? '—'})` : `Default (${categoryTemplate?.name ?? '—'})`}</option>
                    {templates.data?.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Tags" hint="Comma separated">
                  <Input
                    value={tagsText}
                    onChange={(e) => {
                      setTagsText(e.target.value);
                      const tags = e.target.value.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean);
                      patch((d) => ({ ...d, tags }));
                    }}
                    placeholder="dock, forklift, wms"
                  />
                </Field>
                <Field label="Owner (prepared by)">
                  <Input value={doc.owner} onChange={(e) => patch((d) => ({ ...d, owner: e.target.value }))} />
                </Field>
                <Field label="Approver">
                  <Input value={doc.approver} onChange={(e) => patch((d) => ({ ...d, approver: e.target.value }))} placeholder="Set on approval if empty" />
                </Field>
                <Field label="Reminders go to" hint="Gets the email when this SOP is due for review or is approved.">
                  <Select value={doc.ownerUserId ?? ''} onChange={(e) => patch((d) => ({ ...d, ownerUserId: e.target.value || null }))}>
                    <option value="">Administrators</option>
                    {directory.data?.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
            </Card>

            <Card title="Overview" description="Why this SOP exists, where it applies and who does what." bodyClassName="space-y-4">
              <Field label="Purpose">
                <MarkdownField value={c.purpose} onChange={(v) => patchContent((x) => ({ ...x, purpose: v }))} placeholder="Why this procedure exists" minRows={2} />
              </Field>
              <Field label="Scope">
                <MarkdownField value={c.scope} onChange={(v) => patchContent((x) => ({ ...x, scope: v }))} placeholder="Which sites, areas, shifts and roles it applies to" minRows={2} />
              </Field>
              <Field label="Roles & responsibilities">
                <MarkdownField value={c.responsibilities} onChange={(v) => patchContent((x) => ({ ...x, responsibilities: v }))} placeholder="- **Dock associate:** …" minRows={2} />
              </Field>
            </Card>

            <div className="grid gap-5 lg:grid-cols-2">
              <Card title="Safety & PPE">
                <ListEditor items={c.safety} onChange={(v) => patchContent((x) => ({ ...x, safety: v }))} placeholder="Add PPE or hazard…" suggestions={PPE_SUGGESTIONS} />
              </Card>
              <Card title="Equipment, tools & systems">
                <ListEditor items={c.tools} onChange={(v) => patchContent((x) => ({ ...x, tools: v }))} placeholder="e.g. RF scanner, WMS receiving screen…" />
              </Card>
            </div>

            <section className="space-y-3">
              <div className="flex items-end justify-between">
                <div>
                  <h2 className="text-base font-semibold">Procedure</h2>
                  <p className="text-xs text-slate-500">Drag to reorder. Paste screenshots straight into the step you're editing with Ctrl+V.</p>
                </div>
              </div>
              <StepsEditor
                steps={c.steps}
                media={media}
                onChange={(steps) => patchContent((x) => ({ ...x, steps }))}
                onMediaLoaded={addMedia}
                registerUploader={registerUploader}
                onFocusStep={(stepId) => {
                  activeTarget.current = stepId;
                  setFocusTarget(`step-${stepId}`);
                }}
              />
            </section>

            <ChecklistCard value={c.checklist} onChange={(checklist) => patchContent((x) => ({ ...x, checklist }))} />

            <Card title="Notes & references">
              <MarkdownField value={c.notes} onChange={(v) => patchContent((x) => ({ ...x, notes: v }))} placeholder="Related SOPs, forms, definitions…" minRows={2} />
            </Card>

            <Card title="Reference media" description="Full walkthrough videos or extra photos shown at the end. In the PDF, videos become a QR code." bodyClassName="p-4">
              <div onFocus={() => (activeTarget.current = 'attachments')} tabIndex={-1}>
                <MediaGrid
                  items={c.attachments}
                  media={media}
                  onChange={(items) => patchContent((x) => ({ ...x, attachments: items }))}
                  onMediaLoaded={addMedia}
                  uploading={attachments.progress}
                  addButton={
                    <label className="flex aspect-video cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-slate-300 text-xs font-medium text-slate-500 hover:border-brand hover:text-brand">
                      <ImagePlus className="size-5" /> Add video or photo
                      <input type="file" accept="image/*,video/*,.mov" multiple className="hidden" onChange={(e) => { void attachments.upload(Array.from(e.target.files ?? [])); e.target.value = ''; }} />
                    </label>
                  }
                />
              </div>
            </Card>
            <div className="h-10" />
          </div>
        </div>

        {showPreview && (
          <div className="hidden min-h-0 border-l border-slate-300 md:block">
            <LivePreview src={api.sops.renderUrl(id, 'paged', previewKey)} paged className="size-full" scrollTarget={focusTarget} />
          </div>
        )}
      </div>
    </div>
  );
}

function SaveIndicator({ state }: { state: SaveState }) {
  const map = {
    saved: { icon: <Check className="size-3.5" />, text: 'Saved', cls: 'text-emerald-700' },
    dirty: { icon: <Loader2 className="size-3.5 animate-spin" />, text: 'Editing…', cls: 'text-slate-500' },
    saving: { icon: <Loader2 className="size-3.5 animate-spin" />, text: 'Saving…', cls: 'text-slate-500' },
    error: { icon: <CloudOff className="size-3.5" />, text: 'Not saved', cls: 'text-red-600' },
  }[state];
  return <span className={cx('hidden items-center gap-1 text-xs font-medium sm:inline-flex', map.cls)}>{map.icon}{map.text}</span>;
}

function ChecklistCard({ value, onChange }: { value: ChecklistConfig; onChange: (c: ChecklistConfig) => void }) {
  const set = (p: Partial<ChecklistConfig>) => onChange({ ...value, ...p });
  return (
    <Card
      title={<span className="flex items-center gap-1.5"><ListChecks className="size-4" /> Checklist mode</span>}
      description="Let people fill this SOP in as a checklist on a phone or tablet. Each completed run is saved as a record."
      actions={<Toggle checked={value.enabled} onChange={(enabled) => set({ enabled })} />}
      bodyClassName={value.enabled ? 'space-y-4' : 'hidden'}
    >
      <Field label="Each step is answered with">
        <Segmented value={value.style} onChange={(style) => set({ style })} options={[{ value: 'passfail', label: 'Pass / Fail / N/A (inspections)' }, { value: 'check', label: 'Done / N/A (task lists)' }]} />
      </Field>
      <div>
        <div className="mb-1.5 text-xs font-semibold tracking-wide text-slate-600">Details to record at the start</div>
        <div className="space-y-2">
          {value.fields.map((f, i) => (
            <div key={f.id} className="flex items-center gap-2">
              <Input value={f.label} onChange={(e) => set({ fields: value.fields.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} placeholder="e.g. Trailer number" />
              <label className="flex items-center gap-1.5 text-xs whitespace-nowrap text-slate-600">
                <input type="checkbox" checked={f.required} onChange={(e) => set({ fields: value.fields.map((x, j) => (j === i ? { ...x, required: e.target.checked } : x)) })} className="size-4 accent-[var(--brand)]" />
                Required
              </label>
              <IconButton label="Remove field" className="hover:text-red-600" onClick={() => set({ fields: value.fields.filter((_, j) => j !== i) })}>
                <Trash2 className="size-4" />
              </IconButton>
            </div>
          ))}
          <div className="flex flex-wrap gap-1.5">
            <button type="button" onClick={() => set({ fields: [...value.fields, { id: `f${Date.now().toString(36)}`, label: '', required: false }] })} className="inline-flex h-8 items-center gap-1 rounded-md bg-slate-100 px-2.5 text-xs font-medium text-slate-700 hover:bg-slate-200">
              <Plus className="size-3.5" /> Add field
            </button>
            {['Trailer #', 'Dock door', 'Seal #', 'Carrier', 'Equipment ID', 'PO #']
              .filter((l) => !value.fields.some((f) => f.label === l))
              .map((l) => (
                <button key={l} type="button" onClick={() => set({ fields: [...value.fields, { id: `f${Date.now().toString(36)}${l.length}`, label: l, required: true }] })} className="rounded-full border border-dashed border-slate-300 px-2.5 py-0.5 text-xs text-slate-600 hover:border-brand hover:text-brand">
                  + {l}
                </button>
              ))}
          </div>
        </div>
      </div>
      <Toggle checked={value.requireNoteOnFail} onChange={(requireNoteOnFail) => set({ requireNoteOnFail })} label="Require a note when a step fails" description="Photos can always be added to any step." />
      <Toggle checked={value.requireSignature} onChange={(requireSignature) => set({ requireSignature })} label="Require a typed signature to finish" />
    </Card>
  );
}
