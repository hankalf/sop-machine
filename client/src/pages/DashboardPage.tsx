import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { AlertTriangle, BarChart3, Eye, Table2 } from 'lucide-react';
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { DashboardData } from '@shared/types';
import { api } from '../api';
import { cx, ErrorText, PageLoader, Segmented, timeAgo } from '../components/ui';

/**
 * Chart roles. Blue is the one data hue; red marks failures. The pair was run through the
 * colour-vision validator (deutan/protan/tritan separation) against the white card surface.
 */
const VIZ = {
  '--viz-s1': '#2a78d6',
  '--viz-track': '#cde2fb',
  '--viz-crit': '#d03b3b',
  '--viz-grid': '#e1e0d9',
  '--viz-axis': '#c3c2b7',
  '--viz-muted': '#898781',
} as CSSProperties;

const RANGES = [
  { value: '7', label: 'Last 7 days' },
  { value: '30', label: 'Last 30 days' },
  { value: '90', label: 'Last 90 days' },
];

const fmtDay = (iso: string, opts: Intl.DateTimeFormatOptions) => new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, opts);

/** Sign-off rates, checklist failures, missed schedules and what nobody reads. */
export default function DashboardPage() {
  const [days, setDays] = useState('30');
  const q = useQuery({ queryKey: ['dashboard', days], queryFn: () => api.dashboard(Number(days)), placeholderData: keepPreviousData });
  if (q.isLoading) return <PageLoader />;
  if (q.error || !q.data) return <ErrorText error={q.error ?? 'Could not load the dashboard'} />;
  const d = q.data;
  const stale = q.isFetching && q.isPlaceholderData;

  return (
    <div className="space-y-5" style={VIZ}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <BarChart3 className="size-6 text-brand" /> Dashboard
          </h1>
          <p className="text-sm text-slate-500">How the floor is doing with its SOPs: who is signed off, what keeps failing, and what nobody reads.</p>
        </div>
      </div>

      {/* One filter row; everything below follows it. */}
      <div className="w-full max-w-md">
        <Segmented value={days} onChange={setDays} options={RANGES} />
      </div>

      <div className={cx('space-y-5 transition-opacity', stale && 'opacity-60')}>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <Tile label="Sign-offs up to date" value={d.training.pct === null ? '—' : `${d.training.pct}%`} to="/training">
            {d.training.required ? `${d.training.current.toLocaleString()} of ${d.training.required.toLocaleString()} required` : 'No one is required to sign yet'}
            {d.training.needResign > 0 && <> · {d.training.needResign} need to re-sign</>}
          </Tile>
          <Tile label="Checklists completed" value={d.checklists.completed.toLocaleString()} to="/records">
            {d.checklists.withFailures ? (
              <Status tone="critical">{d.checklists.withFailures} had a failure</Status>
            ) : d.checklists.completed ? (
              'No failures'
            ) : (
              'None in this period'
            )}
          </Tile>
          <Tile label="Scheduled checklists on time" value={d.schedules.compliancePct === null ? '—' : `${d.schedules.compliancePct}%`} to="/schedules">
            {!d.schedules.active ? (
              'No schedules set up'
            ) : d.schedules.missed ? (
              <Status tone="critical">{d.schedules.missed} missed</Status>
            ) : (
              `${d.schedules.done} done, none missed`
            )}
            {d.schedules.dueNow > 0 && <> · {d.schedules.dueNow} due now</>}
          </Tile>
          <Tile label="Open corrective actions" value={d.actions.open.toLocaleString()} to="/actions">
            {d.actions.overdue ? <Status tone="critical">{d.actions.overdue} overdue</Status> : d.actions.open ? 'None overdue' : 'Nothing open'}
            {d.actions.avgDaysToClose !== null && <> · {d.actions.avgDaysToClose < 1 ? 'usually closed within a day' : `closed in ${d.actions.avgDaysToClose} days on average`}</>}
          </Tile>
          <Tile label="Approved SOPs" value={d.library.approved.toLocaleString()} to="/">
            {d.library.reviewOverdue ? (
              <Status tone="critical">{d.library.reviewOverdue} past review date</Status>
            ) : d.library.reviewDue ? (
              `${d.library.reviewDue} due for review in 30 days`
            ) : (
              `${d.library.inReview} in review · ${d.library.drafts} drafts`
            )}
          </Tile>
        </div>

        <Panel title="Checklists completed per day" description="Each column is one day on the site clock. Red is the share that had at least one failed item.">
          <DailyChecklists rows={d.checklists.perDay} />
        </Panel>

        <div className="grid gap-5 lg:grid-cols-2">
          <Panel title="Most-failed checklist items" description="Steps that failed most often. The figure after the bar is how often that step fails when it's checked.">
            {!d.checklists.topFailed.length ? (
              <Empty>No failed items in this period.</Empty>
            ) : (
              <RankedBars
                rows={d.checklists.topFailed.map((r) => ({
                  key: `${r.sopId}-${r.stepTitle}`,
                  name: r.stepTitle,
                  sub: `${r.number} · ${r.sopTitle}`,
                  to: `/records?sopId=${r.sopId}&failed=1`,
                  value: r.fails,
                  label: `${r.fails} ${r.fails === 1 ? 'fail' : 'fails'}`,
                  extra: `${r.rate}% of ${r.checks}`,
                }))}
              />
            )}
          </Panel>

          <Panel title="Sign-off by team" description="Current sign-offs as a share of what each team is required to sign.">
            {!d.training.teams.length ? (
              <Empty>No people yet. Add users or a roster under Admin → Teams & roster.</Empty>
            ) : (
              <MeterList
                rows={d.training.teams.map((t) => ({
                  key: t.id ?? 'none',
                  name: t.name,
                  sub: `${t.members} ${t.members === 1 ? 'person' : 'people'}`,
                  pct: t.pct,
                  detail: t.required ? `${t.current} of ${t.required}` : 'nothing required',
                }))}
              />
            )}
          </Panel>
        </div>

        <div className="grid gap-5 lg:grid-cols-3">
          <Panel title="Quiz: passed on the first try" description="Lowest first. A low rate usually means the SOP or the question is unclear.">
            {!d.quiz.length ? (
              <Empty>No quiz attempts in this period.</Empty>
            ) : (
              <MeterList
                rows={d.quiz.map((r) => ({ key: r.sopId, name: r.title, sub: r.number, to: `/sops/${r.sopId}`, pct: r.firstTryPct, detail: `${r.people} ${r.people === 1 ? 'person' : 'people'}` }))}
              />
            )}
          </Panel>

          <Panel title="Not opened on the floor" description={viewsNote(d)}>
            {!d.views.unopened.length ? (
              <Empty>Every approved SOP was opened on the floor in this period.</Empty>
            ) : (
              <ul className="-my-1 divide-y divide-slate-100">
                {d.views.unopened.map((s) => (
                  <li key={s.sopId} className="py-2">
                    <Link to={`/sops/${s.sopId}`} className="group block">
                      <span className="font-mono text-[11px] text-slate-500">{s.number}</span>{' '}
                      <span className="text-sm font-medium group-hover:text-brand">{s.title}</span>
                      <span className="block text-xs text-slate-500">{s.lastFloorView ? `Last opened ${timeAgo(s.lastFloorView)}` : 'Never opened on the floor'}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="Most opened on the floor" description="Station QR scans and viewer accounts. Editors and admins aren't counted.">
            {!d.views.mostViewed.some((v) => v.floorViews) ? (
              <Empty>No floor views in this period yet.</Empty>
            ) : (
              <RankedBars
                rows={d.views.mostViewed
                  .filter((v) => v.floorViews)
                  .map((v) => ({ key: v.sopId, name: v.title, sub: v.number, to: `/sops/${v.sopId}`, value: v.floorViews, label: v.floorViews.toLocaleString(), icon: <Eye className="size-3" /> }))}
              />
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}

function viewsNote(d: DashboardData) {
  const base = 'Approved SOPs nobody opened from a station or a viewer account in this period, oldest approval first.';
  if (!d.views.trackedSince) return `${base} Views are counted from now on.`;
  const since = new Date(d.views.trackedSince);
  return since.getTime() > Date.now() - d.days * 86400e3 ? `${base} Views are counted since ${since.toLocaleDateString()}.` : base;
}

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

function Tile({ label, value, to, children }: { label: string; value: string; to: string; children?: ReactNode }) {
  return (
    <Link to={to} className="block rounded-xl bg-white px-4 py-3 shadow-sm ring-1 ring-slate-200 transition hover:ring-slate-300">
      <div className="text-xs font-medium text-slate-500">{label}</div>
      <div className="mt-1 text-3xl font-semibold text-slate-900">{value}</div>
      <div className="mt-1 text-xs text-slate-500">{children}</div>
    </Link>
  );
}

/** A status is always an icon plus words, never colour alone. */
function Status({ tone, children }: { tone: 'critical'; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 font-medium text-red-700">
      {tone === 'critical' && <AlertTriangle className="size-3.5" />}
      {children}
    </span>
  );
}

function Panel({ title, description, children, actions }: { title: string; description?: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
      <header className="flex flex-wrap items-start justify-between gap-2 px-5 pt-4">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
          {description && <p className="mt-0.5 text-xs text-slate-500">{description}</p>}
        </div>
        {actions}
      </header>
      <div className="px-5 pt-3 pb-4">{children}</div>
    </section>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="py-6 text-center text-sm text-slate-500">{children}</p>;
}

/** Name, bar and figure per row; bars aligned, values printed so nothing hides behind a hover. */
function MeterList({ rows }: { rows: { key: string; name: string; sub?: string; to?: string; pct: number | null; detail: string }[] }) {
  return (
    <ul className="@container space-y-3">
      {rows.map((r) => {
        const name = (
          <>
            <span className="block truncate text-sm font-medium text-slate-800">{r.name}</span>
            {r.sub && <span className="block truncate text-xs text-slate-500">{r.sub}</span>}
          </>
        );
        return (
          <li key={r.key} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 @md:grid-cols-[minmax(0,11rem)_minmax(0,1fr)_6.5rem]" title={`${r.name}: ${r.pct === null ? '—' : `${r.pct}%`} (${r.detail})`}>
            <div className="min-w-0">{r.to ? <Link to={r.to} className="hover:[&>span:first-child]:text-brand">{name}</Link> : name}</div>
            <div className="order-last col-span-2 h-2 overflow-hidden rounded-full @md:order-none @md:col-span-1" style={{ background: 'var(--viz-track)' }} role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={r.pct ?? 0} aria-label={r.name}>
              <div className="h-full rounded-full" style={{ width: `${r.pct ?? 0}%`, background: 'var(--viz-s1)' }} />
            </div>
            <div className="text-right">
              <span className="text-sm font-semibold text-slate-900 tabular-nums">{r.pct === null ? '—' : `${r.pct}%`}</span>
              <span className="block text-[11px] text-slate-500">{r.detail}</span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** Ranked horizontal bars, largest first, one hue, value at the tip. */
function RankedBars({ rows }: { rows: { key: string; name: string; sub?: string; to?: string; value: number; label: string; extra?: string; icon?: ReactNode }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="space-y-3">
      {rows.map((r) => {
        const head = (
          <div className="flex min-w-0 items-baseline justify-between gap-3">
            <span className="truncate text-sm font-medium text-slate-800">{r.name}</span>
            {r.extra && <span className="shrink-0 text-xs text-slate-500 tabular-nums">{r.extra}</span>}
          </div>
        );
        return (
          <li key={r.key} title={`${r.name}${r.sub ? ` (${r.sub})` : ''}: ${r.label}${r.extra ? `, ${r.extra}` : ''}`}>
            {r.to ? (
              <Link to={r.to} className="block hover:[&_span:first-child]:text-brand">
                {head}
              </Link>
            ) : (
              head
            )}
            {r.sub && <div className="truncate text-xs text-slate-500">{r.sub}</div>}
            <div className="mt-1 flex items-center gap-2">
              <div className="h-2.5 rounded-r" style={{ width: `${Math.max(2, (r.value / max) * 85)}%`, background: 'var(--viz-s1)' }} />
              <span className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-slate-700 tabular-nums">
                {r.icon}
                {r.label}
              </span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.floor(e.contentRect.width)));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

function niceMax(v: number): { max: number; step: number } {
  if (v <= 4) return { max: Math.max(v, 1) <= 2 ? 2 : 4, step: 1 };
  const rough = v / 4;
  const pow = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= rough) ?? 10 * pow;
  return { max: Math.ceil(v / step) * step, step };
}

/** Path for a column with a 4px rounded top and a square base. */
function colPath(x: number, y: number, w: number, h: number, round: boolean) {
  const r = round ? Math.min(4, w / 2, h) : 0;
  return `M${x},${y + h}V${y + r}${r ? `Q${x},${y} ${x + r},${y}` : ''}H${x + w - r}${r ? `Q${x + w},${y} ${x + w},${y + r}` : ''}V${y + h}Z`;
}

const PLOT_H = 170;
const AXIS_H = 26;
const LEFT = 34;

function DailyChecklists({ rows }: { rows: { date: string; passed: number; failed: number }[] }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const total = rows.reduce((n, r) => n + r.passed + r.failed, 0);

  const legend = (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600">
      <span className="inline-flex items-center gap-1.5">
        <span className="size-2.5 rounded-sm" style={{ background: 'var(--viz-s1)' }} /> All items passed
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="size-2.5 rounded-sm" style={{ background: 'var(--viz-crit)' }} /> Had a failure
      </span>
      <button type="button" onClick={() => setTable((t) => !t)} className="ml-auto inline-flex items-center gap-1 rounded-md px-2 py-1 font-medium text-slate-600 hover:bg-slate-100" aria-pressed={table}>
        {table ? <BarChart3 className="size-3.5" /> : <Table2 className="size-3.5" />} {table ? 'Chart' : 'Table'}
      </button>
    </div>
  );

  if (!total) return <Empty>No checklists were completed in this period.</Empty>;

  if (table) {
    return (
      <div className="space-y-3">
        {legend}
        <div className="max-h-72 overflow-y-auto">
          <table className="w-full text-sm tabular-nums">
            <thead className="sticky top-0 bg-white text-left text-xs text-slate-500">
              <tr>
                <th className="py-1.5 font-semibold">Day</th>
                <th className="py-1.5 text-right font-semibold">All passed</th>
                <th className="py-1.5 text-right font-semibold">Had a failure</th>
                <th className="py-1.5 text-right font-semibold">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {[...rows].reverse().map((r) => (
                <tr key={r.date}>
                  <td className="py-1.5">{fmtDay(r.date, { weekday: 'short', month: 'short', day: 'numeric' })}</td>
                  <td className="py-1.5 text-right">{r.passed}</td>
                  <td className="py-1.5 text-right">{r.failed}</td>
                  <td className="py-1.5 text-right font-medium">{r.passed + r.failed}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  const { max, step } = niceMax(Math.max(...rows.map((r) => r.passed + r.failed)));
  const plotW = Math.max(0, width - LEFT);
  const band = rows.length ? plotW / rows.length : 0;
  const barW = Math.max(2, Math.min(24, band * 0.62));
  const y = (v: number) => PLOT_H - (v / max) * PLOT_H;
  const ticks = Array.from({ length: Math.round(max / step) + 1 }, (_, i) => i * step);
  const every = rows.length <= 10 ? 1 : Math.ceil(rows.length / Math.max(2, Math.floor(plotW / 64)));
  const h = hover !== null ? rows[hover] : null;

  return (
    <div className="space-y-3">
      {legend}
      <div ref={ref} className="relative" onPointerLeave={() => setHover(null)}>
        {width > 0 && (
          <svg width={width} height={PLOT_H + AXIS_H} role="img" aria-label={`Checklists per day: ${total} completed`} className="block overflow-visible">
            {ticks.map((t) => (
              <g key={t}>
                <line x1={LEFT} x2={width} y1={y(t) + 0.5} y2={y(t) + 0.5} stroke={t === 0 ? 'var(--viz-axis)' : 'var(--viz-grid)'} strokeWidth={1} />
                <text x={LEFT - 8} y={y(t)} dy="0.32em" textAnchor="end" fontSize={11} fill="var(--viz-muted)" style={{ fontVariantNumeric: 'tabular-nums' }}>
                  {t.toLocaleString()}
                </text>
              </g>
            ))}
            {rows.map((r, i) => {
              const x = LEFT + i * band + (band - barW) / 2;
              const pH = (r.passed / max) * PLOT_H;
              const fH = (r.failed / max) * PLOT_H;
              const gap = r.passed && r.failed ? 2 : 0;
              const active = hover === i;
              return (
                <g
                  key={r.date}
                  tabIndex={0}
                  role="img"
                  aria-label={`${fmtDay(r.date, { weekday: 'long', month: 'long', day: 'numeric' })}: ${r.passed} passed, ${r.failed} with a failure`}
                  onPointerEnter={() => setHover(i)}
                  onFocus={() => setHover(i)}
                  onBlur={() => setHover(null)}
                  className="outline-none"
                  opacity={hover === null || active ? 1 : 0.55}
                >
                  {/* The hit area is the whole day, not just the painted column. */}
                  <rect x={LEFT + i * band} y={0} width={band} height={PLOT_H} fill="transparent" />
                  {active && <rect x={LEFT + i * band} y={0} width={band} height={PLOT_H} fill="#0b0b0b" opacity={0.04} />}
                  {r.passed > 0 && <path d={colPath(x, y(r.passed), barW, pH, !r.failed)} fill="var(--viz-s1)" />}
                  {r.failed > 0 && <path d={colPath(x, y(r.passed) - fH, barW, Math.max(0, fH - gap), true)} fill="var(--viz-crit)" />}
                </g>
              );
            })}
            {rows.map((r, i) =>
              i % every === (rows.length - 1) % every ? (
                <text key={r.date} x={LEFT + i * band + band / 2} y={PLOT_H + 17} textAnchor="middle" fontSize={11} fill="var(--viz-muted)">
                  {rows.length <= 7 ? fmtDay(r.date, { weekday: 'short', day: 'numeric' }) : fmtDay(r.date, { month: 'short', day: 'numeric' })}
                </text>
              ) : null,
            )}
          </svg>
        )}
        {h && hover !== null && (
          <div
            className="pointer-events-none absolute top-0 z-10 w-44 rounded-lg bg-white px-3 py-2 text-xs shadow-lg ring-1 ring-slate-200"
            style={{ left: Math.min(Math.max(0, LEFT + hover * band + band / 2 - 88), Math.max(0, width - 176)) }}
          >
            <div className="mb-1 font-medium text-slate-500">{fmtDay(h.date, { weekday: 'short', month: 'short', day: 'numeric' })}</div>
            <TipRow color="var(--viz-crit)" value={h.failed} label="had a failure" />
            <TipRow color="var(--viz-s1)" value={h.passed} label="all passed" />
          </div>
        )}
      </div>
    </div>
  );
}

function TipRow({ color, value, label }: { color: string; value: number; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="h-0.5 w-3 rounded" style={{ background: color }} />
      <span className="font-semibold text-slate-900 tabular-nums">{value}</span>
      <span className="text-slate-500">{label}</span>
    </div>
  );
}
