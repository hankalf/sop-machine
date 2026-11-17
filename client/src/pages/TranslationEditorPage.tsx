import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowLeft, Check, ChevronDown } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { TranslatedContent } from '@shared/types';
import { languageInfo } from '@shared/defaults';
import { api } from '../api';
import { useToast } from '../components/Toast';
import { Badge, Button, cx, ErrorText, PageLoader } from '../components/ui';
import { useUnsavedWarning } from '../hooks';

/** Review an AI translation next to the English source and correct it. */
export default function TranslationEditorPage() {
  const { id = '', lang = '' } = useParams();
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const info = languageInfo(lang);
  const data = useQuery({ queryKey: ['translation', id, lang], queryFn: () => api.sops.translation(id, lang), refetchOnMount: 'always' });
  const sop = useQuery({ queryKey: ['sop', id], queryFn: () => api.sops.get(id) });
  const [content, setContent] = useState<TranslatedContent | null>(null);
  const [strings, setStrings] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  useUnsavedWarning(dirty);

  useEffect(() => {
    if (data.data && !content) {
      setContent(structuredClone(data.data.translation.content));
      setStrings({ ...data.data.translation.strings });
    }
  }, [data.data, content]);

  if (data.isLoading) return <PageLoader />;
  if (data.error || !data.data) return <div className="p-6"><ErrorText error={data.error ?? 'Not found'} /></div>;
  if (!content) return <PageLoader />;
  const src = data.data.source;
  const t = data.data.translation;

  const set = (fn: (c: TranslatedContent) => void) => {
    setContent((c) => {
      const next = structuredClone(c!);
      fn(next);
      return next;
    });
    setDirty(true);
  };

  const save = async () => {
    setSaving(true);
    try {
      await api.sops.saveTranslation(id, lang, { content, strings, reviewed: true });
      setDirty(false);
      void qc.invalidateQueries({ queryKey: ['translations', id] });
      void qc.invalidateQueries({ queryKey: ['sop-languages', id] });
      toast.success(`${info.name} translation saved and marked as reviewed`);
      navigate(`/sops/${id}`);
    } catch (e) {
      toast.error(e);
    } finally {
      setSaving(false);
    }
  };

  let stepNo = 0;
  return (
    <div className="flex h-screen flex-col bg-slate-100">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-3 sm:px-4">
        <Link to={`/sops/${id}`} className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900" aria-label="Back">
          <ArrowLeft className="size-5" />
        </Link>
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-semibold tracking-wide text-slate-500 uppercase">Review translation · {info.name}</div>
          <div className="truncate text-sm font-semibold">{src.content.title}</div>
        </div>
        {t.status === 'reviewed' && !t.outdated ? <Badge color="#16a34a">Reviewed</Badge> : <Badge color="#2563eb">AI translation</Badge>}
        <Button size="sm" variant="primary" icon={<Check className="size-4" />} onClick={save} loading={saving}>
          Save as reviewed
        </Button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
        <div className="mx-auto max-w-6xl space-y-5 p-4 sm:p-6">
          {t.outdated && (
            <div className="flex gap-2 rounded-lg bg-amber-50 px-3 py-2.5 text-sm text-amber-900 ring-1 ring-amber-200">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <span>
                The English text changed after this translation was made (Rev {t.sourceVersion}). Check every row against the English on the left, or go back and choose <strong>Redo</strong> to translate again. Saving marks it as matching the current text.
              </span>
            </div>
          )}
          <div className="hidden grid-cols-2 gap-4 px-4 text-xs font-semibold tracking-wide text-slate-500 uppercase md:grid">
            <span>English (source)</span>
            <span>{info.native}</span>
          </div>

          <Group title="Title & overview">
            <Row source={src.content.title} value={content.title} onChange={(v) => set((c) => void (c.title = v))} dir={info.rtl} />
            {(['purpose', 'scope', 'responsibilities', 'notes'] as const).map((k) =>
              src.content[k].trim() ? <Row key={k} label={k === 'responsibilities' ? 'Roles' : k} source={src.content[k]} value={content[k]} onChange={(v) => set((c) => void (c[k] = v))} dir={info.rtl} /> : null,
            )}
          </Group>

          {(src.content.safety.length > 0 || src.content.tools.length > 0) && (
            <Group title="Safety, equipment & systems">
              {src.content.safety.map((x, i) => (
                <Row key={`s${i}`} label="Safety" source={x} value={content.safety[i] ?? ''} onChange={(v) => set((c) => void (c.safety[i] = v))} dir={info.rtl} />
              ))}
              {src.content.tools.map((x, i) => (
                <Row key={`t${i}`} label="Equipment" source={x} value={content.tools[i] ?? ''} onChange={(v) => set((c) => void (c.tools[i] = v))} dir={info.rtl} />
              ))}
            </Group>
          )}

          <Group title="Procedure">
            {src.content.steps.map((st, i) => {
              const cur = content.steps[i];
              const isStep = sop.data?.content.steps.find((x) => x.id === st.id)?.kind !== 'section';
              const label = isStep ? `Step ${++stepNo}` : 'Section';
              return (
                <div key={st.id} className="space-y-2 border-b border-slate-100 pb-3 last:border-0 last:pb-0">
                  <Row label={label} source={st.title} value={cur.title} onChange={(v) => set((c) => void (c.steps[i].title = v))} dir={info.rtl} strong />
                  {st.body.trim() && <Row source={st.body} value={cur.body} onChange={(v) => set((c) => void (c.steps[i].body = v))} dir={info.rtl} />}
                  {st.callout && <Row label="Callout" source={st.callout} value={cur.callout} onChange={(v) => set((c) => void (c.steps[i].callout = v))} dir={info.rtl} />}
                  {st.captions.map((cap, ci) =>
                    cap ? <Row key={ci} label="Caption" source={cap} value={cur.captions[ci] ?? ''} onChange={(v) => set((c) => void (c.steps[i].captions[ci] = v))} dir={info.rtl} /> : null,
                  )}
                </div>
              );
            })}
          </Group>

          {(src.content.attachments.some(Boolean) || src.content.checklistFields.length > 0) && (
            <Group title="Other">
              {src.content.attachments.map((x, i) => (x ? <Row key={`a${i}`} label="Caption" source={x} value={content.attachments[i] ?? ''} onChange={(v) => set((c) => void (c.attachments[i] = v))} dir={info.rtl} /> : null))}
              {src.content.checklistFields.map((x, i) => (
                <Row key={`f${i}`} label="Checklist field" source={x} value={content.checklistFields[i] ?? ''} onChange={(v) => set((c) => void (c.checklistFields[i] = v))} dir={info.rtl} />
              ))}
            </Group>
          )}

          <Group title="Document labels" description="Headings and fixed wording printed on the document (section names, table headers, footer)." collapsed>
            {Object.entries(src.strings).map(([k, v]) =>
              v ? (
                <Row
                  key={k}
                  source={v}
                  value={strings[k] ?? ''}
                  onChange={(nv) => {
                    setStrings((s) => ({ ...s, [k]: nv }));
                    setDirty(true);
                  }}
                  dir={info.rtl}
                />
              ) : null,
            )}
          </Group>
          <div className="h-8" />
        </div>
      </div>
    </div>
  );
}

function Group({ title, description, children, collapsed = false }: { title: string; description?: string; children: ReactNode; collapsed?: boolean }) {
  const [open, setOpen] = useState(!collapsed);
  return (
    <section className="rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
      <button onClick={() => setOpen(!open)} className="flex w-full items-center justify-between px-4 py-3 text-left">
        <span>
          <span className="text-sm font-semibold">{title}</span>
          {description && <span className="block text-xs text-slate-500">{description}</span>}
        </span>
        <ChevronDown className={cx('size-4 text-slate-400 transition', open && 'rotate-180')} />
      </button>
      {open && <div className="space-y-3 border-t border-slate-100 p-4">{children}</div>}
    </section>
  );
}

function Row({ label, source, value, onChange, dir, strong }: { label?: string; source: string; value: string; onChange: (v: string) => void; dir?: boolean; strong?: boolean }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight + 2}px`;
  }, [value]);
  return (
    <div className="grid gap-2 md:grid-cols-2 md:gap-4">
      <div className={cx('rounded-lg bg-slate-50 px-3 py-2 text-sm whitespace-pre-wrap text-slate-600', strong && 'font-semibold text-slate-800')}>
        {label && <span className="mb-0.5 block text-[10px] font-semibold tracking-wide text-slate-400 uppercase">{label}</span>}
        {source}
      </div>
      <textarea
        ref={ref}
        value={value}
        dir={dir ? 'rtl' : undefined}
        onChange={(e) => onChange(e.target.value)}
        rows={1}
        className={cx(
          'block w-full resize-none rounded-lg border-0 px-3 py-2 text-sm leading-relaxed shadow-sm ring-1 ring-inset focus:ring-2 focus:ring-brand',
          strong && 'font-semibold',
          value.trim() ? 'ring-slate-300' : 'bg-amber-50 ring-amber-300',
        )}
      />
    </div>
  );
}
