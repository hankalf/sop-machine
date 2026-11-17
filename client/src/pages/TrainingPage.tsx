import { useQuery } from '@tanstack/react-query';
import { Check, Download, GraduationCap, RefreshCw } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { isRequiredFor } from '@shared/defaults';
import { api, downloadFile } from '../api';
import { useToast } from '../components/Toast';
import { Button, cx, EmptyState, ErrorText, Input, PageLoader, Select } from '../components/ui';

/** Who is trained on what: people down the side, approved SOPs across the top. */
export default function TrainingPage() {
  const [categoryId, setCategoryId] = useState('');
  const [search, setSearch] = useState('');
  const [onlyGaps, setOnlyGaps] = useState(false);
  const [teamId, setTeamId] = useState('');
  const toast = useToast();
  const categories = useQuery({ queryKey: ['categories'], queryFn: api.categories.list });
  const matrix = useQuery({ queryKey: ['training', categoryId], queryFn: () => api.training.matrix(categoryId || undefined) });

  const m = matrix.data;
  const teamOf = useMemo(() => new Map((m?.teams ?? []).map((t) => [t.id, t])), [m]);
  /** Whether this person's team has to sign this SOP. No team means everything. */
  const required = (p: { teamId: string | null }, s: { id: string; categoryId: string | null }) => isRequiredFor(p.teamId ? teamOf.get(p.teamId) : null, s);

  const people = useMemo(() => {
    if (!m) return [];
    const q = search.trim().toLowerCase();
    return m.people.filter((p) => {
      if (q && !`${p.name} ${p.employeeId}`.toLowerCase().includes(q)) return false;
      if (teamId && (teamId === 'none' ? p.teamId : p.teamId !== teamId)) return false;
      if (onlyGaps) return m.sops.some((s) => required(p, s) && !m.cells[p.key]?.[s.id]?.current);
      return true;
    });
  }, [m, search, onlyGaps, teamId, teamOf]);

  // Rates count only what each person's team is required to sign.
  const stats = useMemo(() => {
    if (!m) return { current: 0, stale: 0, missing: 0, pct: 0 };
    let current = 0;
    let stale = 0;
    let total = 0;
    for (const p of people) {
      for (const s of m.sops) {
        if (!required(p, s)) continue;
        total++;
        const c = m.cells[p.key]?.[s.id];
        if (c?.current) current++;
        else if (c) stale++;
      }
    }
    return { current, stale, missing: total - current - stale, pct: total ? Math.round((current / total) * 100) : 0 };
  }, [m, people, teamOf]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <GraduationCap className="size-6 text-brand" /> Training
          </h1>
          <p className="text-sm text-slate-500">Who has read and signed off on each approved SOP. A new revision asks everyone to sign again.</p>
        </div>
        <Button icon={<Download className="size-4" />} onClick={() => downloadFile(`/api/training/matrix.csv${categoryId ? `?categoryId=${categoryId}` : ''}`).catch(toast.error)}>
          Export for audit (CSV)
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Up to date" value={`${stats.pct}%`} tone="text-emerald-700" />
        <Stat label="Current sign-offs" value={stats.current} />
        <Stat label="Need to re-sign" value={stats.stale} tone={stats.stale ? 'text-amber-700' : undefined} />
        <Stat label="Not signed" value={stats.missing} tone={stats.missing ? 'text-slate-500' : undefined} />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Input placeholder="Search people…" value={search} onChange={(e) => setSearch(e.target.value)} className="w-56" />
        <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className="w-56">
          <option value="">All categories</option>
          {categories.data?.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
        {!!m?.teams.length && (
          <Select value={teamId} onChange={(e) => setTeamId(e.target.value)} className="w-48">
            <option value="">All teams</option>
            {m.teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
            <option value="none">No team</option>
          </Select>
        )}
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" checked={onlyGaps} onChange={(e) => setOnlyGaps(e.target.checked)} className="size-4 accent-[var(--brand)]" />
          Only people with gaps
        </label>
      </div>

      {matrix.isLoading ? (
        <PageLoader />
      ) : matrix.error ? (
        <ErrorText error={matrix.error} />
      ) : !m?.sops.length ? (
        <EmptyState icon={<GraduationCap className="size-10" />} title="No approved SOPs yet">
          Approve an SOP, then people can sign off in the app or by scanning a station QR code.
        </EmptyState>
      ) : (
        <div className="overflow-auto rounded-xl bg-white shadow-sm ring-1 ring-slate-200 scrollbar-thin" style={{ maxHeight: 'calc(100vh - 330px)' }}>
          <table className="border-separate border-spacing-0 text-sm">
            <thead>
              <tr>
                <th className="sticky top-0 left-0 z-20 min-w-52 border-b border-slate-200 bg-slate-50 px-4 py-2 text-left text-xs font-semibold text-slate-500">Person</th>
                {m.sops.map((s) => (
                  <th key={s.id} className="sticky top-0 z-10 w-28 max-w-28 border-b border-l border-slate-200 bg-slate-50 px-2 py-2 text-left align-bottom text-xs font-medium">
                    <Link to={`/sops/${s.id}`} className="block hover:text-brand" title={`${s.number} ${s.title}`}>
                      <span className="block font-mono text-[10px] text-slate-500">{s.number}</span>
                      <span className="line-clamp-2 leading-tight">{s.title}</span>
                      <span className="text-[10px] font-normal text-slate-400">Rev {s.version}</span>
                    </Link>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {people.map((p) => (
                <tr key={p.key} className="group">
                  <td className="sticky left-0 z-10 border-b border-slate-100 bg-white px-4 py-2 group-hover:bg-slate-50">
                    <div className="font-medium">{p.name}</div>
                    <div className="text-xs text-slate-500">
                      {[p.employeeId || (p.role ? `${p.role} account` : p.rosterId ? 'roster' : 'no account'), p.teamId && teamOf.get(p.teamId)?.name].filter(Boolean).join(' · ')}
                    </div>
                  </td>
                  {m.sops.map((s) => {
                    const c = m.cells[p.key]?.[s.id];
                    const req = required(p, s);
                    return (
                      <td
                        key={s.id}
                        className={cx(
                          'border-b border-l border-slate-100 px-2 py-2 text-center text-xs',
                          c?.current ? 'bg-emerald-50 text-emerald-800' : c ? 'bg-amber-50 text-amber-800' : req ? 'text-slate-300' : 'bg-slate-50/70 text-slate-300',
                        )}
                        title={c ? `Signed Rev ${c.version} on ${new Date(c.at).toLocaleDateString()}` : req ? 'Not signed' : 'Not required for their team'}
                      >
                        {c?.current ? (
                          <span className="inline-flex items-center gap-1">
                            <Check className="size-3.5" /> {new Date(c.at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                          </span>
                        ) : c ? (
                          <span className="inline-flex items-center gap-1">
                            <RefreshCw className="size-3" /> Rev {c.version}
                          </span>
                        ) : req ? (
                          '—'
                        ) : (
                          <span className="text-[10px] tracking-wide uppercase">n/a</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
              {!people.length && (
                <tr>
                  <td colSpan={m.sops.length + 1} className="px-4 py-8 text-center text-slate-500">
                    {m.people.length ? 'Nobody matches these filters.' : 'No people yet. Add users or a roster under Admin, or have associates sign at a station.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-slate-500">
        <span className="mr-3 inline-flex items-center gap-1"><span className="size-2.5 rounded-sm bg-emerald-200" /> signed the current revision</span>
        <span className="mr-3 inline-flex items-center gap-1"><span className="size-2.5 rounded-sm bg-amber-200" /> signed an older revision</span>
        <span className="mr-3">n/a: not required for their team (set under Admin → Teams & roster)</span>
        Administrators appear once they have signed something.
      </p>
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
