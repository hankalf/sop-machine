import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Download, FileDown, ListChecks, Loader2, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { CheckResult } from '@shared/types';
import { api, downloadFile, mediaUrl } from '../api';
import { useCan } from '../auth';
import { useToast } from '../components/Toast';
import { Badge, Button, cx, EmptyState, IconButton, Modal, PageLoader, Select, Spinner } from '../components/ui';

const RESULT: Record<CheckResult, { label: string; cls: string }> = {
  pass: { label: 'PASS', cls: 'bg-emerald-100 text-emerald-800' },
  done: { label: 'DONE', cls: 'bg-emerald-100 text-emerald-800' },
  fail: { label: 'FAIL', cls: 'bg-red-100 text-red-800' },
  na: { label: 'N/A', cls: 'bg-slate-200 text-slate-700' },
};

/** Completed (and in-progress) checklists. */
export default function RecordsPage() {
  const [params, setParams] = useSearchParams();
  const sopId = params.get('sopId') ?? '';
  const [failed, setFailed] = useState(false);
  const [status, setStatus] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const isAdmin = useCan('admin');
  const toast = useToast();
  const qc = useQueryClient();
  const sops = useQuery({ queryKey: ['sops', 'all'], queryFn: () => api.sops.list({}) });
  const runs = useQuery({ queryKey: ['runs', sopId, failed, status], queryFn: () => api.runs.list({ sopId, status, failed: failed ? '1' : '' }) });
  const query = new URLSearchParams({ ...(sopId ? { sopId } : {}), ...(status ? { status } : {}), ...(failed ? { failed: '1' } : {}) }).toString();

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <ListChecks className="size-6 text-brand" /> Checklist records
          </h1>
          <p className="text-sm text-slate-500">Every checklist run from an SOP: who did it, when, what failed, with photos.</p>
        </div>
        <Button icon={<Download className="size-4" />} onClick={() => downloadFile(`/api/runs.csv${query ? `?${query}` : ''}`).catch(toast.error)}>
          Export CSV
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Select value={sopId} onChange={(e) => setParams(e.target.value ? { sopId: e.target.value } : {})} className="w-72">
          <option value="">All checklists</option>
          {sops.data
            ?.filter((s) => s.id === sopId || s.stepCount > 0)
            .map((s) => (
              <option key={s.id} value={s.id}>
                {s.number} · {s.title}
              </option>
            ))}
        </Select>
        <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-40">
          <option value="">Any status</option>
          <option value="completed">Completed</option>
          <option value="in_progress">In progress</option>
        </Select>
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" checked={failed} onChange={(e) => setFailed(e.target.checked)} className="size-4 accent-[var(--brand)]" />
          Only with failed items
        </label>
      </div>

      {runs.isLoading ? (
        <PageLoader />
      ) : !runs.data?.length ? (
        <EmptyState icon={<ListChecks className="size-10" />} title="No checklist records">
          Turn on <strong>Checklist mode</strong> in an SOP's editor, approve it, then start it from the SOP page or by scanning a station QR code.
        </EmptyState>
      ) : (
        <div className="overflow-x-auto rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs font-semibold text-slate-500">
              <tr>
                <th className="px-4 py-2.5">When</th>
                <th className="px-4 py-2.5">Checklist</th>
                <th className="px-4 py-2.5">By</th>
                <th className="hidden px-4 py-2.5 lg:table-cell">Details</th>
                <th className="px-4 py-2.5">Result</th>
                <th className="w-20" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {runs.data.map((r) => (
                <tr key={r.id} className="cursor-pointer hover:bg-slate-50" onClick={() => setOpen(r.id)}>
                  <td className="px-4 py-2.5 whitespace-nowrap text-slate-600">{new Date(r.startedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</td>
                  <td className="px-4 py-2.5">
                    <div className="font-medium">{r.sopTitle}</div>
                    <div className="font-mono text-[11px] text-slate-500">
                      {r.sopNumber} · Rev {r.version}
                      {r.stationName && ` · ${r.stationName}`}
                    </div>
                  </td>
                  <td className="px-4 py-2.5">
                    {r.performerName}
                    {r.employeeId && <span className="text-slate-400"> · {r.employeeId}</span>}
                  </td>
                  <td className="hidden px-4 py-2.5 text-xs text-slate-600 lg:table-cell">
                    {r.fieldValues
                      .filter((f) => f.value)
                      .map((f) => `${f.label}: ${f.value}`)
                      .join(' · ')}
                  </td>
                  <td className="px-4 py-2.5">
                    {r.status === 'in_progress' ? (
                      <Badge><Loader2 className="size-3" /> In progress</Badge>
                    ) : r.failCount ? (
                      <Badge color="#dc2626"><AlertTriangle className="size-3" /> {r.failCount} failed</Badge>
                    ) : (
                      <Badge color="#16a34a"><CheckCircle2 className="size-3" /> Passed</Badge>
                    )}
                  </td>
                  <td className="pr-2 text-right" onClick={(e) => e.stopPropagation()}>
                    <IconButton label="Download PDF record" onClick={() => downloadFile(`/api/runs/${r.id}/pdf`).catch(toast.error)}>
                      <FileDown className="size-4" />
                    </IconButton>
                    {isAdmin && (
                      <IconButton label="Delete record" className="hover:bg-red-50 hover:text-red-600" onClick={() => confirm('Delete this checklist record permanently?') && api.runs.remove(r.id).then(() => qc.invalidateQueries({ queryKey: ['runs'] }))}>
                        <Trash2 className="size-4" />
                      </IconButton>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {open && <RunDetail id={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

function RunDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const run = useQuery({ queryKey: ['run', id], queryFn: () => api.runs.get(id) });
  const toast = useToast();
  const r = run.data;
  return (
    <Modal
      open
      onClose={onClose}
      width="max-w-3xl"
      title={r ? `${r.sopNumber} · ${r.sopTitle}` : 'Checklist record'}
      footer={
        <Button variant="primary" icon={<FileDown className="size-4" />} onClick={() => downloadFile(`/api/runs/${id}/pdf`).catch(toast.error)}>
          Download PDF
        </Button>
      }
    >
      {!r ? (
        <div className="flex justify-center py-10"><Spinner /></div>
      ) : (
        <div className="space-y-4 text-sm">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Info label="Performed by" value={`${r.performerName}${r.employeeId ? ` (${r.employeeId})` : ''}`} />
            <Info label="Started" value={new Date(r.startedAt).toLocaleString()} />
            <Info label="Completed" value={r.completedAt ? new Date(r.completedAt).toLocaleString() : 'In progress'} />
            {r.stationName && <Info label="Station" value={r.stationName} />}
            {r.fieldValues.map((f) => (
              <Info key={f.label} label={f.label} value={f.value || '—'} />
            ))}
            <Info label="Signed" value={r.signature || '—'} />
          </div>
          <ul className="divide-y divide-slate-100 rounded-lg ring-1 ring-slate-200">
            {r.steps.map((st) => {
              if (st.kind === 'section') return <li key={st.id} className="bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-600">{st.title}</li>;
              const res = r.results[st.id];
              return (
                <li key={st.id} className="px-3 py-2.5">
                  <div className="flex items-start gap-3">
                    <span className="w-5 text-xs font-bold text-slate-400">{st.number}</span>
                    <span className="min-w-0 flex-1 font-medium">{st.title}</span>
                    {res?.result ? <span className={cx('rounded px-1.5 py-0.5 text-[10px] font-bold', RESULT[res.result].cls)}>{RESULT[res.result].label}</span> : <span className="text-xs text-slate-400">—</span>}
                  </div>
                  {res?.note && <p className="mt-1 ml-8 text-red-700">{res.note}</p>}
                  {!!res?.mediaIds.length && (
                    <div className="mt-2 ml-8 flex flex-wrap gap-2">
                      {res.mediaIds.map((m) => (
                        <a key={m} href={mediaUrl(m, 'display')} target="_blank" rel="noreferrer">
                          <img src={mediaUrl(m, 'thumb')} alt="" className="h-20 rounded ring-1 ring-slate-200" />
                        </a>
                      ))}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </Modal>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-slate-50 px-3 py-2">
      <div className="text-[10px] font-semibold tracking-wide text-slate-500 uppercase">{label}</div>
      <div className="font-medium">{value}</div>
    </div>
  );
}
