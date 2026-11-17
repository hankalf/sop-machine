import { useQuery } from '@tanstack/react-query';
import { AlarmClock, BookMarked, BookOpen, FileText, FileUp, LayoutGrid, List, ListChecks, Plus, Search, Sparkles } from 'lucide-react';
import { BinderModal } from '../components/BinderModal';
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { Category, SopSummary } from '@shared/types';
import { api, mediaUrl } from '../api';
import { useCan } from '../auth';
import { isReviewDue, StatusBadge } from '../components/status';
import { useToast } from '../components/Toast';
import { Badge, Button, cx, EmptyState, ErrorText, Field, Input, Modal, PageLoader, Select, timeAgo } from '../components/ui';
import { useDebounced } from '../hooks';

const STATUS_FILTERS = [
  { value: '', label: 'All' },
  { value: 'draft', label: 'Drafts' },
  { value: 'review', label: 'In review' },
  { value: 'approved', label: 'Approved' },
  { value: 'archived', label: 'Archived' },
];

export default function LibraryPage() {
  const isEditor = useCan('editor');
  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [status, setStatus] = useState('');
  const [view, setView] = useState<'grid' | 'list'>(() => (localStorage.getItem('sop:view') as 'grid' | 'list') ?? 'grid');
  const [creating, setCreating] = useState(false);
  const [binder, setBinder] = useState(false);
  const debounced = useDebounced(search, 250);

  const categories = useQuery({ queryKey: ['categories'], queryFn: api.categories.list });
  const all = useQuery({ queryKey: ['sops', 'all'], queryFn: () => api.sops.list({}) });
  const sops = useQuery({
    queryKey: ['sops', debounced, categoryId, status],
    queryFn: () => api.sops.list({ search: debounced, categoryId, status }),
    placeholderData: (prev) => prev,
  });

  const catMap = useMemo(() => new Map((categories.data ?? []).map((c) => [c.id, c])), [categories.data]);
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of all.data ?? []) m.set(s.categoryId ?? '', (m.get(s.categoryId ?? '') ?? 0) + 1);
    return m;
  }, [all.data]);
  const stats = useMemo(() => {
    const list = all.data ?? [];
    return {
      total: list.length,
      approved: list.filter((s) => s.status === 'approved').length,
      review: list.filter((s) => s.status === 'review').length,
      due: list.filter((s) => s.status === 'approved' && isReviewDue(s.reviewDate)).length,
    };
  }, [all.data]);

  const setViewMode = (v: 'grid' | 'list') => {
    setView(v);
    localStorage.setItem('sop:view', v);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">SOP Library</h1>
          <p className="text-sm text-slate-500">Every standard operating procedure in one place, from computer systems to the trailer dock.</p>
        </div>
        {!isEditor && (
          <Button icon={<BookMarked className="size-4" />} onClick={() => setBinder(true)}>
            Export binder
          </Button>
        )}
        {isEditor && (
          <div className="flex flex-wrap gap-2">
            <Button icon={<BookMarked className="size-4" />} onClick={() => setBinder(true)}>
              Export binder
            </Button>
            <Link to="/generate?tab=import">
              <Button icon={<FileUp className="size-4" />}>Import existing SOPs</Button>
            </Link>
            <Link to="/generate">
              <Button variant="subtle" icon={<Sparkles className="size-4" />}>
                Generate with AI
              </Button>
            </Link>
            <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
              New SOP
            </Button>
          </div>
        )}
      </div>

      {isEditor && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="Total SOPs" value={stats.total} />
          <Stat label="Approved" value={stats.approved} tone="text-emerald-700" onClick={() => setStatus('approved')} />
          <Stat label="Waiting for review" value={stats.review} tone="text-blue-700" onClick={() => setStatus('review')} />
          <Stat label="Review due in 30 days" value={stats.due} tone={stats.due ? 'text-amber-700' : undefined} icon={<AlarmClock className="size-4" />} />
        </div>
      )}

      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-60 flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
            <Input placeholder="Search titles, steps, numbers, tags…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
          </div>
          {isEditor && (
            <div className="flex rounded-lg bg-white p-0.5 ring-1 ring-slate-200">
              {STATUS_FILTERS.map((f) => (
                <button key={f.value} onClick={() => setStatus(f.value)} className={cx('rounded-md px-2.5 py-1.5 text-xs font-medium', status === f.value ? 'bg-brand text-white' : 'text-slate-600 hover:bg-slate-100')}>
                  {f.label}
                </button>
              ))}
            </div>
          )}
          <div className="flex rounded-lg bg-white p-0.5 ring-1 ring-slate-200">
            <button onClick={() => setViewMode('grid')} className={cx('rounded-md p-1.5', view === 'grid' ? 'bg-slate-100 text-slate-900' : 'text-slate-400')} aria-label="Grid view">
              <LayoutGrid className="size-4" />
            </button>
            <button onClick={() => setViewMode('list')} className={cx('rounded-md p-1.5', view === 'list' ? 'bg-slate-100 text-slate-900' : 'text-slate-400')} aria-label="List view">
              <List className="size-4" />
            </button>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <CategoryChip active={!categoryId} onClick={() => setCategoryId('')} label="All categories" count={all.data?.length} />
          {(categories.data ?? []).map((c) => (
            <CategoryChip key={c.id} active={categoryId === c.id} color={c.color} onClick={() => setCategoryId(categoryId === c.id ? '' : c.id)} label={c.name} count={counts.get(c.id) ?? 0} />
          ))}
        </div>
      </div>

      {sops.isLoading ? (
        <PageLoader />
      ) : sops.error ? (
        <ErrorText error={sops.error} />
      ) : !sops.data?.length ? (
        <EmptyState
          icon={<BookOpen className="size-10" />}
          title={search || categoryId || status ? 'No SOPs match these filters' : 'No SOPs yet'}
          action={
            isEditor && !search ? (
              <div className="flex gap-2">
                <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
                  Write one
                </Button>
                <Link to="/generate">
                  <Button variant="subtle" icon={<Sparkles className="size-4" />}>
                    Generate from a recording
                  </Button>
                </Link>
              </div>
            ) : undefined
          }
        >
          {isEditor ? 'Create an SOP by hand, or upload a screen recording and let AI write the first draft.' : 'Approved SOPs will show up here.'}
        </EmptyState>
      ) : view === 'grid' ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {sops.data.map((s) => (
            <SopCard key={s.id} sop={s} category={catMap.get(s.categoryId ?? '')} />
          ))}
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs font-semibold text-slate-500">
              <tr>
                <th className="px-4 py-2.5">Number</th>
                <th className="px-4 py-2.5">Title</th>
                <th className="hidden px-4 py-2.5 md:table-cell">Category</th>
                <th className="px-4 py-2.5">Status</th>
                <th className="hidden px-4 py-2.5 sm:table-cell">Rev</th>
                <th className="hidden px-4 py-2.5 lg:table-cell">Updated</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {sops.data.map((s) => {
                const c = catMap.get(s.categoryId ?? '');
                return (
                  <tr key={s.id} className="hover:bg-slate-50">
                    <td className="px-4 py-2.5 font-mono text-xs text-slate-500">{s.number}</td>
                    <td className="px-4 py-2.5">
                      <Link to={`/sops/${s.id}`} className="font-medium text-slate-900 hover:text-brand">
                        {s.title}
                      </Link>
                    </td>
                    <td className="hidden px-4 py-2.5 md:table-cell">{c && <Badge color={c.color}>{c.name}</Badge>}</td>
                    <td className="px-4 py-2.5">
                      <StatusBadge status={s.status} />
                    </td>
                    <td className="hidden px-4 py-2.5 text-slate-500 sm:table-cell">{s.version}</td>
                    <td className="hidden px-4 py-2.5 text-slate-500 lg:table-cell">{timeAgo(s.updatedAt)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <NewSopModal open={creating} onClose={() => setCreating(false)} categories={categories.data ?? []} defaultCategory={categoryId} />
      {binder && <BinderModal open onClose={() => setBinder(false)} categories={categories.data ?? []} defaultCategory={categoryId} />}
    </div>
  );
}

function Stat({ label, value, tone, icon, onClick }: { label: string; value: number; tone?: string; icon?: React.ReactNode; onClick?: () => void }) {
  return (
    <button onClick={onClick} disabled={!onClick} className="rounded-xl bg-white px-4 py-3 text-left shadow-sm ring-1 ring-slate-200 transition enabled:hover:ring-brand/40">
      <div className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
        {icon}
        {label}
      </div>
      <div className={cx('mt-1 text-2xl font-bold', tone ?? 'text-slate-900')}>{value}</div>
    </button>
  );
}

function CategoryChip({ active, label, count, color, onClick }: { active: boolean; label: string; count?: number; color?: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cx('inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium ring-1 transition', active ? 'bg-slate-900 text-white ring-slate-900' : 'bg-white text-slate-700 ring-slate-200 hover:ring-slate-400')}
    >
      {color && <span className="size-2 rounded-full" style={{ background: color }} />}
      {label}
      {count !== undefined && <span className={cx('rounded-full px-1.5 text-[10px]', active ? 'bg-white/20' : 'bg-slate-100 text-slate-500')}>{count}</span>}
    </button>
  );
}

function SopCard({ sop, category }: { sop: SopSummary; category?: Category }) {
  const due = sop.status === 'approved' && isReviewDue(sop.reviewDate);
  return (
    <Link to={`/sops/${sop.id}`} className="group flex flex-col overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-slate-200 transition hover:-translate-y-0.5 hover:shadow-md hover:ring-brand/30">
      <div className="relative aspect-[16/9] overflow-hidden bg-slate-100">
        {sop.coverMediaId ? (
          <img src={mediaUrl(sop.coverMediaId, 'thumb')} alt="" className="size-full object-cover transition group-hover:scale-[1.02]" loading="lazy" />
        ) : (
          <div className="flex size-full items-center justify-center" style={{ background: `color-mix(in srgb, ${category?.color ?? '#64748b'} 12%, white)` }}>
            <FileText className="size-10" style={{ color: category?.color ?? '#64748b' }} />
          </div>
        )}
        <div className="absolute top-2 left-2 flex gap-1.5">
          <StatusBadge status={sop.status} className="shadow-sm" />
          {sop.checklist && (
            <span className="inline-flex items-center gap-1 rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-semibold text-sky-800 shadow-sm">
              <ListChecks className="size-3" /> Checklist
            </span>
          )}
          {sop.source !== 'manual' && (
            <span className="inline-flex items-center gap-1 rounded-full bg-violet-100 px-2 py-0.5 text-[11px] font-semibold text-violet-800 shadow-sm">
              <Sparkles className="size-3" /> AI
            </span>
          )}
        </div>
        {due && <span className="absolute top-2 right-2 rounded-full bg-amber-400 px-2 py-0.5 text-[11px] font-semibold text-amber-950 shadow-sm">Review due</span>}
      </div>
      <div className="flex flex-1 flex-col gap-2 p-4">
        <div className="flex items-center justify-between gap-2">
          <span className="font-mono text-[11px] text-slate-500">{sop.number}</span>
          {category && <Badge color={category.color}>{category.name}</Badge>}
        </div>
        <h3 className="line-clamp-2 font-semibold text-slate-900 group-hover:text-brand">{sop.title}</h3>
        <div className="mt-auto flex items-center justify-between pt-1 text-xs text-slate-500">
          <span>
            Rev {sop.version} · {sop.stepCount} steps
          </span>
          <span>{timeAgo(sop.updatedAt)}</span>
        </div>
      </div>
    </Link>
  );
}

function NewSopModal({ open, onClose, categories, defaultCategory }: { open: boolean; onClose: () => void; categories: Category[]; defaultCategory: string }) {
  const [title, setTitle] = useState('');
  const [categoryId, setCategoryId] = useState(defaultCategory);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const navigate = useNavigate();
  const toast = useToast();
  const create = async () => {
    if (!title.trim()) return setError(new Error('Give the SOP a title'));
    setBusy(true);
    try {
      const sop = await api.sops.create({ title: title.trim(), categoryId: categoryId || null });
      toast.success(`Created ${sop.number}`);
      navigate(`/sops/${sop.id}/edit`);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New SOP"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={create} loading={busy}>
            Create and edit
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Title">
          <Input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Trailer pre-load inspection" onKeyDown={(e) => e.key === 'Enter' && create()} />
        </Field>
        <Field label="Category" hint="The category sets the SOP number prefix and its default template.">
          <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">No category</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.code})
              </option>
            ))}
          </Select>
        </Field>
        <ErrorText error={error} />
      </div>
    </Modal>
  );
}
