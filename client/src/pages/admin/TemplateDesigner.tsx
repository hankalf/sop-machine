import { closestCenter, DndContext, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { arrayMove, SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  BookOpen,
  ChevronDown,
  FileText,
  GripVertical,
  Image as ImageIcon,
  LayoutList,
  ListOrdered,
  Monitor,
  Palette,
  PanelTop,
  Printer,
  RotateCcw,
  Save,
  Star,
  Stamp,
  Type,
} from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { FontKey, SectionConfig, TemplateDesign } from '@shared/types';
import { FONT_OPTIONS, SECTION_DEFAULT_LABELS, SECTION_DESCRIPTIONS, TEMPLATE_TOKENS, defaultDesign } from '@shared/defaults';
import { api } from '../../api';
import { useAuth } from '../../auth';
import { LivePreview } from '../../components/LivePreview';
import { useToast } from '../../components/Toast';
import { Badge, Button, ColorInput, cx, ErrorText, Field, Input, PageLoader, Segmented, Select, Toggle } from '../../components/ui';
import { useDebounced, useUnsavedWarning } from '../../hooks';

const PALETTES: { name: string; primary: string; accent: string; badge: string; badgeText: string }[] = [
  { name: 'Navy & amber', primary: '#1e3a8a', accent: '#f59e0b', badge: '#1e3a8a', badgeText: '#ffffff' },
  { name: 'Teal & sky', primary: '#0f766e', accent: '#0ea5e9', badge: '#0ea5e9', badgeText: '#ffffff' },
  { name: 'Safety black & yellow', primary: '#111827', accent: '#facc15', badge: '#facc15', badgeText: '#111827' },
  { name: 'Fire red', primary: '#b91c1c', accent: '#f97316', badge: '#b91c1c', badgeText: '#ffffff' },
  { name: 'Forest', primary: '#166534', accent: '#84cc16', badge: '#166534', badgeText: '#ffffff' },
  { name: 'Royal', primary: '#5b21b6', accent: '#f472b6', badge: '#5b21b6', badgeText: '#ffffff' },
  { name: 'Graphite', primary: '#334155', accent: '#94a3b8', badge: '#334155', badgeText: '#ffffff' },
];

const WORD_FONTS = ['Calibri', 'Aptos', 'Arial', 'Segoe UI', 'Verdana', 'Georgia', 'Times New Roman'];

export default function TemplateDesigner() {
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const toast = useToast();
  const { branding } = useAuth();
  const template = useQuery({ queryKey: ['template', id], queryFn: async () => (await api.templates.list()).find((t) => t.id === id) ?? null });
  const sops = useQuery({ queryKey: ['sops', 'all'], queryFn: () => api.sops.list({}) });

  const [design, setDesign] = useState<TemplateDesign | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [previewSop, setPreviewSop] = useState<string>('');
  const [mode, setMode] = useState<'paged' | 'web'>('paged');
  const [pages, setPages] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (template.data && !design) {
      setDesign(structuredClone(template.data.design));
      setName(template.data.name);
      setDescription(template.data.description);
    }
  }, [template.data, design]);

  const dirty = !!design && !!template.data && (JSON.stringify(design) !== JSON.stringify(template.data.design) || name !== template.data.name || description !== template.data.description);
  useUnsavedWarning(dirty);

  const debounced = useDebounced(design, 300);
  const preview = useQuery({
    queryKey: ['template-preview', JSON.stringify(debounced), previewSop, mode],
    queryFn: () => api.templates.preview({ design: debounced!, sopId: previewSop || null, mode }),
    enabled: !!debounced,
    placeholderData: (prev) => prev,
    staleTime: Infinity,
  });

  const up = <K extends keyof TemplateDesign>(key: K, patch: Partial<TemplateDesign[K]>) => setDesign((d) => (d ? { ...d, [key]: { ...d[key], ...patch } } : d));

  const save = async () => {
    if (!design) return;
    setSaving(true);
    try {
      const t = await api.templates.update(id, { name: name.trim() || 'Untitled template', description, design });
      qc.setQueryData(['template', id], t);
      void qc.invalidateQueries({ queryKey: ['templates'] });
      setDesign(structuredClone(t.design));
      toast.success('Template saved. Every SOP using it now exports with this design.');
    } catch (e) {
      toast.error(e);
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void save();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (template.isLoading) return <PageLoader />;
  if (!template.data) return <div className="p-6"><ErrorText error="Template not found" /></div>;
  if (!design) return <PageLoader />;
  const d = design;

  return (
    <div className="flex h-screen flex-col bg-slate-100">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-3 sm:px-4">
        <Link to="/admin/templates" className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900" aria-label="Back to templates">
          <ArrowLeft className="size-5" />
        </Link>
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-semibold tracking-wide text-slate-500 uppercase">Template designer</div>
          <input value={name} onChange={(e) => setName(e.target.value)} className="w-full max-w-md truncate bg-transparent text-sm font-semibold outline-none focus:underline" />
        </div>
        {template.data.isDefault ? (
          <Badge color="#16a34a">
            <Star className="size-3" /> Default
          </Badge>
        ) : (
          <Button size="sm" variant="ghost" icon={<Star className="size-4" />} onClick={() => api.templates.update(id, { isDefault: true }).then(() => { void qc.invalidateQueries({ queryKey: ['template', id] }); toast.success('This is now the default template'); })}>
            Make default
          </Button>
        )}
        {dirty && (
          <Button size="sm" variant="ghost" icon={<RotateCcw className="size-4" />} onClick={() => { setDesign(structuredClone(template.data!.design)); setName(template.data!.name); setDescription(template.data!.description); }}>
            Discard
          </Button>
        )}
        <Button size="sm" variant="primary" icon={<Save className="size-4" />} onClick={save} loading={saving} disabled={!dirty}>
          {dirty ? 'Save template' : 'Saved'}
        </Button>
      </header>

      <div className="grid min-h-0 flex-1 md:grid-cols-[400px_minmax(0,1fr)] xl:grid-cols-[440px_minmax(0,1fr)]">
        {/* Controls */}
        <div className="min-h-0 overflow-y-auto border-r border-slate-200 bg-white scrollbar-thin">
          <div className="space-y-px">
            <Panel icon={<FileText className="size-4" />} title="About" defaultOpen={false}>
              <Field label="Description">
                <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="When to use this template" />
              </Field>
            </Panel>

            <Panel icon={<Palette className="size-4" />} title="Colors">
              <div className="grid grid-cols-4 gap-2">
                {PALETTES.map((p) => (
                  <button
                    key={p.name}
                    title={p.name}
                    onClick={() => up('colors', { primary: p.primary, accent: p.accent, stepBadge: p.badge, stepBadgeText: p.badgeText })}
                    className={cx('overflow-hidden rounded-lg ring-1 transition hover:scale-105', d.colors.primary === p.primary && d.colors.accent === p.accent ? 'ring-2 ring-slate-900' : 'ring-slate-200')}
                  >
                    <div className="h-6" style={{ background: p.primary }} />
                    <div className="h-2" style={{ background: p.accent }} />
                  </button>
                ))}
                {branding?.appColor && (
                  <button title="Use the app accent color" onClick={() => up('colors', { primary: branding.appColor, stepBadge: branding.appColor })} className="flex items-center justify-center rounded-lg text-[10px] font-semibold text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50">
                    Brand
                  </button>
                )}
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3">
                <ColorInput label="Primary" value={d.colors.primary} onChange={(v) => up('colors', { primary: v })} />
                <ColorInput label="Accent" value={d.colors.accent} onChange={(v) => up('colors', { accent: v })} />
                <ColorInput label="Step number" value={d.colors.stepBadge} onChange={(v) => up('colors', { stepBadge: v })} />
                <ColorInput label="Step number text" value={d.colors.stepBadgeText} onChange={(v) => up('colors', { stepBadgeText: v })} />
                <ColorInput label="Body text" value={d.colors.text} onChange={(v) => up('colors', { text: v })} />
                <ColorInput label="Muted text" value={d.colors.muted} onChange={(v) => up('colors', { muted: v })} />
              </div>
            </Panel>

            <Panel icon={<Type className="size-4" />} title="Typography">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Headings">
                  <FontSelect value={d.typography.headingFont} onChange={(v) => up('typography', { headingFont: v })} />
                </Field>
                <Field label="Body text">
                  <FontSelect value={d.typography.bodyFont} onChange={(v) => up('typography', { bodyFont: v })} />
                </Field>
              </div>
              <Range label="Text size" value={d.typography.baseSize} min={8} max={14} step={0.5} unit="pt" onChange={(v) => up('typography', { baseSize: v })} />
              <Range label="Line spacing" value={d.typography.lineHeight} min={1.1} max={2} step={0.05} onChange={(v) => up('typography', { lineHeight: v })} />
              <Toggle checked={d.style.uppercaseHeadings} onChange={(v) => up('style', { uppercaseHeadings: v })} label="Uppercase section headings" />
              <Field label="Word export font" hint="Word uses fonts installed on the reader's computer, so pick a common one.">
                <Select value={d.word.font} onChange={(e) => up('word', { font: e.target.value })}>
                  {WORD_FONTS.map((f) => (
                    <option key={f}>{f}</option>
                  ))}
                </Select>
              </Field>
            </Panel>

            <Panel icon={<LayoutList className="size-4" />} title="Headings & callouts">
              <Field group label="Section heading style">
                <div className="grid grid-cols-4 gap-2">
                  {(['underline', 'band', 'leftbar', 'plain'] as const).map((s) => (
                    <Choice key={s} active={d.style.headingStyle === s} onClick={() => up('style', { headingStyle: s })} label={{ underline: 'Underline', band: 'Band', leftbar: 'Side bar', plain: 'Plain' }[s]}>
                      <HeadingSample style={s} primary={d.colors.primary} accent={d.colors.accent} />
                    </Choice>
                  ))}
                </div>
              </Field>
              <Field group label="Warning & tip boxes">
                <Segmented value={d.style.calloutStyle} onChange={(v) => up('style', { calloutStyle: v })} options={[{ value: 'filled', label: 'Filled' }, { value: 'outlined', label: 'Outlined' }]} />
              </Field>
              <Range label="Corner rounding" value={d.style.cornerRadius} min={0} max={16} step={1} unit="px" onChange={(v) => up('style', { cornerRadius: v })} />
            </Panel>

            <Panel icon={<ListOrdered className="size-4" />} title="Steps & images">
              <Field group label="Step number style">
                <div className="grid grid-cols-3 gap-2">
                  {(['badge', 'label', 'card'] as const).map((s) => (
                    <Choice key={s} active={d.style.stepStyle === s} onClick={() => up('style', { stepStyle: s })} label={{ badge: 'Circle', label: 'Label', card: 'Card' }[s]}>
                      <StepSample style={s} badge={d.colors.stepBadge} badgeText={d.colors.stepBadgeText} primary={d.colors.primary} />
                    </Choice>
                  ))}
                </div>
              </Field>
              <Field group label="Image placement">
                <div className="grid grid-cols-3 gap-2">
                  <Choice active={d.steps.layout === 'side-by-side' && d.steps.imagePosition === 'right'} onClick={() => up('steps', { layout: 'side-by-side', imagePosition: 'right' })} label="Right">
                    <LayoutSample kind="right" />
                  </Choice>
                  <Choice active={d.steps.layout === 'side-by-side' && d.steps.imagePosition === 'left'} onClick={() => up('steps', { layout: 'side-by-side', imagePosition: 'left' })} label="Left">
                    <LayoutSample kind="left" />
                  </Choice>
                  <Choice active={d.steps.layout === 'stacked'} onClick={() => up('steps', { layout: 'stacked' })} label="Below">
                    <LayoutSample kind="below" />
                  </Choice>
                </div>
              </Field>
              <Field group label="Image size">
                <Segmented value={d.steps.imageSize} onChange={(v) => up('steps', { imageSize: v })} options={[{ value: 'small', label: 'Small' }, { value: 'medium', label: 'Medium' }, { value: 'large', label: 'Large' }]} />
              </Field>
              <Toggle checked={d.steps.imageBorder} onChange={(v) => up('steps', { imageBorder: v })} label="Border around images" />
              <Toggle checked={d.steps.showDividers} onChange={(v) => up('steps', { showDividers: v })} label="Divider lines between steps" />
              <Toggle checked={d.steps.keepTogether} onChange={(v) => up('steps', { keepTogether: v })} label="Keep each step on one page" description="Avoids splitting a step and its image across pages." />
            </Panel>

            <Panel icon={<BookOpen className="size-4" />} title="Cover page">
              <Toggle checked={d.cover.enabled} onChange={(v) => up('cover', { enabled: v })} label="Include a cover page" />
              {d.cover.enabled && (
                <>
                  <div className="grid grid-cols-3 gap-2">
                    {(['band', 'centered', 'full'] as const).map((s) => (
                      <Choice key={s} active={d.cover.style === s} onClick={() => up('cover', { style: s })} label={{ band: 'Banner', centered: 'Centered', full: 'Full color' }[s]}>
                        <CoverSample style={s} primary={d.colors.primary} accent={d.colors.accent} />
                      </Choice>
                    ))}
                  </div>
                  <Field label="Document type label">
                    <Input value={d.cover.subtitle} onChange={(e) => up('cover', { subtitle: e.target.value })} />
                  </Field>
                  <Toggle checked={d.cover.showQr} onChange={(v) => up('cover', { showQr: v })} label="QR code to the latest version" description="Scanning a printed copy opens the current SOP, so outdated printouts are easy to spot." />
                </>
              )}
            </Panel>

            <Panel icon={<PanelTop className="size-4" />} title="Header & footer">
              <Toggle checked={d.header.enabled} onChange={(v) => up('header', { enabled: v })} label="Page header" />
              {d.header.enabled && (
                <>
                  <Toggle checked={d.header.showLogo} onChange={(v) => up('header', { showLogo: v })} label="Logo in header" />
                  <TokenField label="Header left" value={d.header.left} onChange={(v) => up('header', { left: v })} />
                  <TokenField label="Header right" value={d.header.right} onChange={(v) => up('header', { right: v })} />
                </>
              )}
              <div className="border-t border-slate-100 pt-3" />
              <Toggle checked={d.footer.enabled} onChange={(v) => up('footer', { enabled: v })} label="Page footer" />
              {d.footer.enabled && (
                <>
                  <TokenField label="Footer text" value={d.footer.left} onChange={(v) => up('footer', { left: v })} />
                  <TokenField label="Footer emphasis" value={d.footer.center} onChange={(v) => up('footer', { center: v })} />
                  <Toggle checked={d.footer.showPageNumbers} onChange={(v) => up('footer', { showPageNumbers: v })} label="Page X of Y" />
                </>
              )}
            </Panel>

            <Panel icon={<LayoutList className="size-4" />} title="Sections">
              <p className="text-xs text-slate-500">Drag to reorder, rename to match your site's terms, or switch sections off. Empty sections are skipped automatically.</p>
              <SectionsEditor sections={d.sections} onChange={(sections) => setDesign({ ...d, sections })} />
            </Panel>

            <Panel icon={<Printer className="size-4" />} title="Page setup">
              <Field group label="Paper size">
                <Segmented value={d.page.size} onChange={(v) => up('page', { size: v })} options={[{ value: 'Letter', label: 'Letter' }, { value: 'A4', label: 'A4' }, { value: 'Legal', label: 'Legal' }]} />
              </Field>
              <Field group label="Orientation">
                <Segmented value={d.page.orientation} onChange={(v) => up('page', { orientation: v })} options={[{ value: 'portrait', label: 'Portrait' }, { value: 'landscape', label: 'Landscape' }]} />
              </Field>
              <Field group label="Margins">
                <Segmented value={d.page.margins} onChange={(v) => up('page', { margins: v })} options={[{ value: 'narrow', label: 'Narrow' }, { value: 'normal', label: 'Normal' }, { value: 'wide', label: 'Wide' }]} />
              </Field>
            </Panel>

            <Panel icon={<Stamp className="size-4" />} title="Watermark">
              <Toggle checked={d.watermark.enabled} onChange={(v) => up('watermark', { enabled: v })} label="Watermark unapproved copies" description="Drafts print with this word across each page. Archived SOPs print as OBSOLETE." />
              {d.watermark.enabled && (
                <Field label="Draft watermark text">
                  <Input value={d.watermark.text} onChange={(e) => up('watermark', { text: e.target.value.toUpperCase() })} />
                </Field>
              )}
            </Panel>

            <div className="p-4">
              <Button variant="ghost" size="sm" icon={<RotateCcw className="size-3.5" />} onClick={() => confirm('Reset every setting in this template to the standard defaults?') && setDesign(defaultDesign())}>
                Reset to standard defaults
              </Button>
            </div>
          </div>
        </div>

        {/* Preview */}
        <div className="flex min-h-0 flex-col">
          <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 bg-white px-4 py-2">
            <div className="w-56">
              <Segmented
                size="sm"
                value={mode}
                onChange={setMode}
                options={[
                  { value: 'paged', label: <><Printer className="size-3.5" /> Print / PDF</> },
                  { value: 'web', label: <><Monitor className="size-3.5" /> Digital</> },
                ]}
              />
            </div>
            <label className="flex items-center gap-2 text-xs text-slate-500">
              Preview with
              <Select value={previewSop} onChange={(e) => setPreviewSop(e.target.value)} className="h-8 w-60 text-xs">
                <option value="">Sample SOP (trailer check-in)</option>
                {sops.data?.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.number} · {s.title}
                  </option>
                ))}
              </Select>
            </label>
            {mode === 'paged' && pages !== null && (
              <span className="ml-auto inline-flex items-center gap-1 text-xs text-slate-500">
                <ImageIcon className="size-3.5" /> {pages} page{pages === 1 ? '' : 's'}
              </span>
            )}
          </div>
          {preview.error ? (
            <div className="p-4"><ErrorText error={preview.error} /></div>
          ) : (
            <LivePreview src={preview.data?.url ?? null} paged={mode === 'paged'} className="min-h-0 flex-1" onPages={setPages} />
          )}
        </div>
      </div>
    </div>
  );
}

function Panel({ icon, title, children, defaultOpen = true }: { icon: ReactNode; title: string; children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="border-b border-slate-100">
      <button onClick={() => setOpen(!open)} className="flex w-full items-center gap-2.5 px-4 py-3 text-left text-sm font-semibold text-slate-800 hover:bg-slate-50">
        <span className="text-slate-400">{icon}</span>
        {title}
        <ChevronDown className={cx('ml-auto size-4 text-slate-400 transition', open && 'rotate-180')} />
      </button>
      {open && <div className="space-y-4 px-4 pb-5">{children}</div>}
    </section>
  );
}

function Choice({ active, onClick, label, children }: { active: boolean; onClick: () => void; label: string; children: ReactNode }) {
  return (
    <button onClick={onClick} className={cx('rounded-lg p-1.5 text-center ring-1 transition', active ? 'bg-brand/5 ring-2 ring-brand' : 'ring-slate-200 hover:ring-slate-400')}>
      <div className="flex h-12 items-center justify-center overflow-hidden rounded bg-white">{children}</div>
      <div className={cx('mt-1 text-[11px] font-medium', active ? 'text-brand' : 'text-slate-600')}>{label}</div>
    </button>
  );
}

function HeadingSample({ style, primary, accent }: { style: string; primary: string; accent: string }) {
  const text = <span className="text-[9px] font-bold">Scope</span>;
  if (style === 'band') return <div className="w-[85%] rounded-sm px-1.5 py-0.5 text-left text-white" style={{ background: primary }}>{text}</div>;
  if (style === 'leftbar') return <div className="w-[85%] border-l-[3px] pl-1.5 text-left" style={{ borderColor: accent, color: primary }}>{text}</div>;
  if (style === 'underline') return <div className="w-[85%] border-b-2 text-left" style={{ borderColor: accent, color: primary }}>{text}</div>;
  return <div className="w-[85%] text-left" style={{ color: primary }}>{text}</div>;
}

function StepSample({ style, badge, badgeText, primary }: { style: string; badge: string; badgeText: string; primary: string }) {
  if (style === 'label')
    return (
      <div className="w-[80%] text-left">
        <span className="rounded-sm px-1 text-[7px] font-bold tracking-wider" style={{ background: badge, color: badgeText }}>STEP 1</span>
        <div className="mt-0.5 h-1.5 w-3/4 rounded bg-slate-300" />
      </div>
    );
  return (
    <div className={cx('flex w-[85%] items-center gap-1', style === 'card' && 'rounded border border-t-2 border-slate-200 p-1')} style={style === 'card' ? { borderTopColor: primary } : undefined}>
      <span className={cx('flex size-3.5 items-center justify-center text-[7px] font-bold', style === 'card' ? 'rounded-sm' : 'rounded-full')} style={{ background: badge, color: badgeText }}>1</span>
      <div className="h-1.5 flex-1 rounded bg-slate-300" />
    </div>
  );
}

function LayoutSample({ kind }: { kind: 'left' | 'right' | 'below' }) {
  const lines = (
    <div className="flex-1 space-y-1">
      <div className="h-1 rounded bg-slate-300" />
      <div className="h-1 w-4/5 rounded bg-slate-300" />
      <div className="h-1 w-3/5 rounded bg-slate-300" />
    </div>
  );
  const img = <div className="h-6 w-7 shrink-0 rounded-sm bg-sky-200" />;
  if (kind === 'below')
    return (
      <div className="w-[80%] space-y-1">
        <div className="h-1 rounded bg-slate-300" />
        <div className="h-5 rounded-sm bg-sky-200" />
      </div>
    );
  return <div className="flex w-[85%] items-center gap-1">{kind === 'left' ? <>{img}{lines}</> : <>{lines}{img}</>}</div>;
}

function CoverSample({ style, primary, accent }: { style: string; primary: string; accent: string }) {
  if (style === 'full')
    return (
      <div className="h-full w-8 p-1" style={{ background: primary }}>
        <div className="mt-3 border-l-2 pl-0.5" style={{ borderColor: accent }}>
          <div className="h-1 w-4 rounded bg-white/90" />
        </div>
      </div>
    );
  if (style === 'centered')
    return (
      <div className="h-full w-8 border-t-[3px] bg-white p-1 ring-1 ring-slate-200" style={{ borderColor: primary }}>
        <div className="mx-auto mt-2 h-1 w-5 rounded" style={{ background: primary }} />
        <div className="mx-auto mt-1 h-0.5 w-3" style={{ background: accent }} />
      </div>
    );
  return (
    <div className="h-full w-8 bg-white ring-1 ring-slate-200">
      <div className="h-3" style={{ background: primary }} />
      <div className="h-0.5" style={{ background: accent }} />
      <div className="mt-2 ml-1 h-1 w-5 rounded" style={{ background: primary }} />
    </div>
  );
}

function FontSelect({ value, onChange }: { value: FontKey; onChange: (v: FontKey) => void }) {
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value as FontKey)}>
      {FONT_OPTIONS.map((f) => (
        <option key={f.key} value={f.key}>
          {f.label}
        </option>
      ))}
    </Select>
  );
}

function Range({ label, value, min, max, step, unit = '', onChange }: { label: string; value: number; min: number; max: number; step: number; unit?: string; onChange: (v: number) => void }) {
  return (
    <label className="block">
      <span className="mb-1 flex justify-between text-xs font-semibold text-slate-600">
        {label}
        <span className="font-mono font-normal text-slate-500">
          {value}
          {unit}
        </span>
      </span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="w-full accent-[var(--brand)]" />
    </label>
  );
}

function TokenField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <Field label={label}>
      <Input value={value} onChange={(e) => onChange(e.target.value)} />
      <div className="mt-1.5 flex flex-wrap gap-1">
        {TEMPLATE_TOKENS.map((t) => (
          <button key={t.token} type="button" title={t.description} onClick={() => onChange(`${value}${value && !value.endsWith(' ') ? ' ' : ''}${t.token}`)} className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-600 hover:bg-brand/10 hover:text-brand">
            {t.token}
          </button>
        ))}
      </div>
    </Field>
  );
}

function SectionRow({ section, onChange }: { section: SectionConfig; onChange: (s: SectionConfig) => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: section.key });
  return (
    <li ref={setNodeRef} style={{ transform: CSS.Translate.toString(transform), transition }} className={cx('flex items-center gap-2 rounded-lg bg-white px-2 py-1.5 ring-1 ring-slate-200', isDragging && 'z-10 shadow-lg', !section.enabled && 'opacity-60')}>
      <button className="cursor-grab touch-none text-slate-400 hover:text-slate-700" {...attributes} {...listeners} aria-label="Drag to reorder">
        <GripVertical className="size-4" />
      </button>
      <div className="min-w-0 flex-1">
        <input
          value={section.label}
          onChange={(e) => onChange({ ...section, label: e.target.value })}
          placeholder={SECTION_DEFAULT_LABELS[section.key]}
          className="w-full bg-transparent text-sm font-medium outline-none focus:underline"
        />
        <div className="truncate text-[11px] text-slate-500">{SECTION_DESCRIPTIONS[section.key]}</div>
      </div>
      <Toggle checked={section.enabled} onChange={(v) => onChange({ ...section, enabled: v })} />
    </li>
  );
}

function SectionsEditor({ sections, onChange }: { sections: SectionConfig[]; onChange: (s: SectionConfig[]) => void }) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
  const ids = useMemo(() => sections.map((s) => s.key), [sections]);
  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    onChange(arrayMove(sections, ids.indexOf(e.active.id as never), ids.indexOf(e.over.id as never)));
  };
  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <ul className="space-y-1.5">
          {sections.map((s) => (
            <SectionRow key={s.key} section={s} onChange={(next) => onChange(sections.map((x) => (x.key === s.key ? next : x)))} />
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  );
}
