import { Bold, Italic, List, ListOrdered, Plus, X } from 'lucide-react';
import { useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { cx } from './ui';

/** Textarea with a small formatting toolbar. Stores a simple Markdown subset. */
export function MarkdownField({
  value,
  onChange,
  placeholder,
  minRows = 3,
  onFocus,
  compact,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  minRows?: number;
  onFocus?: () => void;
  compact?: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

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

  return (
    <div className="rounded-lg bg-white shadow-sm ring-1 ring-slate-300 focus-within:ring-2 focus-within:ring-brand">
      <div className={cx('flex items-center gap-0.5 border-b border-slate-100 px-1.5', compact ? 'py-0.5' : 'py-1')}>
        {tools.map((t) => (
          <button key={t.label} type="button" title={t.label} aria-label={t.label} onMouseDown={(e) => e.preventDefault()} onClick={t.run} className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-900">
            <t.icon className="size-3.5" />
          </button>
        ))}
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
