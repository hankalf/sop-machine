import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertOctagon, CalendarClock, CheckCircle2, CircleDot, ClipboardList, ExternalLink, Plus, Trash2, Wrench } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type { ActionStatus, CorrectiveAction } from '@shared/types';
import { api, mediaUrl } from '../api';
import { useAuth, useCan } from '../auth';
import { useToast } from '../components/Toast';
import { Badge, Button, cx, EmptyState, ErrorText, Field, Input, Modal, PageLoader, Select, Textarea, timeAgo } from '../components/ui';

const STATUS: Record<ActionStatus, { label: string; color: string }> = {
  open: { label: 'Open', color: '#2563eb' },
  in_progress: { label: 'In progress', color: '#d97706' },
  done: { label: 'Done', color: '#16a34a' },
  cancelled: { label: 'Cancelled', color: '#64748b' },
};

const FILTERS = [
  { id: 'open', label: 'Open' },
  { id: 'mine', label: 'Assigned to me' },
  { id: 'overdue', label: 'Overdue' },
  { id: 'closed', label: 'Closed' },
] as const;

const fmtDate = (d: string | null) => (d ? new Date(`${d}T12:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '—');

/** Problems found on the floor and what was done about them. */
export default function ActionsPage() {
  const [params, setParams] = useSearchParams();
  const filter = (params.get('filter') as (typeof FILTERS)[number]['id']) ?? 'open';
  const openId = params.get('id');
  const [creating, setCreating] = useState(false);
  const actions = useQuery({
    queryKey: ['actions', filter],
    queryFn: () => api.actions.list(filter === 'mine' ? { status: 'open', mine: '1' } : filter === 'overdue' ? { overdue: '1' } : { status: filter }),
  });
  const counts = useQuery({ queryKey: ['action-counts'], queryFn: api.actions.counts });

  const setOpen = (id: string | null) => {
    const next = new URLSearchParams(params);
    if (id) next.set('id', id);
    else next.delete('id');
    setParams(next, { replace: true });
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <Wrench className="size-6 text-brand" /> Corrective actions
          </h1>
          <p className="text-sm text-slate-500">Every failed checklist item becomes an action with an owner and a due date, so problems found on the floor get fixed and recorded.</p>
        </div>
        <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
          New action
        </Button>
      </div>

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => {
          const n = f.id === 'open' ? counts.data?.open : f.id === 'mine' ? counts.data?.mine : f.id === 'overdue' ? counts.data?.overdue : undefined;
          return (
            <button
              key={f.id}
              onClick={() => setParams({ filter: f.id })}
              className={cx('inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-sm font-medium ring-1', filter === f.id ? 'bg-slate-900 text-white ring-slate-900' : 'bg-white text-slate-700 ring-slate-200 hover:ring-slate-400')}
            >
              {f.label}
              {!!n && <span className={cx('rounded-full px-1.5 text-[11px]', f.id === 'overdue' ? 'bg-red-500 text-white' : filter === f.id ? 'bg-white/20' : 'bg-slate-100 text-slate-600')}>{n}</span>}
            </button>
          );
        })}
      </div>

      {actions.isLoading ? (
        <PageLoader />
      ) : actions.error ? (
        <ErrorText error={actions.error} />
      ) : !actions.data?.length ? (
        <EmptyState icon={<CheckCircle2 className="size-10" />} title={filter === 'closed' ? 'Nothing closed yet' : 'Nothing to fix'}>
          {filter === 'open' ? 'Failed checklist items show up here automatically. You can also add an action by hand.' : 'No actions match this filter.'}
        </EmptyState>
      ) : (
        <ul className="space-y-2">
          {actions.data.map((a) => (
            <li key={a.id}>
              <button onClick={() => setOpen(a.id)} className="flex w-full items-start gap-3 rounded-xl bg-white p-4 text-left shadow-sm ring-1 ring-slate-200 transition hover:ring-brand/40">
                {a.priority === 'high' && a.status !== 'done' ? <AlertOctagon className="mt-0.5 size-5 shrink-0 text-red-600" /> : <CircleDot className="mt-0.5 size-5 shrink-0" style={{ color: STATUS[a.status].color }} />}
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-slate-900">{a.title}</div>
                  {a.detail && <p className="mt-0.5 line-clamp-2 text-sm text-slate-600">{a.detail}</p>}
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                    <Badge color={STATUS[a.status].color}>{STATUS[a.status].label}</Badge>
                    {a.sopNumber && <span className="font-mono">{a.sopNumber}</span>}
                    <span>Reported by {a.reportedBy || '—'} · {timeAgo(a.createdAt)}</span>
                    {a.mediaIds.length > 0 && <span>{a.mediaIds.length} photo{a.mediaIds.length === 1 ? '' : 's'}</span>}
                  </div>
                </div>
                <div className="shrink-0 text-right text-xs">
                  <div className="font-medium text-slate-700">{a.assigneeName ?? <span className="text-amber-700">Unassigned</span>}</div>
                  {a.status !== 'done' && a.status !== 'cancelled' && (
                    <div className={cx('mt-0.5 inline-flex items-center gap-1', a.overdue ? 'font-semibold text-red-600' : 'text-slate-500')}>
                      <CalendarClock className="size-3.5" /> {a.overdue ? 'Overdue · ' : 'Due '}
                      {fmtDate(a.dueDate)}
                    </div>
                  )}
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
      {openId && <ActionModal id={openId} onClose={() => setOpen(null)} />}
      {creating && <NewActionModal onClose={() => setCreating(false)} onCreated={(id) => setOpen(id)} />}
    </div>
  );
}

function useDirectory() {
  return useQuery({ queryKey: ['directory'], queryFn: api.directory });
}

function ActionModal({ id, onClose }: { id: string; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const isAdmin = useCan('admin');
  const { user } = useAuth();
  const action = useQuery({ queryKey: ['action', id], queryFn: () => api.actions.get(id) });
  const directory = useDirectory();
  const [draft, setDraft] = useState<CorrectiveAction | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (action.data) setDraft(action.data);
  }, [action.data]);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['actions'] });
    void qc.invalidateQueries({ queryKey: ['action-counts'] });
    void qc.invalidateQueries({ queryKey: ['action', id] });
  };
  const save = async (patch: Partial<CorrectiveAction>, message: string) => {
    if (!draft) return;
    setBusy(true);
    try {
      await api.actions.update(id, { assigneeId: draft.assigneeId, dueDate: draft.dueDate, priority: draft.priority, resolution: draft.resolution, ...patch });
      refresh();
      toast.success(message);
      if (patch.status === 'done' || patch.status === 'cancelled') onClose();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };

  const a = draft;
  const closed = a?.status === 'done' || a?.status === 'cancelled';
  return (
    <Modal
      open
      onClose={onClose}
      width="max-w-2xl"
      title={a ? a.title : 'Corrective action'}
      footer={
        a && (
          <>
            {isAdmin && (
              <Button variant="ghost" className="mr-auto text-red-600 hover:bg-red-50" icon={<Trash2 className="size-4" />} onClick={() => confirm('Delete this action and its history?') && api.actions.remove(id).then(() => (refresh(), onClose()))}>
                Delete
              </Button>
            )}
            {closed ? (
              <Button onClick={() => save({ status: 'open' }, 'Reopened')} loading={busy}>
                Reopen
              </Button>
            ) : (
              <>
                <Button onClick={() => save({ status: 'cancelled' }, 'Cancelled')} loading={busy}>
                  Not needed
                </Button>
                <Button onClick={() => (a.status === 'open' ? save({ status: 'in_progress' }, 'Marked in progress') : save({}, 'Saved'))} loading={busy}>
                  {a.status === 'open' ? 'Start work' : 'Save'}
                </Button>
                <Button variant="primary" icon={<CheckCircle2 className="size-4" />} onClick={() => save({ status: 'done' }, 'Marked as fixed')} loading={busy}>
                  Mark fixed
                </Button>
              </>
            )}
          </>
        )
      }
    >
      {!a ? (
        <PageLoader />
      ) : (
        <div className="space-y-4 text-sm">
          <div className="flex flex-wrap gap-2">
            <Badge color={STATUS[a.status].color}>{STATUS[a.status].label}</Badge>
            {a.priority === 'high' && <Badge color="#dc2626">High priority</Badge>}
            {a.overdue && <Badge color="#dc2626">Overdue</Badge>}
          </div>
          {a.detail && <p className="rounded-lg bg-red-50 px-3 py-2 whitespace-pre-wrap text-red-900">{a.detail}</p>}
          {a.mediaIds.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {a.mediaIds.map((m) => (
                <a key={m} href={mediaUrl(m, 'display')} target="_blank" rel="noreferrer">
                  <img src={mediaUrl(m, 'thumb')} alt="" className="h-24 rounded-lg ring-1 ring-slate-200" />
                </a>
              ))}
            </div>
          )}
          <dl className="grid grid-cols-2 gap-3 rounded-lg bg-slate-50 p-3">
            <div>
              <dt className="text-xs text-slate-500">Reported by</dt>
              <dd className="font-medium">{a.reportedBy || '—'} · {new Date(a.createdAt).toLocaleString()}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Where</dt>
              <dd className="font-medium">{a.stationName ?? '—'}</dd>
            </div>
            {a.sopId && (
              <div className="col-span-2">
                <dt className="text-xs text-slate-500">SOP</dt>
                <dd>
                  <Link to={`/sops/${a.sopId}`} className="inline-flex items-center gap-1 font-medium text-brand hover:underline">
                    {a.sopNumber} {a.sopTitle} <ExternalLink className="size-3" />
                  </Link>
                  {a.runId && (
                    <Link to={`/records?sopId=${a.sopId}`} className="ml-3 inline-flex items-center gap-1 text-xs text-slate-500 hover:text-brand">
                      <ClipboardList className="size-3" /> Checklist record
                    </Link>
                  )}
                </dd>
              </div>
            )}
          </dl>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Assigned to">
              <Select value={a.assigneeId ?? ''} onChange={(e) => setDraft({ ...a, assigneeId: e.target.value || null })} disabled={closed}>
                <option value="">Unassigned</option>
                {directory.data?.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                    {u.id === user?.id ? ' (me)' : ''}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Due">
              <Input type="date" value={a.dueDate ?? ''} onChange={(e) => setDraft({ ...a, dueDate: e.target.value || null })} disabled={closed} />
            </Field>
            <Field label="Priority">
              <Select value={a.priority} onChange={(e) => setDraft({ ...a, priority: e.target.value as CorrectiveAction['priority'] })} disabled={closed}>
                <option value="normal">Normal</option>
                <option value="high">High</option>
              </Select>
            </Field>
          </div>
          <Field label="What was done to fix it" hint={closed ? undefined : 'Required to mark it fixed.'}>
            <Textarea value={a.resolution} onChange={(e) => setDraft({ ...a, resolution: e.target.value })} placeholder="e.g. Maintenance replaced the dock lock sensor and tested it" disabled={closed} />
          </Field>
          {a.resolvedAt && (
            <p className="text-xs text-slate-500">
              {STATUS[a.status].label} by {a.resolvedByName ?? '—'} on {new Date(a.resolvedAt).toLocaleString()}
            </p>
          )}
        </div>
      )}
    </Modal>
  );
}

function NewActionModal({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const qc = useQueryClient();
  const directory = useDirectory();
  const sops = useQuery({ queryKey: ['sops', 'all'], queryFn: () => api.sops.list({}) });
  const stations = useQuery({ queryKey: ['stations'], queryFn: api.stations.list });
  const [form, setForm] = useState({ title: '', detail: '', priority: 'normal' as CorrectiveAction['priority'], sopId: '', stationId: '', assigneeId: '', dueDate: '' });
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const create = async () => {
    setBusy(true);
    try {
      const a = await api.actions.create({
        title: form.title,
        detail: form.detail,
        priority: form.priority,
        sopId: form.sopId || null,
        stationId: form.stationId || null,
        assigneeId: form.assigneeId || null,
        dueDate: form.dueDate || null,
      });
      void qc.invalidateQueries({ queryKey: ['actions'] });
      void qc.invalidateQueries({ queryKey: ['action-counts'] });
      onClose();
      onCreated(a.id);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      title="New corrective action"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={create} loading={busy} disabled={!form.title.trim()}>
            Create action
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="What needs fixing">
          <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Dock plate at door 7 sticks" autoFocus />
        </Field>
        <Field label="Details">
          <Textarea value={form.detail} onChange={(e) => setForm({ ...form, detail: e.target.value })} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Related SOP">
            <Select value={form.sopId} onChange={(e) => setForm({ ...form, sopId: e.target.value })}>
              <option value="">None</option>
              {sops.data?.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.number} · {s.title}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Station">
            <Select value={form.stationId} onChange={(e) => setForm({ ...form, stationId: e.target.value })}>
              <option value="">None</option>
              {stations.data?.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Assign to">
            <Select value={form.assigneeId} onChange={(e) => setForm({ ...form, assigneeId: e.target.value })}>
              <option value="">Unassigned</option>
              {directory.data?.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Due (optional)" hint="Defaults to the site setting.">
            <Input type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} />
          </Field>
          <Field label="Priority">
            <Select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value as CorrectiveAction['priority'] })}>
              <option value="normal">Normal</option>
              <option value="high">High (safety)</option>
            </Select>
          </Field>
        </div>
        <ErrorText error={error} />
      </div>
    </Modal>
  );
}
