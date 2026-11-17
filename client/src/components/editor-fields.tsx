import { Baseline, Bold, Italic, List, ListOrdered, Plus, Table2, X } from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { TEXT_COLORS, type TextColor } from '@shared/defaults';
import { findTables, placeTable, toMarkdown, type TableModel } from './markdownTable';
import { TableEditor } from './TableEditor';
import { cx } from './ui';

const COLOR_NAMES = Object.keys(TEXT_COLORS) as TextColor[];
const COLOR_SPANS = new RegExp(`\\{(${COLOR_NAMES.join('|')})\\}([\\s\\S]*?)\\{\\/\\1\\}`, 'g');
const COLOR_TAGS = new RegExp(`\\{\\/?(?:${COLOR_NAMES.join('|')})\\}`, 'g');
const stripColors = (s: string) => s.replace(COLOR_TAGS, '');

/** The {colour}…{/colour} span the selection sits in, if any. */
function enclosingColor(text: string, a: number, b: number) {
  for (const m of text.matchAll(COLOR_SPANS)) {
    const start = m.index!;
    const end = start + m[0].length;
    const innerStart = start + m[1].length + 2;
    const innerEnd = end - m[1].length - 3;
    if (a >= start && b <= end) return { start, end, innerStart, innerEnd };
  }
  return null;
}

/** Textarea with a small formatting toolbar. Stores a simple Markdown subset. */
export function MarkdownField({
  value,
  onChange,
  placeholder,
  minRows = 3,
  onFocus,
  compact,
  tables: allowTables = true,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  minRows?: number;
  onFocus?: () => void;
  compact?: boolean;
  /** Offer the table tool (off for short fields such as callouts). */
  tables?: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const paletteRef = useRef<HTMLDivElement>(null);
  const [palette, setPalette] = useState(false);
  const [table, setTable] = useState<{ start: number; end: number; model: TableModel | null } | null>(null);
  const tables = useMemo(() => (allowTables ? findTables(value) : []), [value, allowTables]);

  useEffect(() => {
    if (!palette) return;
    const close = (e: MouseEvent) => !paletteRef.current?.contains(e.target as Node) && setPalette(false);
    const esc = (e: globalThis.KeyboardEvent) => e.key === 'Escape' && setPalette(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [palette]);

  const select = (a: number, b: number) =>
    requestAnimationFrame(() => {
      ref.current?.focus();
      ref.current?.setSelectionRange(a, b);
    });

  /** Colour the selection, recolour the span it is in, or (null) remove the colour. */
  const applyColor = (name: TextColor | null) => {
    setPalette(false);
    const el = ref.current;
    if (!el) return;
    const { selectionStart: a, selectionEnd: b } = el;
    const enc = enclosingColor(value, a, b);
    if (enc) {
      const inner = value.slice(enc.innerStart, enc.innerEnd);
      const open = name ? `{${name}}` : '';
      onChange(value.slice(0, enc.start) + open + inner + (name ? `{/${name}}` : '') + value.slice(enc.end));
      select(enc.start + open.length, enc.start + open.length + inner.length);
      return;
    }
    if (!name) {
      const cleaned = stripColors(value.slice(a, b));
      onChange(value.slice(0, a) + cleaned + value.slice(b));
      select(a, a + cleaned.length);
      return;
    }
    const sel = stripColors(value.slice(a, b)) || 'text';
    onChange(`${value.slice(0, a)}{${name}}${sel}{/${name}}${value.slice(b)}`);
    select(a + name.length + 2, a + name.length + 2 + sel.length);
  };

  /** Edit the table the cursor is in, or start a new one at the cursor. */
  const openTable = () => {
    const el = ref.current;
    const at = el?.selectionEnd ?? value.length;
    const found = tables.find((t) => at >= t.start && at <= t.end);
    setTable(found ? { ...found } : { start: at, end: at, model: null });
  };
  const saveTable = (model: TableModel) => {
    if (!table) return;
    const placed = placeTable(value, table.start, table.end, toMarkdown(model));
    onChange(placed.text);
    setTable(null);
    select(placed.caret, placed.caret);
  };
  const removeTable = () => {
    if (!table) return;
    const next = (value.slice(0, table.start) + value.slice(table.end)).replace(/\n{3,}/g, '\n\n').replace(/^\n+|\n+$/g, '');
    onChange(next);
    setTable(null);
  };

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.max(el.scrollHeight, minRows * 22 + 16)}px`;
  }, [value, minRows]);

  const wrap = (marker: string) => {
    const el = ref.current;
    if (!el) return;
    const { selectionStart: a, selectionEnd: b } = el;
    const selected = value.slice(a, b) || 'text';
    const next = value.slice(0, a) + marker + selected + marker + value.slice(b);
    onChange(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(a + marker.length, a + marker.length + selected.length);
    });
  };

  const prefixLines = (numbered: boolean) => {
    const el = ref.current;
    if (!el) return;
    const { selectionStart: a, selectionEnd: b } = el;
    const start = value.lastIndexOf('\n', a - 1) + 1;
    const endIdx = value.indexOf('\n', b);
    const end = endIdx === -1 ? value.length : endIdx;
    const lines = value.slice(start, end).split('\n');
    const replaced = lines.map((l, i) => (numbered ? `${i + 1}. ` : '- ') + l.replace(/^(\d+\.|-)\s+/, '')).join('\n');
    onChange(value.slice(0, start) + replaced + value.slice(end));
    requestAnimationFrame(() => el.focus());
  };

  // Continue lists on Enter
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'b') {
      e.preventDefault();
      wrap('**');
      return;
    }
    if (e.key !== 'Enter' || e.shiftKey) return;
    const el = e.currentTarget;
    const pos = el.selectionStart;
    const lineStart = value.lastIndexOf('\n', pos - 1) + 1;
    const line = value.slice(lineStart, pos);
    const m = /^(\s*)(-|\d+\.)\s+(.*)$/.exec(line);
    if (!m) return;
    e.preventDefault();
    if (!m[3].trim()) {
      onChange(value.slice(0, lineStart) + value.slice(pos));
      requestAnimationFrame(() => el.setSelectionRange(lineStart, lineStart));
      return;
    }
    const marker = m[2] === '-' ? '-' : `${Number(m[2].slice(0, -1)) + 1}.`;
    const insert = `\n${m[1]}${marker} `;
    onChange(value.slice(0, pos) + insert + value.slice(pos));
    requestAnimationFrame(() => el.setSelectionRange(pos + insert.length, pos + insert.length));
  };

  const tools = [
    { icon: Bold, label: 'Bold (Ctrl+B) — use for button and field names', run: () => wrap('**') },
    { icon: Italic, label: 'Italic', run: () => wrap('*') },
    { icon: List, label: 'Bulleted list', run: () => prefixLines(false) },
    { icon: ListOrdered, label: 'Numbered list', run: () => prefixLines(true) },
  ];

  const toolClass = 'rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-900';
  return (
    <div className="rounded-lg bg-white shadow-sm ring-1 ring-slate-300 focus-within:ring-2 focus-within:ring-brand">
      <div className={cx('flex items-center gap-0.5 border-b border-slate-100 px-1.5', compact ? 'py-0.5' : 'py-1')}>
        {tools.map((t) => (
          <button key={t.label} type="button" title={t.label} aria-label={t.label} onMouseDown={(e) => e.preventDefault()} onClick={t.run} className={toolClass}>
            <t.icon className="size-3.5" />
          </button>
        ))}
        <div ref={paletteRef} className="relative">
          <button
            type="button"
            title="Text colour: select words first"
            aria-label="Text colour"
            aria-haspopup="true"
            aria-expanded={palette}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setPalette((v) => !v)}
            className={cx(toolClass, palette && 'bg-slate-100 text-slate-900')}
          >
            <Baseline className="size-3.5" />
          </button>
          {palette && (
            <div role="menu" className="absolute top-full left-0 z-30 mt-1 w-44 rounded-lg bg-white p-1 shadow-lg ring-1 ring-slate-200">
              {COLOR_NAMES.map((c) => (
                <button
                  key={c}
                  type="button"
                  role="menuitem"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => applyColor(c)}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-slate-50"
                  style={{ color: TEXT_COLORS[c].hex }}
                >
                  <span className="size-3 rounded-full" style={{ background: TEXT_COLORS[c].hex }} /> <span className="font-medium">{TEXT_COLORS[c].label}</span>
                </button>
              ))}
              <button type="button" role="menuitem" onMouseDown={(e) => e.preventDefault()} onClick={() => applyColor(null)} className="mt-0.5 flex w-full items-center gap-2 rounded-md border-t border-slate-100 px-2 py-1.5 text-left text-sm text-slate-600 hover:bg-slate-50">
                <X className="size-3" /> No colour
              </button>
            </div>
          )}
        </div>
        {allowTables && (
          <button type="button" title="Table: boxed cells in rows and columns" aria-label="Insert or edit a table" onMouseDown={(e) => e.preventDefault()} onClick={openTable} className={toolClass}>
            <Table2 className="size-3.5" />
          </button>
        )}
      </div>
      <textarea
        ref={ref}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        onFocus={onFocus}
        placeholder={placeholder}
        rows={minRows}
        className="block w-full resize-none rounded-b-lg border-0 bg-transparent px-3 py-2 text-sm leading-relaxed text-slate-900 outline-none placeholder:text-slate-400"
      />
      {tables.length > 0 && (
        <div className="flex flex-wrap gap-1.5 border-t border-slate-100 px-2 py-1.5">
          {tables.map((t, i) => (
            <button
              key={`${t.start}-${i}`}
              type="button"
              onClick={() => setTable({ ...t })}
              className="inline-flex items-center gap-1.5 rounded-md bg-slate-50 px-2 py-1 text-xs text-slate-600 ring-1 ring-slate-200 hover:bg-white hover:text-brand"
            >
              <Table2 className="size-3.5" /> Table {tables.length > 1 ? i + 1 : ''} · {t.model.rows[0]?.length ?? 0} columns × {t.model.rows.length} rows · <span className="font-medium">Edit</span>
            </button>
          ))}
        </div>
      )}
      {table && <TableEditor initial={table.model} onSave={saveTable} onRemove={table.model ? removeTable : undefined} onClose={() => setTable(null)} />}
    </div>
  );
}

/** Editable list of short strings, with optional one-click suggestions. */
export function ListEditor({ items, onChange, placeholder, suggestions = [] }: { items: string[]; onChange: (v: string[]) => void; placeholder: string; suggestions?: string[] }) {
  const [draft, setDraft] = useState('');
  const add = (v: string) => {
    const t = v.trim();
    if (!t || items.includes(t)) return;
    onChange([...items, t]);
    setDraft('');
  };
  const remaining = suggestions.filter((s) => !items.includes(s));
  return (
    <div className="space-y-2">
      {items.length > 0 && (
        <ul className="space-y-1.5">
          {items.map((item, i) => (
            <li key={i} className="group flex items-center gap-2">
              <input
                value={item}
                onChange={(e) => onChange(items.map((x, j) => (j === i ? e.target.value : x)))}
                className="h-8 flex-1 rounded-md border-0 bg-slate-50 px-2.5 text-sm ring-1 ring-slate-200 ring-inset focus:bg-white focus:ring-2 focus:ring-brand"
              />
              <button type="button" onClick={() => onChange(items.filter((_, j) => j !== i))} className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600" aria-label="Remove">
                <X className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add(draft);
            }
          }}
          placeholder={placeholder}
          className="h-8 flex-1 rounded-md border-0 px-2.5 text-sm ring-1 ring-slate-300 ring-inset placeholder:text-slate-400 focus:ring-2 focus:ring-brand"
        />
        <button type="button" onClick={() => add(draft)} className="inline-flex h-8 items-center gap-1 rounded-md bg-slate-100 px-2.5 text-xs font-medium text-slate-700 hover:bg-slate-200">
          <Plus className="size-3.5" /> Add
        </button>
      </div>
      {remaining.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {remaining.map((s) => (
            <button key={s} type="button" onClick={() => add(s)} className="rounded-full border border-dashed border-slate-300 px-2.5 py-0.5 text-xs text-slate-600 hover:border-brand hover:text-brand">
              + {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
