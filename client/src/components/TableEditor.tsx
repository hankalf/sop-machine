import { Columns3, Plus, Rows3, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import type { TableModel } from './markdownTable';
import { Button, cx, IconButton, Modal, Toggle } from './ui';

const MAX_COLS = 8;
const MAX_ROWS = 40;

/** A small grid editor for the boxed tables in step text. */
export function TableEditor({ initial, onSave, onRemove, onClose }: { initial: TableModel | null; onSave: (m: TableModel) => void; onRemove?: () => void; onClose: () => void }) {
  const [header, setHeader] = useState(initial?.header ?? true);
  const [rows, setRows] = useState<string[][]>(() =>
    initial?.rows.length
      ? initial.rows.map((r) => [...r])
      : [
          ['', '', ''],
          ['', '', ''],
          ['', '', ''],
        ],
  );
  const cols = Math.max(1, ...rows.map((r) => r.length));
  const set = (ri: number, ci: number, v: string) => setRows((rs) => rs.map((r, i) => (i === ri ? r.map((c, j) => (j === ci ? v : c)) : r)));
  const addRow = () => setRows((rs) => (rs.length >= MAX_ROWS ? rs : [...rs, Array(cols).fill('')]));
  const addCol = () => setRows((rs) => (cols >= MAX_COLS ? rs : rs.map((r) => [...r, ''])));
  const removeRow = (ri: number) => setRows((rs) => (rs.length <= 1 ? rs : rs.filter((_, i) => i !== ri)));
  const removeCol = (ci: number) => setRows((rs) => (cols <= 1 ? rs : rs.map((r) => r.filter((_, j) => j !== ci))));
  const empty = rows.every((r) => r.every((c) => !c.trim()));

  return (
    <Modal
      open
      onClose={onClose}
      width="max-w-4xl"
      title={initial ? 'Edit table' : 'Insert table'}
      footer={
        <>
          {onRemove && (
            <Button variant="ghost" icon={<Trash2 className="size-4" />} onClick={onRemove} className="mr-auto text-red-600 hover:bg-red-50 hover:text-red-700">
              Remove table
            </Button>
          )}
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={() => onSave({ header, rows })} disabled={empty}>
            {initial ? 'Update table' : 'Insert table'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="w-72">
            <Toggle checked={header} onChange={setHeader} label="First row is a header" description="Bold and shaded. Turn off for a plain grid of boxes." />
          </div>
          <div className="flex gap-2">
            <Button size="sm" icon={<Rows3 className="size-3.5" />} onClick={addRow} disabled={rows.length >= MAX_ROWS}>
              Add row
            </Button>
            <Button size="sm" icon={<Columns3 className="size-3.5" />} onClick={addCol} disabled={cols >= MAX_COLS}>
              Add column
            </Button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                {Array.from({ length: cols }, (_, ci) => (
                  <th key={ci} className="px-1 pb-1 text-left">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-medium text-slate-400">Column {ci + 1}</span>
                      <IconButton label={`Remove column ${ci + 1}`} className="size-6 hover:bg-red-50 hover:text-red-600" onClick={() => removeCol(ci)} disabled={cols <= 1}>
                        <X className="size-3.5" />
                      </IconButton>
                    </div>
                  </th>
                ))}
                <th className="w-8" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r, ri) => (
                <tr key={ri}>
                  {Array.from({ length: cols }, (_, ci) => (
                    <td key={ci} className="border border-slate-300 p-0">
                      <input
                        value={r[ci] ?? ''}
                        onChange={(e) => set(ri, ci, e.target.value)}
                        aria-label={`Row ${ri + 1}, column ${ci + 1}`}
                        placeholder={header && ri === 0 ? `Heading ${ci + 1}` : ''}
                        className={cx('h-9 w-full min-w-24 border-0 px-2 text-sm outline-none focus:bg-blue-50 focus:ring-2 focus:ring-brand focus:ring-inset', header && ri === 0 && 'bg-slate-100 font-semibold')}
                      />
                    </td>
                  ))}
                  <td className="pl-1">
                    <IconButton label={`Remove row ${ri + 1}`} className="size-6 hover:bg-red-50 hover:text-red-600" onClick={() => removeRow(ri)} disabled={rows.length <= 1}>
                      <X className="size-3.5" />
                    </IconButton>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button type="button" onClick={addRow} disabled={rows.length >= MAX_ROWS} className="flex w-full items-center justify-center gap-1 rounded-lg border border-dashed border-slate-300 py-1.5 text-xs font-medium text-slate-500 hover:border-brand hover:text-brand disabled:opacity-40">
          <Plus className="size-3.5" /> Add row
        </button>
        <p className="text-xs text-slate-500">
          Cells can use <strong>**bold**</strong>, <em>*italic*</em> and colours like <code className="rounded bg-slate-100 px-1">{'{red}text{/red}'}</code>. For a single box around some text, use one column and one row.
        </p>
      </div>
    </Modal>
  );
}
