import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Archive,
  ArrowLeft,
  CheckCircle2,
  Copy,
  Download,
  FileText,
  History,
  Monitor,
  Pencil,
  Printer,
  RotateCcw,
  Send,
  Trash2,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import type { Sop, SopStatus } from '@shared/types';
import { api, downloadFile, EN, type LangChoice } from '../api';
import { FloorCard } from '../components/sop/FloorCard';
import { SignOffCard } from '../components/sop/SignOffCard';
import { TranslationsCard } from '../components/sop/TranslationsCard';
import { useAuth, useCan } from '../auth';
import { LivePreview } from '../components/LivePreview';
import { StatusBadge } from '../components/status';
import { useToast } from '../components/Toast';
import { Badge, Button, Card, ErrorText, Field, Input, Modal, PageLoader, Segmented, Select, Textarea, timeAgo } from '../components/ui';

export default function SopViewPage() {
  const { id = '' } = useParams();
  const [params] = useSearchParams();
  const { user } = useAuth();
  const isEditor = useCan('editor');
  const isAdmin = useCan('admin');
  const toast = useToast();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [mode, setMode] = useState<'web' | 'paged'>('web');
  const [exporting, setExporting] = useState<'pdf' | 'docx' | null>(null);
  const [approveOpen, setApproveOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [lang, setLang] = useState<LangChoice>(EN);
  const [langTouched, setLangTouched] = useState(false);
  const [refresh, setRefresh] = useState(0);

  const sop = useQuery({ queryKey: ['sop', id], queryFn: () => api.sops.get(id) });
  const revisions = useQuery({ queryKey: ['revisions', id], queryFn: () => api.sops.revisions(id) });
  const settings = useQuery({ queryKey: ['settings'], queryFn: api.settings.get });
  const categories = useQuery({ queryKey: ['categories'], queryFn: api.categories.list });
  const languages = useQuery({ queryKey: ['sop-languages', id, sop.data?.updatedAt], queryFn: () => api.sops.languages(id), enabled: !!sop.data });

  // Open in the reader's own language when a translation exists.
  useEffect(() => {
    if (langTouched || !user || user.language === 'en') return;
    if (languages.data?.some((l) => l.code === user.language)) setLang({ code: user.language, bilingual: false });
  }, [languages.data, user, langTouched]);

  const mediaTarget = params.get('media');
  const [scrollTarget, setScrollTarget] = useState<string | null>(null);
  useEffect(() => {
    if (mediaTarget && sop.data) setTimeout(() => setScrollTarget(`media-${mediaTarget}`), 1500);
  }, [mediaTarget, sop.data]);

  if (sop.isLoading) return <PageLoader />;
  if (sop.error || !sop.data) return <ErrorText error={sop.error ?? 'Not found'} />;
  const s = sop.data;
  const category = categories.data?.find((c) => c.id === s.categoryId);
  const defaultFormat = settings.data?.export.defaultFormat ?? 'pdf';
  const canExport = user?.role !== 'viewer' || settings.data?.export.allowViewerExport !== false;
  const needsAdmin = settings.data?.workflow.requireApproval !== false;
  const canApprove = isAdmin || (isEditor && !needsAdmin);

  const exportAs = async (format: 'pdf' | 'docx') => {
    setExporting(format);
    try {
      await downloadFile(api.sops.exportUrl(id, format, lang));
    } catch (e) {
      toast.error(e);
    } finally {
      setExporting(null);
    }
  };

  const setStatus = async (status: SopStatus, extra: { summary?: string; version?: string } = {}) => {
    setBusy(true);
    try {
      const updated = await api.sops.setStatus(id, { status, ...extra });
      qc.setQueryData(['sop', id], updated);
      void qc.invalidateQueries({ queryKey: ['revisions', id] });
      void qc.invalidateQueries({ queryKey: ['sops'] });
      toast.success(status === 'approved' ? `Approved revision ${updated.version}` : status === 'review' ? 'Submitted for review' : status === 'archived' ? 'Archived' : 'Moved back to draft');
      setApproveOpen(false);
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };

  const duplicate = async () => {
    try {
      const copy = await api.sops.duplicate(id);
      toast.success(`Created ${copy.number}`);
      navigate(`/sops/${copy.id}/edit`);
    } catch (e) {
      toast.error(e);
    }
  };

  const remove = async () => {
    if (!confirm(`Delete ${s.number} "${s.title}" permanently? This also deletes its revision history.`)) return;
    try {
      await api.sops.remove(id);
      void qc.invalidateQueries({ queryKey: ['sops'] });
      toast.success('SOP deleted');
      navigate('/');
    } catch (e) {
      toast.error(e);
    }
  };

  const formats: ('pdf' | 'docx')[] = defaultFormat === 'pdf' ? ['pdf', 'docx'] : ['docx', 'pdf'];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <Link to="/" className="mb-2 inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-900">
            <ArrowLeft className="size-3.5" /> Library
          </Link>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs text-slate-500">{s.number}</span>
            <StatusBadge status={s.status} />
            {category && <Badge color={category.color}>{category.name}</Badge>}
            <span className="text-xs text-slate-500">Rev {s.version}</span>
          </div>
          <h1 className="mt-1 text-2xl font-bold tracking-tight">{s.title}</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          {canExport &&
            formats.map((f, i) => (
              <Button
                key={f}
                variant={i === 0 ? 'primary' : 'secondary'}
                icon={f === 'pdf' ? <Download className="size-4" /> : <FileText className="size-4" />}
                loading={exporting === f}
                onClick={() => exportAs(f)}
              >
                {f === 'pdf' ? 'Export PDF' : 'Export Word'}
                {lang.code !== 'en' && <span className="rounded bg-black/10 px-1 text-[10px] uppercase">{lang.bilingual ? `en+${lang.code}` : lang.code}</span>}
              </Button>
            ))}
          {isEditor && s.status !== 'archived' && (
            <Link to={`/sops/${id}/edit`}>
              <Button icon={<Pencil className="size-4" />}>Edit</Button>
            </Link>
          )}
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="overflow-hidden rounded-xl shadow-sm ring-1 ring-slate-200">
          <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-white px-3 py-2">
            <div className="w-64 shrink-0">
              <Segmented
                size="sm"
                value={mode}
                onChange={setMode}
                options={[
                  { value: 'web', label: <><Monitor className="size-3.5" /> Digital</> },
                  { value: 'paged', label: <><Printer className="size-3.5" /> Print layout</> },
                ]}
              />
            </div>
            {languages.data?.length ? (
              <Select
                aria-label="Language"
                className="h-8 w-52 text-xs"
                value={`${lang.code}${lang.bilingual ? '+' : ''}`}
                onChange={(e) => {
                  setLangTouched(true);
                  const v = e.target.value;
                  setLang({ code: v.replace('+', ''), bilingual: v.endsWith('+') });
                }}
              >
                <option value="en">English</option>
                {languages.data.map((l) => (
                  <option key={l.code} value={l.code}>
                    {l.native}
                  </option>
                ))}
                {languages.data.map((l) => (
                  <option key={`${l.code}+`} value={`${l.code}+`}>
                    English + {l.native} (bilingual)
                  </option>
                ))}
              </Select>
            ) : (
              <span className="hidden text-xs text-slate-500 sm:block">{mode === 'web' ? 'Videos play here. Works on phones and tablets.' : 'Exactly what the PDF will look like.'}</span>
            )}
          </div>
          <LivePreview src={api.sops.renderUrl(id, mode, `${s.updatedAt}-${refresh}`, lang)} paged={mode === 'paged'} className="h-[calc(100vh-220px)] min-h-[520px]" scrollTarget={scrollTarget} />
        </div>

        <div className="space-y-4">
          {settings.data?.training.enabled !== false && <SignOffCard sop={s} />}
          <FloorCard sop={s} language={lang.code} />
          {isEditor && (
            <Card title="Workflow" bodyClassName="space-y-2">
              {s.status === 'draft' && (
                <Button className="w-full" icon={<Send className="size-4" />} onClick={() => setStatus('review')} loading={busy}>
                  Submit for review
                </Button>
              )}
              {(s.status === 'draft' || s.status === 'review') && canApprove && (
                <Button variant="primary" className="w-full" icon={<CheckCircle2 className="size-4" />} onClick={() => setApproveOpen(true)}>
                  Approve and publish
                </Button>
              )}
              {s.status === 'review' && !canApprove && <p className="text-xs text-slate-500">Waiting for an administrator to approve.</p>}
              {(s.status === 'review' || s.status === 'archived') && (
                <Button className="w-full" icon={<RotateCcw className="size-4" />} onClick={() => setStatus('draft')} loading={busy}>
                  Back to draft
                </Button>
              )}
              {s.status === 'approved' && <p className="text-xs text-slate-500">Editing an approved SOP starts revision {nextMinor(s.version)}. The approved version stays published until the new one is approved.</p>}
              <div className="flex gap-2 pt-1">
                <Button size="sm" className="flex-1" icon={<Copy className="size-3.5" />} onClick={duplicate}>
                  Duplicate
                </Button>
                {s.status !== 'archived' && isAdmin && (
                  <Button size="sm" className="flex-1" icon={<Archive className="size-3.5" />} onClick={() => confirm('Archive this SOP? It will be marked obsolete.') && setStatus('archived')}>
                    Archive
                  </Button>
                )}
              </div>
              {isAdmin && (
                <Button size="sm" variant="ghost" className="w-full text-red-600 hover:bg-red-50 hover:text-red-700" icon={<Trash2 className="size-3.5" />} onClick={remove}>
                  Delete
                </Button>
              )}
            </Card>
          )}

          {isEditor && <TranslationsCard sop={s} onChanged={() => setRefresh((n) => n + 1)} />}

          <Card title="Details" bodyClassName="text-sm">
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
              <Detail label="Owner" value={s.owner} />
              <Detail label="Approver" value={s.approver} />
              <Detail label="Effective" value={s.effectiveDate ? new Date(`${s.effectiveDate}T12:00`).toLocaleDateString() : '—'} />
              <Detail label="Next review" value={s.reviewDate ? new Date(`${s.reviewDate}T12:00`).toLocaleDateString() : '—'} />
              <Detail label="Published" value={s.publishedVersion ? `Rev ${s.publishedVersion}` : 'Not yet'} />
              <Detail label="Updated" value={timeAgo(s.updatedAt)} />
            </dl>
            {s.tags.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {s.tags.map((t) => (
                  <Badge key={t}>#{t}</Badge>
                ))}
              </div>
            )}
          </Card>

          <Card title={<span className="flex items-center gap-1.5"><History className="size-4" /> Revision history</span>} bodyClassName="p-0">
            {!revisions.data?.length ? (
              <p className="px-5 py-4 text-sm text-slate-500">No approved revisions yet.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {revisions.data.map((r) => (
                  <li key={r.id} className="px-5 py-3 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold">Rev {r.version}</span>
                      <span className="text-xs text-slate-500">{new Date(r.createdAt).toLocaleDateString()}</span>
                    </div>
                    <p className="text-slate-600">{r.summary}</p>
                    <div className="mt-1 flex items-center justify-between text-xs text-slate-500">
                      <span>{r.createdByName}</span>
                      {isEditor && (
                        <button className="font-medium text-brand hover:underline" onClick={() => downloadFile(`/api/sops/${id}/revisions/${r.id}/export?format=pdf`).catch(toast.error)}>
                          PDF of this version
                        </button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>

      <ApproveModal open={approveOpen} onClose={() => setApproveOpen(false)} sop={s} busy={busy} onApprove={(version, summary) => setStatus('approved', { version, summary })} />
    </div>
  );
}

function nextMinor(v: string) {
  const m = /^(\d+)\.(\d+)$/.exec(v);
  return m ? `${m[1]}.${Number(m[2]) + 1}` : `${v}+`;
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-slate-500">{label}</dt>
      <dd className="truncate font-medium text-slate-800">{value || '—'}</dd>
    </>
  );
}

function ApproveModal({ open, onClose, sop, busy, onApprove }: { open: boolean; onClose: () => void; sop: Sop; busy: boolean; onApprove: (version: string, summary: string) => void }) {
  const [version, setVersion] = useState(sop.version);
  const [summary, setSummary] = useState(sop.publishedVersion ? '' : 'Initial release');
  useEffect(() => {
    if (open) {
      setVersion(sop.version);
      setSummary(sop.publishedVersion ? '' : 'Initial release');
    }
  }, [open, sop.version, sop.publishedVersion]);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Approve and publish"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} onClick={() => onApprove(version, summary)} disabled={!summary.trim()}>
            Approve revision {version}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-slate-600">Approving publishes this version to everyone, sets today as the effective date and schedules the next review.</p>
        <Field label="Revision number" hint="Use a whole number (2.0) for major changes.">
          <Input value={version} onChange={(e) => setVersion(e.target.value)} />
        </Field>
        <Field label="What changed?" hint="Shown in the revision history table.">
          <Textarea value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="e.g. Added dock lock verification step" />
        </Field>
      </div>
    </Modal>
  );
}
