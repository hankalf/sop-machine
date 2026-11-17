/** Reading and writing the Markdown tables (| a | b |) that step text uses for boxed cells. */

export interface TableModel {
  /** First row is a header (bold, shaded). Without one, every row is a plain row of boxes. */
  header: boolean;
  rows: string[][];
}

export interface FoundTable {
  start: number;
  end: number;
  model: TableModel;
}

const DELIMITER = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

/** Split one table line into cells, honouring escaped pipes (\|). */
export function parseRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  const cells: string[] = [];
  let cur = '';
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\' && s[i + 1] === '|') {
      cur += '|';
      i++;
    } else if (s[i] === '|') {
      cells.push(cur.trim());
      cur = '';
    } else cur += s[i];
  }
  cells.push(cur.trim());
  return cells;
}

/** Every table in the text, with where it starts and ends. */
export function findTables(text: string): FoundTable[] {
  const lines: { text: string; start: number; end: number }[] = [];
  let pos = 0;
  for (const l of text.split('\n')) {
    lines.push({ text: l, start: pos, end: pos + l.length });
    pos += l.length + 1;
  }
  const out: FoundTable[] = [];
  for (let i = 0; i < lines.length - 1; i++) {
    if (!lines[i].text.trim().startsWith('|') || !DELIMITER.test(lines[i + 1].text) || !lines[i + 1].text.includes('-')) continue;
    const head = parseRow(lines[i].text);
    let j = i + 2;
    const body: string[][] = [];
    while (j < lines.length && lines[j].text.trim().startsWith('|')) body.push(parseRow(lines[j++].text));
    const cols = Math.max(head.length, ...body.map((r) => r.length));
    const pad = (r: string[]) => [...r, ...Array(Math.max(0, cols - r.length)).fill('')].slice(0, cols);
    const header = head.some((c) => c !== '');
    out.push({ start: lines[i].start, end: lines[j - 1].end, model: { header, rows: header ? [pad(head), ...body.map(pad)] : body.map(pad) } });
    i = j - 1;
  }
  return out;
}

const esc = (c: string) => c.replace(/\r?\n+/g, ' ').replace(/\|/g, '\\|').trim();

export function toMarkdown(model: TableModel): string {
  const cols = Math.max(1, ...model.rows.map((r) => r.length));
  const pad = (r: string[]) => [...r, ...Array(Math.max(0, cols - r.length)).fill('')].slice(0, cols);
  const line = (r: string[]) => `| ${pad(r).map(esc).join(' | ')} |`;
  const head = model.header ? model.rows[0] ?? [] : Array(cols).fill('');
  const body = model.header ? model.rows.slice(1) : model.rows;
  return [line(head), `| ${Array(cols).fill('---').join(' | ')} |`, ...body.map(line)].join('\n');
}

/** Put a table at [start, end) (an insertion point when they are equal), with blank lines around it. */
export function placeTable(text: string, start: number, end: number, md: string): { text: string; caret: number } {
  const before = text.slice(0, start).replace(/[ \t]*$/, '');
  const after = text.slice(end).replace(/^[ \t]*/, '');
  const lead = !before ? '' : before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n';
  const trail = !after ? '' : after.startsWith('\n\n') ? '' : after.startsWith('\n') ? '\n' : '\n\n';
  const out = before + lead + md + trail + after;
  return { text: out, caret: (before + lead + md).length };
}
