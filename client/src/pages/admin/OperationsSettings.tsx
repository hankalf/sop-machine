import { Clock, Globe, Plus, Trash2, Wrench } from 'lucide-react';
import { useMemo } from 'react';
import type { ShiftDef } from '@shared/types';
import { Button, Card, Field, IconButton, Input, PageLoader, Select, Toggle } from '../../components/ui';
import { SaveBar } from './SaveBar';
import { useSettingsForm } from './useSettingsForm';

function zones(): string[] {
  try {
    return (Intl as unknown as { supportedValuesOf: (k: string) => string[] }).supportedValuesOf('timeZone');
  } catch {
    return ['UTC', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'America/Phoenix', 'America/Mexico_City', 'Europe/London'];
  }
}

const crossesMidnight = (s: ShiftDef) => s.end <= s.start;

/** Site time zone, shift times and corrective-action defaults. */
export default function OperationsSettings() {
  const { form, set, save, saving, dirty, reset, loading } = useSettingsForm();
  const all = useMemo(zones, []);
  const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (loading || !form) return <PageLoader />;
  const { timezone, shifts } = form.schedule;
  const setShift = (i: number, patch: Partial<ShiftDef>) => set('schedule', { shifts: shifts.map((s, j) => (j === i ? { ...s, ...patch } : s)) });
  const options = timezone && !all.includes(timezone) ? [timezone, ...all] : all;

  return (
    <div className="grid max-w-5xl gap-6 lg:grid-cols-2">
      <Card title={<span className="flex items-center gap-2"><Globe className="size-4 text-brand" /> Site time zone</span>} description="Shifts, due dates and the dashboard's days use this clock." bodyClassName="space-y-3">
        <Field label="Time zone" hint={!timezone ? 'Not set: UTC is used until you pick one.' : undefined}>
          <Select value={timezone} onChange={(e) => set('schedule', { timezone: e.target.value })}>
            <option value="">Not set (UTC)</option>
            {options.map((z) => (
              <option key={z} value={z}>
                {z.replace(/_/g, ' ')}
              </option>
            ))}
          </Select>
        </Field>
        {browserTz && browserTz !== timezone && (
          <Button size="sm" onClick={() => set('schedule', { timezone: browserTz })}>
            Use this computer's time zone ({browserTz.replace(/_/g, ' ')})
          </Button>
        )}
      </Card>

      <Card title={<span className="flex items-center gap-2"><Wrench className="size-4 text-brand" /> Corrective actions</span>} description="What happens when a checklist item fails." bodyClassName="space-y-4">
        <Toggle
          checked={form.actions.autoCreate}
          onChange={(v) => set('actions', { autoCreate: v })}
          label="Open an action for every failed item"
          description="Assigned to the station's supervisor, or to the SOP's owner when the station has none."
        />
        <Field label="Due in (days)" hint="Default due date for new actions. 0 means the same day.">
          <Input type="number" min={0} max={60} value={form.actions.defaultDueDays} onChange={(e) => set('actions', { defaultDueDays: Number(e.target.value) })} className="w-28" />
        </Field>
      </Card>

      <Card
        title={<span className="flex items-center gap-2"><Clock className="size-4 text-brand" /> Shifts</span>}
        description="Used by “every shift” checklist schedules. A shift that ends at or before its start time runs past midnight."
        className="lg:col-span-2"
        actions={
          <Button size="sm" icon={<Plus className="size-4" />} onClick={() => set('schedule', { shifts: [...shifts, { id: '', name: `Shift ${shifts.length + 1}`, start: '06:00', end: '14:00' }] })}>
            Add shift
          </Button>
        }
      >
        {!shifts.length ? (
          <p className="text-sm text-slate-500">No shifts. “Every shift” schedules need at least one.</p>
        ) : (
          <div className="space-y-2">
            {shifts.map((s, i) => (
              <div key={s.id || `new-${i}`} className="flex flex-wrap items-end gap-3 rounded-lg bg-slate-50 p-3">
                <Field label="Name" className="min-w-40 flex-1">
                  <Input value={s.name} onChange={(e) => setShift(i, { name: e.target.value })} />
                </Field>
                <Field label="Starts">
                  <Input type="time" value={s.start} onChange={(e) => setShift(i, { start: e.target.value })} className="w-32" />
                </Field>
                <Field label="Ends">
                  <Input type="time" value={s.end} onChange={(e) => setShift(i, { end: e.target.value })} className="w-32" />
                </Field>
                <span className="mb-2 w-28 text-xs text-slate-500">{s.start === s.end ? <span className="text-red-600">Start and end match</span> : crossesMidnight(s) ? 'Ends next day' : ''}</span>
                <IconButton label="Remove shift" className="mb-0.5 hover:bg-red-50 hover:text-red-600" onClick={() => set('schedule', { shifts: shifts.filter((_, j) => j !== i) })}>
                  <Trash2 className="size-4" />
                </IconButton>
              </div>
            ))}
          </div>
        )}
      </Card>
      <div className="lg:col-span-2">
        <SaveBar dirty={dirty} saving={saving} onSave={save} onReset={reset} />
      </div>
    </div>
  );
}
