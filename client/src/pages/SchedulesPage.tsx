import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CalendarCheck, CheckCircle2, Clock, Globe, MapPin, Pencil, Plus, Trash2, XCircle } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { Occurrence, OccurrenceStatus, Schedule, ScheduleFrequency } from '@shared/types';
import { WEEKDAYS } from '@shared/defaults';
import { api } from '../api';
import { useCan } from '../auth';
import { useToast } from '../components/Toast';
import { Badge, Button, cx, EmptyState, ErrorText, Field, IconButton, Modal, PageLoader, Segmented, Select, Toggle } from '../components/ui';

const STATUS: Record<OccurrenceStatus, { label: string; color: string; icon: typeof Clock }> = {
  due: { label: 'Due now', color: '#d97706', icon: Clock },
  done: { label: 'Done', color: '#16a34a', icon: CheckCircle2 },
  failed: { label: 'Done, with failures', color: '#dc2626', icon: AlertTriangle },
  missed: { label: 'Missed', color: '#dc2626', icon: XCircle },
  upcoming: { label: 'Upcoming', color: '#64748b', icon: Clock },
};

type Draft = Omit<Schedule, 'id' | 'sopNumber' | 'sopTitle' | 'createdAt'> & { id?: string };

/** Checklists that must be done every shift, day, week or month, and whether they were. */
export default function SchedulesPage() {
  const isAdmin = useCan('admin');
  const qc = useQueryClient();
  const toast = useToast();
  const [days, setDays] = useState(7);
  const [onlyMissed, setOnlyMissed] = useState(false);
  const [editing, setEditing] = useState<Draft | null>(null);
  const board = useQuery({ queryKey: ['schedule-board', days], queryFn: () => api.schedules.board(days), refetchInterval: 60_000 });
  const schedules = useQuery({ queryKey: ['schedules'], queryFn: api.schedules.list });
  const stations = useQuery({ queryKey: ['stations'], queryFn: api.stations.list });
  const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone;

  const setTz = async () => {
    try {
      const s = await api.settings.get();
      await api.settings.update({ schedule: { ...s.schedule, timezone: browserTz } });
      void qc.invalidateQueries({ queryKey: ['schedule-board'] });
      void qc.invalidateQueries({ queryKey: ['settings'] });
      toast.success(`Site time zone set to ${browserTz}`);
    } catch (e) {
      toast.error(e);
    }
  };

  if (board.isLoading) return <PageLoader />;
  const b = board.data;
  const history = (b?.history ?? []).filter((o) => !onlyMissed || o.status === 'missed');

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <CalendarCheck className="size-6 text-brand" /> Scheduled checklists
          </h1>
          <p className="text-sm text-slate-500">Checklists that must be done every shift, day, week or month at each station. Missed ones are emailed to the station's supervisor.</p>
        </div>
        {isAdmin && (
          <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setEditing({ sopId: '', stationIds: [], frequency: 'shift', days: [1, 2, 3, 4, 5], shiftIds: [], active: true })}>
            New schedule
          </Button>
        )}
      </div>

      {b && !b.timezoneSet && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900 ring-1 ring-amber-200">
          <Globe className="size-5 shrink-0" />
          <span className="flex-1">Shifts are being worked out in UTC because the site time zone isn't set yet.</span>
          {isAdmin && (
            <Button size="sm" onClick={setTz}>
              Use {browserTz}
            </Button>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Due right now" value={b?.stats.dueNow ?? 0} tone={b?.stats.dueNow ? 'text-amber-700' : undefined} />
        <Stat label={`Done (${days} days)`} value={(b?.stats.done ?? 0) + (b?.stats.failed ?? 0)} />
        <Stat label={`Missed (${days} days)`} value={b?.stats.missed ?? 0} tone={b?.stats.missed ? 'text-red-700' : undefined} />
        <Stat label="On time" value={b?.stats.compliancePct === null || !b ? '—' : `${b.stats.compliancePct}%`} tone="text-emerald-700" />
      </div>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-slate-700">Right now {b && <span className="font-normal text-slate-500">· times in {b.timezone}</span>}</h2>
        {!b?.now.length ? (
          <p className="rounded-xl bg-white px-4 py-6 text-center text-sm text-slate-500 ring-1 ring-slate-200">Nothing is scheduled for the current shift.</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {b.now.map((o) => (
              <OccurrenceCard key={`${o.scheduleId}-${o.stationId}-${o.start}`} o={o} />
            ))}
          </div>
        )}
      </section>

      <section className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-700">History</h2>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-sm text-slate-600">
              <input type="checkbox" checked={onlyMissed} onChange={(e) => setOnlyMissed(e.target.checked)} className="size-4 accent-[var(--brand)]" /> Only missed
            </label>
            <div className="w-56">
              <Segmented size="sm" value={String(days)} onChange={(v) => setDays(Number(v))} options={[{ value: '7', label: '7 days' }, { value: '30', label: '30 days' }, { value: '90', label: '90 days' }]} />
            </div>
          </div>
        </div>
        {!history.length ? (
          <p className="rounded-xl bg-white px-4 py-6 text-center text-sm text-slate-500 ring-1 ring-slate-200">{onlyMissed ? 'Nothing was missed. ' : ''}No finished periods in this range yet.</p>
        ) : (
          <div className="overflow-x-auto rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs font-semibold text-slate-500">
                <tr>
                  <th className="px-4 py-2.5">When</th>
                  <th className="px-4 py-2.5">Checklist</th>
                  <th className="px-4 py-2.5">Station</th>
                  <th className="px-4 py-2.5">Result</th>
                  <th className="hidden px-4 py-2.5 md:table-cell">By</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {history.map((o) => (
                  <tr key={`${o.scheduleId}-${o.stationId}-${o.start}`} className={o.status === 'missed' ? 'bg-red-50/50' : undefined}>
                    <td className="px-4 py-2 whitespace-nowrap text-slate-600">{o.label}</td>
                    <td className="px-4 py-2">
                      <span className="font-mono text-[11px] text-slate-500">{o.sopNumber}</span> {o.sopTitle}
                    </td>
                    <td className="px-4 py-2 text-slate-600">{o.stationName ?? 'Any'}</td>
                    <td className="px-4 py-2">
                      <Badge color={STATUS[o.status].color}>{STATUS[o.status].label}</Badge>
                    </td>
                    <td className="hidden px-4 py-2 text-slate-600 md:table-cell">{o.performer ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-700">Schedules</h2>
          {isAdmin && (
            <Link to="/admin/operations" className="text-xs font-medium text-brand hover:underline">
              Shift times & time zone
            </Link>
          )}
        </div>
        {!schedules.data?.length ? (
          <EmptyState icon={<CalendarCheck className="size-10" />} title="No schedules yet">
            For example: the trailer pre-load inspection at every dock door, every shift. Turn on <strong>Checklist mode</strong> in the SOP first.
          </EmptyState>
        ) : (
          <ul className="divide-y divide-slate-100 rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
            {schedules.data.map((sc) => (
              <li key={sc.id} className={cx('flex flex-wrap items-center gap-3 px-4 py-3', !sc.active && 'opacity-60')}>
                <div className="min-w-0 flex-1">
                  <div className="font-medium">
                    <span className="font-mono text-[11px] text-slate-500">{sc.sopNumber}</span> {sc.sopTitle}
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-3 text-xs text-slate-500">
                    <span className="inline-flex items-center gap-1"><Clock className="size-3" /> {sc.description}</span>
                    <span className="inline-flex items-center gap-1">
                      <MapPin className="size-3" />
                      {sc.stationIds.length ? sc.stationIds.map((id) => stations.data?.find((s) => s.id === id)?.name ?? '?').join(', ') : 'Once per period, any station'}
                    </span>
                    {!sc.active && <Badge>Paused</Badge>}
                  </div>
                </div>
                {isAdmin && (
                  <div className="flex">
                    <IconButton label="Edit" onClick={() => setEditing({ id: sc.id, sopId: sc.sopId, stationIds: sc.stationIds, frequency: sc.frequency, days: sc.days, shiftIds: sc.shiftIds, active: sc.active })}>
                      <Pencil className="size-4" />
                    </IconButton>
                    <IconButton label="Delete" className="hover:bg-red-50 hover:text-red-600" onClick={() => confirm('Delete this schedule? Its history disappears from this page; checklist records are kept.') && api.schedules.remove(sc.id).then(() => qc.invalidateQueries({ queryKey: ['schedules'] }))}>
                      <Trash2 className="size-4" />
                    </IconButton>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
      {editing && <ScheduleModal draft={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function OccurrenceCard({ o }: { o: Occurrence }) {
  const st = STATUS[o.status];
  return (
    <div className={cx('rounded-xl bg-white p-4 shadow-sm ring-1', o.status === 'due' ? 'ring-2 ring-amber-300' : 'ring-slate-200')}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-mono text-[11px] text-slate-500">{o.sopNumber}</div>
          <div className="truncate font-semibold">{o.sopTitle}</div>
          <div className="text-xs text-slate-500">
            {o.stationName ?? 'Any station'} · {o.label}
          </div>
        </div>
        <st.icon className="size-5 shrink-0" style={{ color: st.color }} />
      </div>
      <div className="mt-2 text-xs font-medium" style={{ color: st.color }}>
        {st.label}
        {o.performer && <span className="font-normal text-slate-500"> · {o.performer}</span>}
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number | string; tone?: string }) {
  return (
    <div className="rounded-xl bg-white px-4 py-3 shadow-sm ring-1 ring-slate-200">
      <div className="text-xs font-medium text-slate-500">{label}</div>
      <div className={cx('mt-1 text-2xl font-bold', tone ?? 'text-slate-900')}>{value}</div>
    </div>
  );
}

function ScheduleModal({ draft, onClose }: { draft: Draft; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [d, setD] = useState(draft);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const sops = useQuery({ queryKey: ['sops', 'all'], queryFn: () => api.sops.list({}) });
  const stations = useQuery({ queryKey: ['stations'], queryFn: api.stations.list });
  const settings = useQuery({ queryKey: ['settings'], queryFn: api.settings.get });
  const shifts = settings.data?.schedule.shifts ?? [];
  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const checklistSops = (sops.data ?? []).filter((s) => s.checklist || s.id === d.sopId);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const { id, ...body } = d;
      if (id) await api.schedules.update(id, body);
      else await api.schedules.create(body);
      void qc.invalidateQueries({ queryKey: ['schedules'] });
      void qc.invalidateQueries({ queryKey: ['schedule-board'] });
      toast.success('Schedule saved');
      onClose();
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
      width="max-w-2xl"
      title={d.id ? 'Edit schedule' : 'New schedule'}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={save} loading={busy} disabled={!d.sopId}>
            Save schedule
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <Field label="Checklist" hint={!checklistSops.length ? 'No SOPs have checklist mode turned on yet.' : undefined}>
          <Select value={d.sopId} onChange={(e) => setD({ ...d, sopId: e.target.value })}>
            <option value="">Choose an SOP…</option>
            {checklistSops.map((s) => (
              <option key={s.id} value={s.id}>
                {s.number} · {s.title}
              </option>
            ))}
          </Select>
        </Field>
        <Field group label="How often">
          <Segmented
            value={d.frequency}
            onChange={(frequency: ScheduleFrequency) => setD({ ...d, frequency })}
            options={[
              { value: 'shift', label: 'Every shift' },
              { value: 'daily', label: 'Daily' },
              { value: 'weekly', label: 'Weekly' },
              { value: 'monthly', label: 'Monthly' },
            ]}
          />
        </Field>
        {(d.frequency === 'shift' || d.frequency === 'daily') && (
          <Field group label="On these days">
            <div className="flex flex-wrap gap-1.5">
              {WEEKDAYS.map((w, i) => (
                <button key={w} type="button" aria-pressed={d.days.includes(i)} onClick={() => setD({ ...d, days: toggle(d.days, i) })} className={cx('w-12 rounded-lg py-1.5 text-sm font-medium ring-1', d.days.includes(i) ? 'bg-brand text-white ring-brand' : 'bg-white text-slate-600 ring-slate-300')}>
                  {w}
                </button>
              ))}
            </div>
          </Field>
        )}
        {d.frequency === 'shift' && (
          <Field group label="Shifts" hint="None selected means every shift.">
            <div className="flex flex-wrap gap-1.5">
              {shifts.map((s) => (
                <button key={s.id} type="button" aria-pressed={d.shiftIds.includes(s.id)} onClick={() => setD({ ...d, shiftIds: toggle(d.shiftIds, s.id) })} className={cx('rounded-lg px-3 py-1.5 text-sm ring-1', d.shiftIds.includes(s.id) ? 'bg-brand text-white ring-brand' : 'bg-white text-slate-600 ring-slate-300')}>
                  {s.name} <span className="opacity-70">{s.start}–{s.end}</span>
                </button>
              ))}
            </div>
          </Field>
        )}
        <Field group label="Where" hint="One checklist is expected at each selected station. Pick none to expect one per period anywhere.">
          <div className="flex flex-wrap gap-1.5">
            {stations.data?.map((s) => (
              <button key={s.id} type="button" aria-pressed={d.stationIds.includes(s.id)} onClick={() => setD({ ...d, stationIds: toggle(d.stationIds, s.id) })} className={cx('rounded-lg px-3 py-1.5 text-sm ring-1', d.stationIds.includes(s.id) ? 'bg-brand text-white ring-brand' : 'bg-white text-slate-600 ring-slate-300')}>
                {s.name}
              </button>
            ))}
            {!stations.data?.length && <span className="text-sm text-slate-500">No stations yet.</span>}
          </div>
        </Field>
        <Toggle checked={d.active} onChange={(active) => setD({ ...d, active })} label="Active" description="Paused schedules don't expect checklists or send missed emails." />
        <ErrorText error={error} />
      </div>
    </Modal>
  );
}
