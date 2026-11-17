import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Camera, Check, CheckCircle2, ChevronDown, Loader2, Minus, TriangleAlert, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import type { CheckItemResult, ChecklistRun, ChecklistRunStep, CheckResult } from '@shared/types';
import { CALLOUT_META } from '@shared/defaults';
import { api } from '../../api';
import { useToast } from '../../components/Toast';
import { Button, cx, ErrorText, Input, PageLoader } from '../../components/ui';
import { publicText, type PublicText } from '../../publicText';
import { FloorShell } from './shared';

const EMPTY: CheckItemResult = { result: null, note: '', mediaIds: [], at: null };

/** Fill in an SOP as a checklist on a phone or tablet. */
export default function RunPage() {
  const { token = '' } = useParams();
  const qc = useQueryClient();
  const toast = useToast();
  const loaded = useQuery({ queryKey: ['pub-run', token], queryFn: () => api.pub.run(token), retry: false });
  const [run, setRun] = useState<ChecklistRun | null>(null);
  const [signature, setSignature] = useState('');
  const [saving, setSaving] = useState(0);
  const [completing, setCompleting] = useState(false);
  const [error, setError] = useState<unknown>(null);
  // One pending save per thing being typed in, so a note and a field never cancel each other.
  const timers = useRef(new Map<string, number>());
  const later = (key: string, fn: () => void) => {
    window.clearTimeout(timers.current.get(key));
    timers.current.set(key, window.setTimeout(fn, 600));
  };

  useEffect(() => {
    if (loaded.data && !run) {
      setRun(loaded.data);
      setSignature(loaded.data.signature || loaded.data.performerName);
    }
  }, [loaded.data, run]);

  if (loaded.isLoading) return <PageLoader />;
  if (loaded.error || !run) {
    return (
      <FloorShell title="Checklist">
        <div className="p-4"><ErrorText error={loaded.error ?? 'Checklist not found'} /></div>
      </FloorShell>
    );
  }
  const t = publicText(run.language);
  const steps = run.steps.filter((s) => s.kind === 'step');
  const answered = steps.filter((s) => run.results[s.id]?.result).length;
  const fails = steps.filter((s) => run.results[s.id]?.result === 'fail').length;
  const done = run.status === 'completed';

  const send = async (body: Parameters<typeof api.pub.updateRun>[1]) => {
    setSaving((n) => n + 1);
    try {
      await api.pub.updateRun(token, body);
      setError(null);
    } catch (e) {
      setError(e);
    } finally {
      setSaving((n) => n - 1);
    }
  };

  const setResult = (stepId: string, patch: Partial<CheckItemResult>, debounce = false) => {
    setRun((r) => (r ? { ...r, results: { ...r.results, [stepId]: { ...(r.results[stepId] ?? EMPTY), ...patch } } } : r));
    if (debounce) later(stepId, () => void send({ results: { [stepId]: patch } }));
    else void send({ results: { [stepId]: patch } });
  };

  const setField = (id: string, value: string) => {
    const fields = { ...run.fields, [id]: value };
    setRun({ ...run, fields });
    later('fields', () => void send({ fields }));
  };

  const addPhoto = async (stepId: string, file: File) => {
    setSaving((n) => n + 1);
    try {
      const m = await api.pub.uploadPhoto(token, file);
      const mediaIds = [...(run.results[stepId]?.mediaIds ?? []), m.id];
      setResult(stepId, { mediaIds });
    } catch (e) {
      toast.error(e);
    } finally {
      setSaving((n) => n - 1);
    }
  };

  const complete = async () => {
    setCompleting(true);
    setError(null);
    try {
      for (const id of timers.current.values()) window.clearTimeout(id);
      await api.pub.updateRun(token, { fields: run.fields, results: run.results });
      const finished = await api.pub.completeRun(token, signature);
      setRun(finished);
      qc.setQueryData(['pub-run', token], finished);
      window.scrollTo({ top: 0 });
    } catch (e) {
      setError(e);
    } finally {
      setCompleting(false);
    }
  };

  if (done) {
    return (
      <FloorShell title={run.sopTitle} subtitle={`${run.sopNumber} · ${t.rev} ${run.version}`}>
        <div className="m-auto max-w-sm p-6 text-center">
          {run.failCount ? <TriangleAlert className="mx-auto size-16 text-amber-500" /> : <CheckCircle2 className="mx-auto size-16 text-emerald-500" />}
          <h1 className="mt-4 text-xl font-bold">{t.completed}</h1>
          <p className="mt-1 text-slate-600">{t.completedText}</p>
          <p className={cx('mt-4 rounded-lg px-4 py-3 font-semibold', run.failCount ? 'bg-amber-50 text-amber-900' : 'bg-emerald-50 text-emerald-800')}>
            {run.failCount ? `${run.failCount} ${t.failedItems}` : t.allPassed}
          </p>
          <p className="mt-4 text-xs text-slate-500">
            {run.performerName} · {run.completedAt && new Date(run.completedAt).toLocaleString()}
          </p>
        </div>
      </FloorShell>
    );
  }

  return (
    <FloorShell
      title={run.sopTitle}
      subtitle={`${run.sopNumber} · ${t.rev} ${run.version}${run.stationName ? ` · ${run.stationName}` : ''}`}
      right={
        <span className="flex items-center gap-1.5 text-xs whitespace-nowrap text-white/80">
          {saving > 0 ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
          {answered}/{steps.length}
        </span>
      }
      footer={
        <div className="mx-auto max-w-2xl space-y-2">
          <ErrorText error={error} />
          {run.checklist.requireSignature && <Input value={signature} onChange={(e) => setSignature(e.target.value)} placeholder={t.typeNameToSign} className="h-11 text-base" aria-label={t.typeNameToSign} />}
          <Button variant="primary" size="lg" className="w-full" onClick={complete} loading={completing} disabled={answered < steps.length}>
            {t.complete} {fails > 0 && `(${fails} ${t.fail.toLowerCase()})`}
          </Button>
        </div>
      }
    >
      <div className="h-1.5 bg-slate-200">
        <div className={cx('h-full transition-all', fails ? 'bg-amber-500' : 'bg-emerald-500')} style={{ width: `${steps.length ? (answered / steps.length) * 100 : 0}%` }} />
      </div>
      <div className="mx-auto w-full max-w-2xl space-y-3 p-3 pb-6">
        {run.checklist.fields.length > 0 && (
          <div className="grid gap-3 rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200 sm:grid-cols-2">
            {run.checklist.fields.map((f) => (
              <label key={f.id} className="block">
                <span className="mb-1 block text-xs font-semibold text-slate-600">
                  {run.fieldLabels[f.id] ?? f.label}
                  {f.required && <span className="text-red-600"> *</span>}
                </span>
                <Input value={run.fields[f.id] ?? ''} onChange={(e) => setField(f.id, e.target.value)} className="h-11 text-base" />
              </label>
            ))}
          </div>
        )}
        {run.steps.map((st) =>
          st.kind === 'section' ? (
            <h2 key={st.id} className="px-1 pt-3 text-xs font-bold tracking-wider text-slate-500 uppercase">
              {st.title}
            </h2>
          ) : (
            <StepCard key={st.id} step={st} run={run} t={t} result={run.results[st.id] ?? EMPTY} onResult={(p, debounce) => setResult(st.id, p, debounce)} onPhoto={(f) => addPhoto(st.id, f)} />
          ),
        )}
      </div>
    </FloorShell>
  );
}

function StepCard({ step, run, t, result, onResult, onPhoto }: { step: ChecklistRunStep; run: ChecklistRun; t: PublicText; result: CheckItemResult; onResult: (p: Partial<CheckItemResult>, debounce?: boolean) => void; onPhoto: (f: File) => void }) {
  const [open, setOpen] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const hasDetails = !!step.bodyHtml || step.callout.type !== 'none' || step.mediaIds.length > 0;
  const options: { value: CheckResult; label: string; on: string; icon: typeof Check }[] =
    run.checklist.style === 'passfail'
      ? [
          { value: 'pass', label: t.pass, on: 'bg-emerald-600 text-white ring-emerald-600', icon: Check },
          { value: 'fail', label: t.fail, on: 'bg-red-600 text-white ring-red-600', icon: X },
          { value: 'na', label: t.na, on: 'bg-slate-600 text-white ring-slate-600', icon: Minus },
        ]
      : [
          { value: 'done', label: t.done, on: 'bg-emerald-600 text-white ring-emerald-600', icon: Check },
          { value: 'na', label: t.na, on: 'bg-slate-600 text-white ring-slate-600', icon: Minus },
        ];
  const failed = result.result === 'fail';
  const callout = step.callout.type !== 'none' ? CALLOUT_META[step.callout.type] : null;

  return (
    <div className={cx('rounded-xl bg-white shadow-sm ring-1', failed ? 'ring-2 ring-red-400' : result.result ? 'ring-emerald-300' : 'ring-slate-200')}>
      <button className="flex w-full items-start gap-3 px-4 pt-3 text-left" onClick={() => hasDetails && setOpen(!open)}>
        <span className={cx('flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-bold', result.result ? (failed ? 'bg-red-600 text-white' : 'bg-emerald-600 text-white') : 'bg-brand text-white')}>{step.number}</span>
        <span className="min-w-0 flex-1 pt-0.5 text-base leading-snug font-semibold">{step.title}</span>
        {hasDetails && <ChevronDown className={cx('mt-1 size-5 shrink-0 text-slate-400 transition', open && 'rotate-180')} />}
      </button>
      {/* Danger and warning callouts are always visible; other details open on tap. */}
      {callout && (open || step.callout.type === 'danger' || step.callout.type === 'warning') && (
        <div className="mx-4 mt-2 rounded-lg border-l-4 px-3 py-2 text-sm" style={{ borderColor: callout.color, background: callout.bg }}>
          <div className="text-[11px] font-extrabold tracking-wider" style={{ color: callout.color }}>
            {step.callout.label || callout.label}
          </div>
          <div className="[&_p]:m-0" dangerouslySetInnerHTML={{ __html: step.callout.html }} />
        </div>
      )}
      {open && (
        <div className="space-y-2 px-4 pt-2">
          {step.bodyHtml && <div className="text-sm leading-relaxed text-slate-700 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:mb-1.5 [&_ul]:list-disc [&_ul]:pl-5" dangerouslySetInnerHTML={{ __html: step.bodyHtml }} />}
          {step.mediaIds.map((m) => (
            <img key={m} src={`${run.mediaBase}/${m}/display`} alt="" className="w-full rounded-lg ring-1 ring-slate-200" loading="lazy" />
          ))}
        </div>
      )}
      <div className="flex gap-2 p-3">
        {options.map((o) => (
          <button
            key={o.value}
            onClick={() => onResult({ result: result.result === o.value ? null : o.value })}
            className={cx('flex h-12 flex-1 items-center justify-center gap-1.5 rounded-lg text-sm font-bold ring-1 transition', result.result === o.value ? o.on : 'bg-white text-slate-700 ring-slate-300 active:bg-slate-100')}
          >
            <o.icon className="size-4" /> {o.label}
          </button>
        ))}
        <button onClick={() => input.current?.click()} className="flex size-12 shrink-0 items-center justify-center rounded-lg text-slate-600 ring-1 ring-slate-300 active:bg-slate-100" aria-label={t.addPhoto} title={t.addPhoto}>
          <Camera className="size-5" />
        </button>
        <input
          ref={input}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => {
            if (e.target.files?.[0]) onPhoto(e.target.files[0]);
            e.target.value = '';
          }}
        />
      </div>
      {(failed || result.note) && (
        <div className="px-3 pb-3">
          <textarea
            value={result.note}
            onChange={(e) => onResult({ note: e.target.value }, true)}
            placeholder={failed ? t.noteRequired : t.note}
            rows={2}
            className={cx('block w-full rounded-lg border-0 px-3 py-2 text-base ring-1 ring-inset focus:ring-2', failed && !result.note.trim() ? 'bg-red-50 ring-red-300 focus:ring-red-500' : 'ring-slate-300 focus:ring-brand')}
          />
        </div>
      )}
      {result.mediaIds.length > 0 && (
        <div className="flex flex-wrap gap-2 px-3 pb-3">
          {result.mediaIds.map((m) => (
            <div key={m} className="relative">
              <img src={`${run.mediaBase}/${m}/thumb`} alt="" className="h-20 rounded-lg ring-1 ring-slate-200" />
              <button onClick={() => onResult({ mediaIds: result.mediaIds.filter((x) => x !== m) })} className="absolute -top-1.5 -right-1.5 rounded-full bg-slate-800 p-0.5 text-white" aria-label="Remove photo">
                <X className="size-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
