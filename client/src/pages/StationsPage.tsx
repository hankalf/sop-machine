import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, ExternalLink, Globe, Lock, MapPin, Pencil, Plus, QrCode, RefreshCcw, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { SopSummary, Station } from '@shared/types';
import { api, downloadFile } from '../api';
import { useCan } from '../auth';
import { useToast } from '../components/Toast';
import { Badge, Button, cx, EmptyState, Field, IconButton, Input, Modal, PageLoader, Select, Toggle } from '../components/ui';

type Draft = { id?: string; name: string; area: string; sopIds: string[]; publicAccess: boolean };

/** Workstations, dock doors and equipment that get a QR placard. */
export default function StationsPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const isAdmin = useCan('admin');
  const stations = useQuery({ queryKey: ['stations'], queryFn: api.stations.list });
  const sops = useQuery({ queryKey: ['sops', 'all'], queryFn: () => api.sops.list({}) });
  const [editing, setEditing] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [size, setSize] = useState('letter');
  const sopMap = useMemo(() => new Map((sops.data ?? []).map((s) => [s.id, s])), [sops.data]);
  const refresh = () => qc.invalidateQueries({ queryKey: ['stations'] });
  const link = (s: Station) => `${window.location.origin}/s/${s.token}`;

  const save = async () => {
    if (!editing) return;
    setBusy(true);
    try {
      const { id, ...body } = editing;
      if (id) await api.stations.update(id, body);
      else await api.stations.create(body);
      await refresh();
      void qc.invalidateQueries({ queryKey: ['sop-stations'] });
      setEditing(null);
      toast.success('Station saved');
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };

  if (stations.isLoading) return <PageLoader />;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <MapPin className="size-6 text-brand" /> Stations & QR placards
          </h1>
          <p className="max-w-2xl text-sm text-slate-500">
            Create a station for each dock door, workstation or piece of equipment, choose its SOPs, and post the QR placard there. Scanning always opens the current approved version, where associates can sign off or run a checklist.
          </p>
        </div>
        <div className="flex gap-2">
          <Select value={size} onChange={(e) => setSize(e.target.value)} className="w-40" aria-label="Placard size">
            <option value="letter">Letter placard</option>
            <option value="half">Half-letter placard</option>
            <option value="card">4×6 card</option>
          </Select>
          <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setEditing({ name: '', area: '', sopIds: [], publicAccess: true })}>
            New station
          </Button>
        </div>
      </div>

      {!stations.data?.length ? (
        <EmptyState icon={<QrCode className="size-10" />} title="No stations yet" action={<Button variant="primary" onClick={() => setEditing({ name: '', area: '', sopIds: [], publicAccess: true })}>Create the first station</Button>}>
          For example "Dock Door 7", "Receiving Desk" or "Forklift 12".
        </EmptyState>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {stations.data.map((st) => {
            const list = st.sopIds.map((id) => sopMap.get(id)).filter((x): x is SopSummary => !!x);
            const notApproved = list.filter((s) => !s.publishedVersion).length;
            return (
              <div key={st.id} className="flex flex-col rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h3 className="font-semibold">{st.name}</h3>
                    <p className="text-xs text-slate-500">{st.area || 'No area'}</p>
                  </div>
                  {st.publicAccess ? (
                    <Badge color="#16a34a"><Globe className="size-3" /> No sign-in</Badge>
                  ) : (
                    <Badge><Lock className="size-3" /> Sign-in required</Badge>
                  )}
                </div>
                <ul className="mt-3 flex-1 space-y-1 text-sm">
                  {list.map((s) => (
                    <li key={s.id} className="flex gap-2">
                      <span className="font-mono text-[11px] text-slate-500">{s.number}</span>
                      <span className={cx('min-w-0 flex-1 truncate', !s.publishedVersion && 'text-slate-400')}>{s.title}</span>
                    </li>
                  ))}
                  {!list.length && <li className="text-slate-400">No SOPs assigned</li>}
                </ul>
                {notApproved > 0 && <p className="mt-2 text-xs text-amber-700">{notApproved} not approved yet, so hidden on the floor.</p>}
                <div className="mt-4 flex items-center gap-1 border-t border-slate-100 pt-3">
                  <Button size="sm" variant="primary" icon={<QrCode className="size-3.5" />} onClick={() => downloadFile(`/api/stations/${st.id}/placard?size=${size}`).catch(toast.error)}>
                    Placard
                  </Button>
                  <div className="ml-auto flex">
                    <IconButton label="Open station page" onClick={() => window.open(link(st), '_blank')}>
                      <ExternalLink className="size-4" />
                    </IconButton>
                    <IconButton label="Copy link" onClick={() => navigator.clipboard.writeText(link(st)).then(() => toast.success('Link copied'))}>
                      <Copy className="size-4" />
                    </IconButton>
                    <IconButton label="Edit" onClick={() => setEditing({ id: st.id, name: st.name, area: st.area, sopIds: st.sopIds, publicAccess: st.publicAccess })}>
                      <Pencil className="size-4" />
                    </IconButton>
                    {isAdmin && (
                      <>
                        <IconButton
                          label="New QR code (old placards stop working)"
                          onClick={() => confirm('Create a new QR code for this station? Placards already printed will stop working.') && api.stations.rotate(st.id).then(refresh).then(() => toast.success('New QR code created. Print the placard again.'))}
                        >
                          <RefreshCcw className="size-4" />
                        </IconButton>
                        <IconButton label="Delete" className="hover:bg-red-50 hover:text-red-600" onClick={() => confirm(`Delete station "${st.name}"? Its QR code will stop working.`) && api.stations.remove(st.id).then(refresh)}>
                          <Trash2 className="size-4" />
                        </IconButton>
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title={editing?.id ? 'Edit station' : 'New station'}
        width="max-w-2xl"
        footer={
          <>
            <Button onClick={() => setEditing(null)}>Cancel</Button>
            <Button variant="primary" onClick={save} loading={busy} disabled={!editing?.name.trim()}>
              Save station
            </Button>
          </>
        }
      >
        {editing && (
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Station name">
                <Input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} placeholder="e.g. Dock Door 7" autoFocus />
              </Field>
              <Field label="Area (optional)">
                <Input value={editing.area} onChange={(e) => setEditing({ ...editing, area: e.target.value })} placeholder="e.g. Receiving" />
              </Field>
            </div>
            <Toggle
              checked={editing.publicAccess}
              onChange={(v) => setEditing({ ...editing, publicAccess: v })}
              label="Open without signing in"
              description="Anyone who scans the placard can read these SOPs, sign off with their name and run checklists. Turn off for sensitive procedures."
            />
            <SopPicker sops={sops.data ?? []} selected={editing.sopIds} onChange={(sopIds) => setEditing({ ...editing, sopIds })} />
          </div>
        )}
      </Modal>
    </div>
  );
}

function SopPicker({ sops, selected, onChange }: { sops: SopSummary[]; selected: string[]; onChange: (ids: string[]) => void }) {
  const [q, setQ] = useState('');
  const shown = sops.filter((s) => s.status !== 'archived' && `${s.number} ${s.title}`.toLowerCase().includes(q.toLowerCase()));
  const toggle = (id: string) => onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-xs font-semibold text-slate-600">SOPs at this station ({selected.length})</span>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter…" className="h-7 w-40 rounded-md border-0 px-2 text-xs ring-1 ring-slate-300" />
      </div>
      <div className="max-h-64 divide-y divide-slate-100 overflow-y-auto rounded-lg ring-1 ring-slate-200 scrollbar-thin">
        {shown.map((s) => (
          <label key={s.id} className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-slate-50">
            <input type="checkbox" checked={selected.includes(s.id)} onChange={() => toggle(s.id)} className="size-4 accent-[var(--brand)]" />
            <span className="font-mono text-[11px] text-slate-500">{s.number}</span>
            <span className="min-w-0 flex-1 truncate">{s.title}</span>
            {!s.publishedVersion && <span className="text-[11px] text-amber-700">not approved</span>}
          </label>
        ))}
        {!shown.length && <p className="px-3 py-4 text-center text-sm text-slate-500">No SOPs found.</p>}
      </div>
    </div>
  );
}
