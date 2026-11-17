import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ClipboardPaste, Pencil, Plus, Trash2, UserPlus, Users } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { RosterPerson, Team } from '@shared/types';
import { api } from '../../api';
import { useToast } from '../../components/Toast';
import { Badge, Button, Card, cx, EmptyState, ErrorText, Field, IconButton, Input, Modal, PageLoader, Select, Textarea } from '../../components/ui';

type TeamDraft = { id?: string; name: string; categoryIds: string[]; sopIds: string[] };

/** Teams decide which SOPs people must sign. The roster adds associates who have no account. */
export default function TeamsSettings() {
  const qc = useQueryClient();
  const toast = useToast();
  const teams = useQuery({ queryKey: ['teams'], queryFn: api.teams.list });
  const roster = useQuery({ queryKey: ['roster'], queryFn: api.roster.list });
  const categories = useQuery({ queryKey: ['categories'], queryFn: api.categories.list });
  const [team, setTeam] = useState<TeamDraft | null>(null);
  const [person, setPerson] = useState<(Omit<RosterPerson, 'id'> & { id?: string }) | null>(null);
  const [pasting, setPasting] = useState(false);
  const [filter, setFilter] = useState('');
  const [teamFilter, setTeamFilter] = useState('');

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['teams'] });
    void qc.invalidateQueries({ queryKey: ['roster'] });
    void qc.invalidateQueries({ queryKey: ['training'] });
  };
  const run = async (fn: () => Promise<unknown>, msg: string) => {
    try {
      await fn();
      refresh();
      toast.success(msg);
    } catch (e) {
      toast.error(e);
    }
  };

  const people = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return (roster.data ?? []).filter((p) => (!q || p.name.toLowerCase().includes(q) || p.employeeId.toLowerCase().includes(q)) && (!teamFilter || (teamFilter === 'none' ? !p.teamId : p.teamId === teamFilter)));
  }, [roster.data, filter, teamFilter]);

  if (teams.isLoading || roster.isLoading) return <PageLoader />;

  const required = (t: Team) => {
    if (!t.categoryIds.length && !t.sopIds.length) return 'Every SOP';
    const parts = [
      ...t.categoryIds.map((id) => categories.data?.find((c) => c.id === id)?.name).filter(Boolean),
      ...(t.sopIds.length ? [`${t.sopIds.length} more SOP${t.sopIds.length === 1 ? '' : 's'}`] : []),
    ];
    return parts.join(', ');
  };

  return (
    <div className="max-w-5xl space-y-6">
      <Card
        title="Teams"
        description="Each team signs the SOPs in its categories (plus any extra SOPs you pick). The training matrix and dashboard measure sign-off against this."
        actions={
          <Button variant="primary" size="sm" icon={<Plus className="size-4" />} onClick={() => setTeam({ name: '', categoryIds: [], sopIds: [] })}>
            New team
          </Button>
        }
        bodyClassName="p-0"
      >
        {!teams.data?.length ? (
          <p className="px-5 py-4 text-sm text-slate-500">No teams yet. Without teams, everyone is expected to sign every approved SOP. Try Receiving, Shipping, Inventory and Maintenance.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {teams.data.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                <div className="flex size-9 items-center justify-center rounded-full bg-brand/10 text-brand">
                  <Users className="size-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{t.name}</div>
                  <div className="text-xs text-slate-500">
                    {t.memberCount} {t.memberCount === 1 ? 'person' : 'people'} · signs: {required(t)}
                  </div>
                </div>
                <IconButton label="Edit team" onClick={() => setTeam({ id: t.id, name: t.name, categoryIds: t.categoryIds, sopIds: t.sopIds })}>
                  <Pencil className="size-4" />
                </IconButton>
                <IconButton label="Delete team" className="hover:bg-red-50 hover:text-red-600" onClick={() => confirm(`Delete the ${t.name} team? Its members stay, without a team.`) && run(() => api.teams.remove(t.id), 'Team deleted')}>
                  <Trash2 className="size-4" />
                </IconButton>
              </li>
            ))}
          </ul>
        )}
        <p className="border-t border-slate-100 px-5 py-3 text-xs text-slate-500">People with an account are put on a team under Admin → Users.</p>
      </Card>

      <Card
        title="Roster"
        description="Associates who sign SOPs without an account (on a shared tablet or a station QR code, by name and employee ID). Adding them here counts them in sign-off rates."
        actions={
          <>
            <Button size="sm" icon={<ClipboardPaste className="size-4" />} onClick={() => setPasting(true)}>
              Paste a list
            </Button>
            <Button variant="primary" size="sm" icon={<UserPlus className="size-4" />} onClick={() => setPerson({ name: '', employeeId: '', teamId: null, active: true })}>
              Add person
            </Button>
          </>
        }
        bodyClassName="p-0"
      >
        {!roster.data?.length ? (
          <div className="p-5">
            <EmptyState icon={<Users className="size-10" />} title="No one on the roster">
              Paste a list from your HR or timekeeping system: one person per line, <code>Name, Employee ID</code>.
            </EmptyState>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap gap-2 border-b border-slate-100 px-5 py-3">
              <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Search name or ID" className="w-56" />
              <Select value={teamFilter} onChange={(e) => setTeamFilter(e.target.value)} className="w-44">
                <option value="">All teams</option>
                {teams.data?.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
                <option value="none">No team</option>
              </Select>
              <span className="self-center text-xs text-slate-500">
                {people.length} of {roster.data.length}
              </span>
            </div>
            <div className="max-h-[480px] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-slate-50 text-left text-xs font-semibold text-slate-500">
                  <tr>
                    <th className="px-5 py-2">Name</th>
                    <th className="px-3 py-2">Employee ID</th>
                    <th className="px-3 py-2">Team</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {people.map((p) => (
                    <tr key={p.id} className={cx(!p.active && 'opacity-50')}>
                      <td className="px-5 py-2 font-medium">
                        {p.name} {!p.active && <Badge>Inactive</Badge>}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs text-slate-600">{p.employeeId || '—'}</td>
                      <td className="px-3 py-2">
                        <Select value={p.teamId ?? ''} className="h-8 w-44 py-1 text-xs" onChange={(e) => run(() => api.roster.update(p.id, { ...p, teamId: e.target.value || null }), 'Team updated')}>
                          <option value="">No team</option>
                          {teams.data?.map((t) => (
                            <option key={t.id} value={t.id}>
                              {t.name}
                            </option>
                          ))}
                        </Select>
                      </td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">
                        <IconButton label="Edit" onClick={() => setPerson({ ...p })}>
                          <Pencil className="size-4" />
                        </IconButton>
                        <IconButton label="Remove" className="hover:bg-red-50 hover:text-red-600" onClick={() => confirm(`Remove ${p.name} from the roster? Their past sign-offs are kept.`) && run(() => api.roster.remove(p.id), 'Removed')}>
                          <Trash2 className="size-4" />
                        </IconButton>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Card>

      {team && <TeamModal draft={team} onClose={() => setTeam(null)} onSaved={refresh} />}
      {person && <PersonModal draft={person} teams={teams.data ?? []} onClose={() => setPerson(null)} onSaved={refresh} />}
      {pasting && <PasteModal teams={teams.data ?? []} onClose={() => setPasting(false)} onSaved={refresh} />}
    </div>
  );
}

function TeamModal({ draft, onClose, onSaved }: { draft: TeamDraft; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [d, setD] = useState(draft);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState('');
  const categories = useQuery({ queryKey: ['categories'], queryFn: api.categories.list });
  const sops = useQuery({ queryKey: ['sops', 'all'], queryFn: () => api.sops.list({}) });
  const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  // SOPs already covered by a chosen category don't need picking one by one.
  const extra = (sops.data ?? []).filter((s) => !d.categoryIds.includes(s.categoryId ?? '') && (!q || `${s.number} ${s.title}`.toLowerCase().includes(q.toLowerCase())));

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const { id, ...body } = d;
      const sopIds = body.sopIds.filter((sid) => !d.categoryIds.includes(sops.data?.find((s) => s.id === sid)?.categoryId ?? ''));
      if (id) await api.teams.update(id, { ...body, sopIds });
      else await api.teams.create({ ...body, sopIds });
      onSaved();
      toast.success('Team saved');
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
      title={d.id ? 'Edit team' : 'New team'}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={save} loading={busy} disabled={!d.name.trim()}>
            Save team
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <Field label="Team name">
          <Input value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} placeholder="e.g. Receiving, 2nd shift" autoFocus />
        </Field>
        <Field group label="Must sign every SOP in" hint="Leave everything unticked to require every approved SOP.">
          <div className="flex flex-wrap gap-1.5">
            {categories.data?.map((c) => (
              <button key={c.id} type="button" aria-pressed={d.categoryIds.includes(c.id)} onClick={() => setD({ ...d, categoryIds: toggle(d.categoryIds, c.id) })} className={cx('rounded-lg px-3 py-1.5 text-sm ring-1', d.categoryIds.includes(c.id) ? 'bg-brand text-white ring-brand' : 'bg-white text-slate-600 ring-slate-300')}>
                {c.name}
              </button>
            ))}
          </div>
        </Field>
        <div>
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <span className="text-xs font-semibold tracking-wide text-slate-600">Plus these SOPs</span>
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" className="h-8 w-48 text-xs" />
          </div>
          <div className="max-h-56 overflow-y-auto rounded-lg ring-1 ring-slate-200">
            {extra.map((s) => (
              <label key={s.id} className="flex cursor-pointer items-center gap-2 border-b border-slate-100 px-3 py-1.5 text-sm last:border-0 hover:bg-slate-50">
                <input type="checkbox" checked={d.sopIds.includes(s.id)} onChange={() => setD({ ...d, sopIds: toggle(d.sopIds, s.id) })} className="size-4 accent-[var(--brand)]" />
                <span className="font-mono text-[11px] text-slate-500">{s.number}</span>
                <span className="truncate">{s.title}</span>
              </label>
            ))}
            {!extra.length && <p className="px-3 py-3 text-sm text-slate-500">No other SOPs.</p>}
          </div>
        </div>
        <ErrorText error={error} />
      </div>
    </Modal>
  );
}

function PersonModal({ draft, teams, onClose, onSaved }: { draft: Omit<RosterPerson, 'id'> & { id?: string }; teams: Team[]; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [d, setD] = useState(draft);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const { id, ...body } = d;
      if (id) await api.roster.update(id, body);
      else await api.roster.create(body);
      onSaved();
      toast.success('Saved');
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
      title={d.id ? 'Edit person' : 'Add person'}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={save} loading={busy} disabled={!d.name.trim()}>
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Name">
          <Input value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} autoFocus />
        </Field>
        <Field label="Employee ID" hint="Matches sign-offs typed at a station with this ID.">
          <Input value={d.employeeId} onChange={(e) => setD({ ...d, employeeId: e.target.value })} />
        </Field>
        <Field label="Team">
          <Select value={d.teamId ?? ''} onChange={(e) => setD({ ...d, teamId: e.target.value || null })}>
            <option value="">No team</option>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Select>
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={d.active} onChange={(e) => setD({ ...d, active: e.target.checked })} className="size-4 accent-[var(--brand)]" />
          Active (uncheck when someone leaves; their sign-offs are kept)
        </label>
        <ErrorText error={error} />
      </div>
    </Modal>
  );
}

function PasteModal({ teams, onClose, onSaved }: { teams: Team[]; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [text, setText] = useState('');
  const [teamId, setTeamId] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const lines = text.split('\n').filter((l) => l.trim()).length;
  const go = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.roster.importText(text, teamId || null);
      onSaved();
      toast.success(`${r.added} added, ${r.updated} updated`);
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
      width="max-w-xl"
      title="Paste a list of people"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={go} loading={busy} disabled={!lines}>
            Add {lines || ''} {lines === 1 ? 'person' : 'people'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="One person per line" hint="Name, Employee ID (tabs from a spreadsheet work too). People already on the roster with the same ID are updated, not duplicated.">
          <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={10} className="font-mono text-xs" placeholder={'Maria Lopez, 10482\nJames Carter, 10519\nAnh Nguyen, 10533'} autoFocus />
        </Field>
        <Field label="Put them on team">
          <Select value={teamId} onChange={(e) => setTeamId(e.target.value)}>
            <option value="">No team (or keep their current team)</option>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Select>
        </Field>
        <ErrorText error={error} />
      </div>
    </Modal>
  );
}
