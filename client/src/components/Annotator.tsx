import {
  ArrowUpRight,
  Circle,
  Eraser,
  Hash,
  Highlighter,
  Minus,
  MousePointer2,
  Pencil,
  Redo2,
  RotateCcw,
  Square,
  StickyNote,
  Trash2,
  Type,
  Undo2,
} from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react';
import type { Markup, MarkupShape, MarkupTool, MediaItem } from '@shared/types';
import { api, mediaUrl } from '../api';
import { useToast } from './Toast';
import { Button, cx, Input, Modal, Spinner } from './ui';

type Shape = MarkupShape;
type Tool = 'select' | MarkupTool;
type Size = Shape['size'];
type Box = { x: number; y: number; w: number; h: number };
/** A point in image fractions (x, y) and in canvas pixels (px, py). */
type Pt = { x: number; y: number; px: number; py: number };

const COLORS = [
  { hex: '#ef4444', name: 'Red' },
  { hex: '#f59e0b', name: 'Orange' },
  { hex: '#facc15', name: 'Yellow' },
  { hex: '#16a34a', name: 'Green' },
  { hex: '#2563eb', name: 'Blue' },
  { hex: '#111827', name: 'Black' },
  { hex: '#ffffff', name: 'White' },
];
const LIGHT = new Set(['#facc15', '#ffffff']);
/** Text colour that reads on top of a fill of colour `c`. */
const ink = (c: string) => (LIGHT.has(c.toLowerCase()) ? '#111827' : '#ffffff');

const TOOLS: { id: Tool; label: string; icon: typeof Square; hint: string; key: string }[] = [
  { id: 'select', label: 'Select', icon: MousePointer2, key: 'v', hint: 'Click a shape to move it, drag its handles to resize, press Delete to remove it. Double-click a note to change its text.' },
  { id: 'rect', label: 'Box', icon: Square, key: 'b', hint: 'Drag to draw a box around a button or field.' },
  { id: 'ellipse', label: 'Circle', icon: Circle, key: 'c', hint: 'Drag to circle something.' },
  { id: 'arrow', label: 'Arrow', icon: ArrowUpRight, key: 'a', hint: 'Drag from the tail to the tip.' },
  { id: 'line', label: 'Line', icon: Minus, key: 'l', hint: 'Drag to draw a straight line.' },
  { id: 'pen', label: 'Pen', icon: Pencil, key: 'p', hint: 'Draw freehand.' },
  { id: 'highlight', label: 'Highlight', icon: Highlighter, key: 'h', hint: 'Drag over text or a field to highlight it.' },
  { id: 'note', label: 'Note', icon: StickyNote, key: 'n', hint: 'Click to add a note, or drag from the spot it is about to where the note should sit (it gets a pointer). Notes are part of the picture, so they are not translated.' },
  { id: 'marker', label: 'Number', icon: Hash, key: '1', hint: 'Click to drop numbered markers (1, 2, 3…). Type what each number means below the picture to add a key.' },
  { id: 'text', label: 'Label', icon: Type, key: 't', hint: 'Click where a short label should go.' },
  { id: 'redact', label: 'Redact', icon: Eraser, key: 'r', hint: 'Drag over names, addresses or other private data to black it out.' },
];

const FONT = 'Inter, Arial, sans-serif';
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

// ---------------------------------------------------------------------------
// Geometry and drawing. Everything is computed from the image size (w × h), so the
// same function draws the on-screen editor and the full-size saved picture.
// ---------------------------------------------------------------------------

let measureCtx: CanvasRenderingContext2D | null = null;
function measurer() {
  measureCtx ??= document.createElement('canvas').getContext('2d')!;
  return measureCtx;
}

function metrics(w: number, h: number, size: Size) {
  const unit = Math.max(w, h);
  const k = size === 's' ? 0.75 : size === 'l' ? 1.4 : 1;
  return {
    line: Math.max(1.5, unit / 300) * (size === 's' ? 0.6 : size === 'l' ? 1.7 : 1),
    font: Math.max(12, unit / 52) * k,
    marker: Math.max(10, unit / 60) * k,
  };
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const test = line ? `${line} ${word}` : word;
      if (!line || ctx.measureText(test).width <= maxW) line = test;
      else {
        out.push(line);
        line = word;
      }
    }
    out.push(line);
  }
  return out;
}

interface TextLayout {
  box: Box;
  lines: string[];
  font: number;
  lineH: number;
  pad: number;
  maxW: number;
  weight: number;
}

/** Where a note or label sits and how its text wraps. */
function textLayout(s: Shape, w: number, h: number): TextLayout {
  const ctx = measurer();
  const { font } = metrics(w, h, s.size);
  const note = s.tool === 'note';
  const weight = note ? 500 : 650;
  ctx.font = `${weight} ${font}px ${FONT}`;
  const pad = font * (note ? 0.6 : 0.4);
  const lineH = font * 1.3;
  const maxW = Math.max(font * 8, w * (note ? 0.36 : 0.5));
  const lines = wrap(ctx, s.text ?? '', maxW);
  const textW = Math.max(font * (note ? 6 : 3), ...lines.map((l) => ctx.measureText(l).width));
  const bw = textW + pad * 2;
  const bh = pad * 2 + font + (lines.length - 1) * lineH + font * 0.15;
  const x = bw < w ? clamp(s.x1 * w, 0, w - bw) : 0;
  const y = bh < h ? clamp(s.y1 * h, 0, h - bh) : 0;
  return { box: { x, y, w: bw, h: bh }, lines, font, lineH, pad, maxW, weight };
}

/** The box a note's pointer line should start from: the point on the box nearest the tip. */
function anchor(box: Box, tx: number, ty: number) {
  return { x: clamp(tx, box.x, box.x + box.w), y: clamp(ty, box.y, box.y + box.h) };
}

function bounds(s: Shape, w: number, h: number): Box {
  if (s.tool === 'text' || s.tool === 'note') return textLayout(s, w, h).box;
  if (s.tool === 'marker') {
    const r = metrics(w, h, s.size).marker;
    return { x: s.x1 * w - r, y: s.y1 * h - r, w: r * 2, h: r * 2 };
  }
  const xs = s.tool === 'pen' && s.points?.length ? s.points.map((p) => p[0] * w) : [s.x1 * w, s.x2 * w];
  const ys = s.tool === 'pen' && s.points?.length ? s.points.map((p) => p[1] * h) : [s.y1 * h, s.y2 * h];
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

function distToSeg(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax;
  const dy = by - ay;
  const len = dx * dx + dy * dy;
  const t = len ? clamp(((px - ax) * dx + (py - ay) * dy) / len, 0, 1) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function hit(s: Shape, p: Pt, w: number, h: number): boolean {
  const tol = 6 + metrics(w, h, s.size).line;
  if (s.tool === 'arrow' || s.tool === 'line') return distToSeg(p.px, p.py, s.x1 * w, s.y1 * h, s.x2 * w, s.y2 * h) <= tol;
  if (s.tool === 'pen') {
    const pts = s.points ?? [];
    for (let i = 1; i < pts.length; i++) if (distToSeg(p.px, p.py, pts[i - 1][0] * w, pts[i - 1][1] * h, pts[i][0] * w, pts[i][1] * h) <= tol) return true;
    return false;
  }
  if (s.tool === 'marker') return Math.hypot(p.px - s.x1 * w, p.py - s.y1 * h) <= metrics(w, h, s.size).marker + 4;
  const b = bounds(s, w, h);
  const inside = p.px >= b.x - 4 && p.px <= b.x + b.w + 4 && p.py >= b.y - 4 && p.py <= b.y + b.h + 4;
  if (inside) return true;
  if (s.tool === 'note' && s.pointer) {
    const a = anchor(b, s.x2 * w, s.y2 * h);
    return distToSeg(p.px, p.py, a.x, a.y, s.x2 * w, s.y2 * h) <= tol;
  }
  return false;
}

type HandleId = 'a' | 'b' | 'c' | 'd' | 'p1' | 'p2' | 'tip';
function handles(s: Shape, w: number, h: number): { id: HandleId; x: number; y: number }[] {
  switch (s.tool) {
    case 'rect':
    case 'ellipse':
    case 'highlight':
    case 'redact':
      return [
        { id: 'a', x: s.x1 * w, y: s.y1 * h },
        { id: 'b', x: s.x2 * w, y: s.y1 * h },
        { id: 'c', x: s.x2 * w, y: s.y2 * h },
        { id: 'd', x: s.x1 * w, y: s.y2 * h },
      ];
    case 'arrow':
    case 'line':
      return [
        { id: 'p1', x: s.x1 * w, y: s.y1 * h },
        { id: 'p2', x: s.x2 * w, y: s.y2 * h },
      ];
    case 'note':
      return s.pointer ? [{ id: 'tip', x: s.x2 * w, y: s.y2 * h }] : [];
    default:
      return [];
  }
}

function applyHandle(s: Shape, id: HandleId, x: number, y: number): Shape {
  x = clamp(x, 0, 1);
  y = clamp(y, 0, 1);
  switch (id) {
    case 'a':
    case 'p1':
      return { ...s, x1: x, y1: y };
    case 'b':
      return { ...s, x2: x, y1: y };
    case 'c':
    case 'p2':
    case 'tip':
      return { ...s, x2: x, y2: y };
    case 'd':
      return { ...s, x1: x, y2: y };
  }
}

/** Move a shape, keeping it on the picture. A note's box moves but its pointer stays put. */
function translate(s: Shape, dx: number, dy: number, w: number, h: number): Shape {
  const b = bounds(s, w, h);
  dx = clamp(dx, -b.x / w, (w - b.x - b.w) / w);
  dy = clamp(dy, -b.y / h, (h - b.y - b.h) / h);
  if (s.tool === 'note' || s.tool === 'text') return { ...s, x1: b.x / w + dx, y1: b.y / h + dy };
  return {
    ...s,
    x1: s.x1 + dx,
    y1: s.y1 + dy,
    x2: s.x2 + dx,
    y2: s.y2 + dy,
    points: s.points?.map(([px, py]) => [px + dx, py + dy] as [number, number]),
  };
}

function roundRect(ctx: CanvasRenderingContext2D, b: Box, r: number) {
  ctx.beginPath();
  ctx.roundRect(b.x, b.y, b.w, b.h, Math.min(r, b.w / 2, b.h / 2));
}

function paint(ctx: CanvasRenderingContext2D, s: Shape, w: number, h: number, hideText: boolean) {
  const m = metrics(w, h, s.size);
  const x1 = s.x1 * w;
  const y1 = s.y1 * h;
  const x2 = s.x2 * w;
  const y2 = s.y2 * h;
  ctx.save();
  ctx.strokeStyle = s.color;
  ctx.fillStyle = s.color;
  ctx.lineWidth = m.line;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  switch (s.tool) {
    case 'rect':
      roundRect(ctx, { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) }, m.line * 2);
      ctx.stroke();
      break;
    case 'ellipse':
      ctx.beginPath();
      ctx.ellipse((x1 + x2) / 2, (y1 + y2) / 2, Math.abs(x2 - x1) / 2, Math.abs(y2 - y1) / 2, 0, 0, Math.PI * 2);
      ctx.stroke();
      break;
    case 'highlight':
      ctx.globalAlpha = 0.38;
      ctx.globalCompositeOperation = 'multiply';
      ctx.fillRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
      break;
    case 'redact':
      ctx.fillStyle = '#111827';
      ctx.fillRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
      break;
    case 'line':
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
      break;
    case 'arrow': {
      const angle = Math.atan2(y2 - y1, x2 - x1);
      const head = Math.max(m.line * 4.5, 10);
      ctx.lineWidth = m.line * 1.2;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2 - Math.cos(angle) * head * 0.6, y2 - Math.sin(angle) * head * 0.6);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x2, y2);
      ctx.lineTo(x2 - head * Math.cos(angle - Math.PI / 7), y2 - head * Math.sin(angle - Math.PI / 7));
      ctx.lineTo(x2 - head * Math.cos(angle + Math.PI / 7), y2 - head * Math.sin(angle + Math.PI / 7));
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'pen': {
      const pts = s.points ?? [];
      if (pts.length < 2) break;
      ctx.beginPath();
      ctx.moveTo(pts[0][0] * w, pts[0][1] * h);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0] * w, pts[i][1] * h);
      ctx.stroke();
      break;
    }
    case 'marker': {
      const r = m.marker;
      ctx.beginPath();
      ctx.arc(x1, y1, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = Math.max(1.5, r * 0.14);
      ctx.strokeStyle = s.color.toLowerCase() === '#ffffff' ? '#111827' : '#ffffff';
      ctx.stroke();
      ctx.fillStyle = ink(s.color);
      ctx.font = `700 ${r * 1.1}px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(s.n ?? 1), x1, y1 + r * 0.06);
      break;
    }
    case 'text': {
      if (hideText) break;
      const t = textLayout(s, w, h);
      roundRect(ctx, t.box, t.font * 0.3);
      ctx.fill();
      ctx.fillStyle = ink(s.color);
      ctx.font = `${t.weight} ${t.font}px ${FONT}`;
      ctx.textBaseline = 'top';
      t.lines.forEach((l, i) => ctx.fillText(l, t.box.x + t.pad, t.box.y + t.pad + i * t.lineH));
      break;
    }
    case 'note': {
      const t = textLayout(s, w, h);
      const border = s.color.toLowerCase() === '#ffffff' ? '#94a3b8' : s.color;
      if (s.pointer) {
        const a = anchor(t.box, x2, y2);
        ctx.strokeStyle = border;
        ctx.fillStyle = border;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(x2, y2);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(x2, y2, Math.max(3, m.line * 1.4), 0, Math.PI * 2);
        ctx.fill();
      }
      if (hideText) break;
      ctx.shadowColor = 'rgba(15, 23, 42, 0.28)';
      ctx.shadowBlur = t.font * 0.5;
      ctx.shadowOffsetY = t.font * 0.08;
      ctx.fillStyle = '#ffffff';
      roundRect(ctx, t.box, t.font * 0.35);
      ctx.fill();
      ctx.shadowColor = 'transparent';
      ctx.lineWidth = Math.max(1.5, m.line * 0.8);
      ctx.strokeStyle = border;
      ctx.stroke();
      ctx.fillStyle = '#0f172a';
      ctx.font = `${t.weight} ${t.font}px ${FONT}`;
      ctx.textBaseline = 'top';
      t.lines.forEach((l, i) => ctx.fillText(l, t.box.x + t.pad, t.box.y + t.pad + i * t.lineH));
      break;
    }
  }
  ctx.restore();
}

/** The key under the picture: one row per numbered marker that has a note. */
function keyLayout(shapes: Shape[], w: number, h: number) {
  const rows = shapes.filter((s) => s.tool === 'marker' && s.text?.trim()).sort((a, b) => (a.n ?? 0) - (b.n ?? 0));
  if (!rows.length) return { height: 0, items: [], font: 0, lineH: 0, pad: 0, r: 0, textX: 0, gap: 0 };
  const ctx = measurer();
  const font = Math.max(12, Math.max(w, h) / 62);
  const lineH = font * 1.35;
  const pad = font * 0.9;
  const r = font * 0.68;
  const textX = pad + r * 2 + font * 0.6;
  ctx.font = `500 ${font}px ${FONT}`;
  const items = rows.map((s) => ({ s, lines: wrap(ctx, s.text!.trim(), Math.max(font * 6, w - textX - pad)) }));
  const gap = font * 0.45;
  const height = pad * 2 + items.reduce((n, it) => n + it.lines.length * lineH, 0) + gap * (items.length - 1);
  return { height, items, font, lineH, pad, r, textX, gap };
}

function paintKey(ctx: CanvasRenderingContext2D, shapes: Shape[], w: number, h: number) {
  const k = keyLayout(shapes, w, h);
  if (!k.height) return;
  ctx.save();
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, h, w, k.height);
  ctx.fillStyle = '#e2e8f0';
  ctx.fillRect(0, h, w, Math.max(1, k.font / 14));
  let y = h + k.pad;
  for (const it of k.items) {
    const cy = y + k.lineH / 2;
    ctx.fillStyle = it.s.color.toLowerCase() === '#ffffff' ? '#111827' : it.s.color;
    ctx.beginPath();
    ctx.arc(k.pad + k.r, cy, k.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = it.s.color.toLowerCase() === '#ffffff' ? '#ffffff' : ink(it.s.color);
    ctx.font = `700 ${k.r * 1.05}px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(it.s.n ?? ''), k.pad + k.r, cy + k.r * 0.06);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#0f172a';
    ctx.font = `500 ${k.font}px ${FONT}`;
    it.lines.forEach((l, i) => ctx.fillText(l, k.textX, cy + i * k.lineH));
    y += it.lines.length * k.lineH + k.gap;
  }
  ctx.restore();
}

function render(ctx: CanvasRenderingContext2D, img: HTMLImageElement, shapes: Shape[], w: number, h: number, opts: { selectedId?: string | null; editingId?: string | null } = {}) {
  ctx.clearRect(0, 0, w, h + keyLayout(shapes, w, h).height);
  ctx.drawImage(img, 0, 0, w, h);
  for (const s of shapes) paint(ctx, s, w, h, s.id === opts.editingId);
  paintKey(ctx, shapes, w, h);
  const sel = opts.selectedId ? shapes.find((s) => s.id === opts.selectedId) : null;
  if (sel && sel.id !== opts.editingId) {
    const b = bounds(sel, w, h);
    ctx.save();
    ctx.strokeStyle = '#2563eb';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 3]);
    ctx.strokeRect(b.x - 4, b.y - 4, b.w + 8, b.h + 8);
    ctx.setLineDash([]);
    for (const hd of handles(sel, w, h)) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(hd.x - 5, hd.y - 5, 10, 10);
      ctx.strokeRect(hd.x - 5, hd.y - 5, 10, 10);
    }
    ctx.restore();
  }
}

/** Drop pen points that are too close together to matter. */
function simplify(points: [number, number][]) {
  const out: [number, number][] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) > 0.0015) out.push(p);
  }
  return out.slice(0, 4000);
}

function renumber(shapes: Shape[]): Shape[] {
  const order = shapes.filter((s) => s.tool === 'marker').sort((a, b) => (a.n ?? 0) - (b.n ?? 0));
  const n = new Map(order.map((s, i) => [s.id, i + 1]));
  return shapes.map((s) => (s.tool === 'marker' ? { ...s, n: n.get(s.id) } : s));
}

// ---------------------------------------------------------------------------
// The editor
// ---------------------------------------------------------------------------

type Drag =
  | { mode: 'create'; id: string; start: Pt; before: Shape[] }
  | { mode: 'move'; id: string; start: Pt; orig: Shape; before: Shape[] }
  | { mode: 'handle'; id: string; handle: HandleId; orig: Shape; before: Shape[] };

export function Annotator({ media, open, onClose, onSaved }: { media: MediaItem; open: boolean; onClose: () => void; onSaved: (m: MediaItem) => void }) {
  const toast = useToast();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [baseId, setBaseId] = useState(media.markup?.baseId ?? media.id);
  const [base, setBase] = useState<MediaItem | null>(null);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [shapes, setShapesState] = useState<Shape[]>(media.markup?.shapes ?? []);
  const shapesRef = useRef(shapes);
  const setShapes = (next: Shape[]) => {
    shapesRef.current = next;
    setShapesState(next);
  };
  const past = useRef<Shape[][]>([]);
  const future = useRef<Shape[][]>([]);
  const [dirty, setDirty] = useState(false);
  const [tool, setTool] = useState<Tool>(media.markup?.shapes.length ? 'select' : 'rect');
  const [color, setColor] = useState(COLORS[0].hex);
  const [size, setSize] = useState<Size>('m');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditingState] = useState<{ id: string; before: Shape[] } | null>(null);
  const editingRef = useRef(editing);
  const setEditing = (v: { id: string; before: Shape[] } | null) => {
    editingRef.current = v;
    setEditingState(v);
  };
  const [view, setView] = useState({ w: 0, h: 0 });
  const [saving, setSaving] = useState(false);
  const drag = useRef<Drag | null>(null);
  const liveBefore = useRef<Shape[] | null>(null);
  const keyInputs = useRef(new Map<string, HTMLInputElement>());

  /** Record a finished change so it can be undone. */
  const pushHistory = (before: Shape[]) => {
    past.current.push(before);
    if (past.current.length > 100) past.current.shift();
    future.current = [];
    setDirty(true);
  };
  const commit = (next: Shape[]) => {
    pushHistory(shapesRef.current);
    setShapes(next);
  };
  const undo = () => {
    const prev = past.current.pop();
    if (!prev) return;
    future.current.push(shapesRef.current);
    setShapes(prev);
    setSelectedId(null);
    setDirty(true);
  };
  const redo = () => {
    const next = future.current.pop();
    if (!next) return;
    past.current.push(shapesRef.current);
    setShapes(next);
    setSelectedId(null);
    setDirty(true);
  };

  // Load the picture the shapes are drawn on. Only when the picture changes: reloading it
  // would swap the canvas for a spinner mid-drag.
  const toastRef = useRef(toast);
  toastRef.current = toast;
  useEffect(() => {
    if (!open) return;
    setImg(null);
    let alive = true;
    api.media
      .get(baseId)
      .then((m) => alive && setBase(m))
      .catch((e) => toastRef.current.error(e));
    const el = new Image();
    el.onload = () => alive && setImg(el);
    el.onerror = () => toastRef.current.error('Could not load the image');
    el.src = mediaUrl(baseId, 'display-hq');
    return () => {
      alive = false;
    };
  }, [open, baseId]);

  // Fit the picture into the dialog.
  useEffect(() => {
    if (!img || !wrapRef.current) return;
    const fit = () => {
      const maxW = wrapRef.current!.clientWidth - 16;
      const maxH = window.innerHeight * 0.6;
      const scale = Math.min(1, maxW / img.naturalWidth, maxH / img.naturalHeight);
      setView({ w: Math.round(img.naturalWidth * scale), h: Math.round(img.naturalHeight * scale) });
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [img]);

  useLayoutEffect(() => {
    const c = canvasRef.current;
    if (!c || !img || !view.w) return;
    const keyH = keyLayout(shapes, view.w, view.h).height;
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.round(view.w * dpr);
    c.height = Math.round((view.h + keyH) * dpr);
    c.style.width = `${view.w}px`;
    c.style.height = `${view.h + keyH}px`;
    const ctx = c.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    render(ctx, img, shapes, view.w, view.h, { selectedId, editingId: editing?.id });
  }, [img, shapes, view, selectedId, editing]);

  const point = (e: { clientX: number; clientY: number }): Pt => {
    const r = canvasRef.current!.getBoundingClientRect();
    const px = e.clientX - r.left;
    const py = e.clientY - r.top;
    return { x: px / view.w, y: py / view.h, px, py };
  };
  const topHit = (p: Pt) => [...shapesRef.current].reverse().find((s) => hit(s, p, view.w, view.h));
  const selected = shapes.find((s) => s.id === selectedId) ?? null;

  const startEditing = (id: string, before = shapesRef.current) => {
    setSelectedId(id);
    setEditing({ id, before });
  };
  const finishEditing = () => {
    const ed = editingRef.current;
    if (!ed) return;
    setEditing(null);
    const s = shapesRef.current.find((x) => x.id === ed.id);
    let next = shapesRef.current;
    if (s && !s.text?.trim()) {
      next = shapesRef.current.filter((x) => x.id !== ed.id);
      setSelectedId(null);
    } else if (s) next = shapesRef.current.map((x) => (x.id === ed.id ? { ...x, text: x.text!.replace(/\s+$/, '') } : x));
    setShapes(next);
    if (JSON.stringify(next) !== JSON.stringify(ed.before)) pushHistory(ed.before);
  };

  const removeSelected = () => {
    if (!selectedId) return;
    commit(renumber(shapesRef.current.filter((s) => s.id !== selectedId)));
    setSelectedId(null);
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (editing) finishEditing();
    const p = point(e);
    if (p.y > 1) return; // the key strip under the picture
    const cur = shapesRef.current;
    // Handles of the selected shape work with any tool.
    if (selected) {
      const hd = handles(selected, view.w, view.h).find((x) => Math.hypot(x.x - p.px, x.y - p.py) <= 9);
      if (hd) {
        drag.current = { mode: 'handle', id: selected.id, handle: hd.id, orig: selected, before: cur };
        e.currentTarget.setPointerCapture(e.pointerId);
        return;
      }
    }
    if (tool === 'select') {
      const target = topHit(p);
      setSelectedId(target?.id ?? null);
      if (target) {
        drag.current = { mode: 'move', id: target.id, start: p, orig: target, before: cur };
        e.currentTarget.setPointerCapture(e.pointerId);
      }
      return;
    }
    const id = uid();
    const shape: Shape = { id, tool, x1: p.x, y1: p.y, x2: p.x, y2: p.y, color, size };
    if (tool === 'marker') {
      const n = Math.max(0, ...cur.filter((s) => s.tool === 'marker').map((s) => s.n ?? 0)) + 1;
      commit([...cur, { ...shape, n, text: '' }]);
      setSelectedId(id);
      return;
    }
    if (tool === 'pen') shape.points = [[p.x, p.y]];
    // Notes and labels open their text box on release: opening it now would lose focus
    // to the mouse-down that follows.
    if (tool === 'note' || tool === 'text') Object.assign(shape, { text: '', pointer: false });
    setShapes([...cur, shape]);
    setSelectedId(null);
    drag.current = { mode: 'create', id, start: p, before: cur };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const d = drag.current;
    const p = point(e);
    if (!d) {
      // Cursor feedback only.
      const onHandle = selected && handles(selected, view.w, view.h).some((x) => Math.hypot(x.x - p.px, x.y - p.py) <= 9);
      e.currentTarget.style.cursor = onHandle ? 'grab' : tool === 'select' ? (topHit(p) ? 'move' : 'default') : 'crosshair';
      return;
    }
    const cur = shapesRef.current;
    const x = clamp(p.x, 0, 1);
    const y = clamp(p.y, 0, 1);
    setShapes(
      cur.map((s) => {
        if (s.id !== d.id) return s;
        if (d.mode === 'handle') return applyHandle(d.orig, d.handle, x, y);
        if (d.mode === 'move') return translate(d.orig, p.x - d.start.x, p.y - d.start.y, view.w, view.h);
        if (s.tool === 'pen') return { ...s, points: [...(s.points ?? []), [x, y]] };
        if (s.tool === 'text') return s;
        if (s.tool === 'note') {
          const moved = Math.hypot(p.px - d.start.px, p.py - d.start.py) > 12;
          return { ...s, x1: x, y1: y, x2: d.start.x, y2: d.start.y, pointer: moved };
        }
        return { ...s, x2: x, y2: y };
      }),
    );
  };

  const onPointerUp = () => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    const cur = shapesRef.current;
    const s = cur.find((x) => x.id === d.id);
    if (!s) return;
    if (d.mode !== 'create') {
      if (JSON.stringify(s) !== JSON.stringify(d.orig)) pushHistory(d.before);
      return;
    }
    const tiny = Math.abs(s.x2 - s.x1) * view.w < 4 && Math.abs(s.y2 - s.y1) * view.h < 4;
    if (s.tool === 'note' || s.tool === 'text') {
      // A click places the note there; a drag adds a pointer back to where it started.
      const placed = s.pointer ? s : { ...s, x1: d.start.x, y1: d.start.y };
      setShapes(cur.map((x) => (x.id === s.id ? placed : x)));
      startEditing(s.id, d.before);
      return;
    }
    if (s.tool === 'pen') {
      const points = simplify(s.points ?? []);
      if (points.length < 2) return setShapes(d.before);
      setShapes(cur.map((x) => (x.id === s.id ? { ...x, points } : x)));
    } else if (tiny) return setShapes(d.before);
    pushHistory(d.before);
    setSelectedId(s.id);
  };

  const onDoubleClick = (e: ReactMouseEvent<HTMLCanvasElement>) => {
    const target = topHit(point(e));
    if (!target) return;
    if (target.tool === 'text' || target.tool === 'note') startEditing(target.id);
    else if (target.tool === 'marker') {
      setSelectedId(target.id);
      keyInputs.current.get(target.id)?.focus();
    }
  };

  /** Change a field on a shape while typing; the change becomes one undo step on blur. */
  const setLive = (id: string, patch: Partial<Shape>) => setShapes(shapesRef.current.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  const beginLive = () => (liveBefore.current = shapesRef.current);
  const endLive = () => {
    if (liveBefore.current && JSON.stringify(liveBefore.current) !== JSON.stringify(shapesRef.current)) pushHistory(liveBefore.current);
    liveBefore.current = null;
  };

  const pickColor = (c: string) => {
    setColor(c);
    if (selected) commit(shapesRef.current.map((s) => (s.id === selected.id ? { ...s, color: c } : s)));
  };
  const pickSize = (z: Size) => {
    setSize(z);
    if (selected) commit(shapesRef.current.map((s) => (s.id === selected.id ? { ...s, size: z } : s)));
  };

  const requestClose = useCallback(() => {
    if (dirty && !window.confirm('Discard your changes to this picture?')) return;
    onClose();
  }, [dirty, onClose]);

  // Keyboard: shortcuts, Delete, undo/redo. Runs before the dialog's own Escape handler.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
      if (e.key === 'Escape') {
        e.stopImmediatePropagation();
        e.preventDefault();
        if (editing) finishEditing();
        else if (typing) t!.blur();
        else if (selectedId) setSelectedId(null);
        else requestClose();
        return;
      }
      if (editing || typing) return;
      const mod = e.ctrlKey || e.metaKey;
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId) {
        e.preventDefault();
        removeSelected();
      } else if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redo();
      } else if (!mod && !e.altKey) {
        const tl = TOOLS.find((x) => x.key === e.key.toLowerCase());
        if (tl) setTool(tl.id);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  const save = async () => {
    if (!img || !base) return;
    if (editing) finishEditing();
    const final = shapesRef.current;
    setSaving(true);
    try {
      // Removing every shape from a marked-up picture just puts the clean picture back.
      if (!final.length) {
        onSaved(base);
        onClose();
        return;
      }
      const W = img.naturalWidth;
      const H = img.naturalHeight;
      const c = document.createElement('canvas');
      c.width = W;
      c.height = Math.round(H + keyLayout(final, W, H).height);
      render(c.getContext('2d')!, img, final, W, H);
      const png = /png|gif|bmp/.test(base.mime);
      const type = png ? 'image/png' : 'image/jpeg';
      const blob = await new Promise<Blob>((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not export image'))), type, 0.92));
      const name = `${base.originalName.replace(/\.[^.]+$/, '').replace(/-(annotated|marked-up)$/, '')}-marked-up.${png ? 'png' : 'jpg'}`;
      const markup: Markup = { v: 1, baseId: base.id, shapes: final };
      const [saved] = await api.media.upload([new File([blob], name, { type })], { parentId: base.parentId ?? base.id, markup });
      onSaved(saved);
      onClose();
    } catch (e) {
      toast.error(e);
    } finally {
      setSaving(false);
    }
  };

  const markers = useMemo(() => shapes.filter((s) => s.tool === 'marker').sort((a, b) => (a.n ?? 0) - (b.n ?? 0)), [shapes]);
  const editShape = editing ? shapes.find((s) => s.id === editing.id) : null;
  const editBox = editShape && view.w ? textLayout(editShape, view.w, view.h) : null;
  const canSave = dirty || baseId !== (media.markup?.baseId ?? media.id);
  const hint = TOOLS.find((t) => t.id === tool)?.hint;

  return (
    <Modal
      open={open}
      onClose={requestClose}
      title="Mark up picture"
      width="max-w-6xl"
      footer={
        <>
          {base?.parentId && (
            <Button
              variant="ghost"
              icon={<RotateCcw className="size-4" />}
              onClick={() => {
                if (shapes.length && !window.confirm('Start again from the original picture? Your shapes on this one are removed.')) return;
                setShapes([]);
                past.current = [];
                future.current = [];
                setSelectedId(null);
                setBaseId(base.parentId!);
                setDirty(true);
              }}
              className="mr-auto"
            >
              Start over from original
            </Button>
          )}
          <Button onClick={requestClose}>Cancel</Button>
          <Button variant="primary" onClick={save} loading={saving} disabled={!canSave || !img || !base}>
            Save picture
          </Button>
        </>
      }
    >
      <div className="mb-2 flex flex-wrap items-center gap-2" role="toolbar" aria-label="Markup tools">
        <div className="flex flex-wrap rounded-lg bg-slate-100 p-0.5">
          {TOOLS.map((t) => (
            <button
              key={t.id}
              type="button"
              title={`${t.label} (${t.key.toUpperCase()})`}
              aria-pressed={tool === t.id}
              onClick={() => setTool(t.id)}
              className={cx('flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium', tool === t.id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800')}
            >
              <t.icon className="size-3.5" /> <span className="hidden sm:inline">{t.label}</span>
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1.5" role="group" aria-label="Colour">
          {COLORS.map((c) => (
            <button
              key={c.hex}
              type="button"
              onClick={() => pickColor(c.hex)}
              aria-label={c.name}
              aria-pressed={(selected?.color ?? color) === c.hex}
              title={c.name}
              className={cx('size-6 rounded-full ring-1 ring-slate-300 ring-offset-2', (selected?.color ?? color) === c.hex && 'ring-2 ring-slate-900')}
              style={{ background: c.hex }}
            />
          ))}
        </div>
        <div className="flex rounded-lg bg-slate-100 p-0.5" role="group" aria-label="Size">
          {(['s', 'm', 'l'] as const).map((z) => (
            <button
              key={z}
              type="button"
              aria-pressed={(selected?.size ?? size) === z}
              title={{ s: 'Thin / small', m: 'Medium', l: 'Thick / large' }[z]}
              onClick={() => pickSize(z)}
              className={cx('w-8 rounded-md py-1 text-xs font-semibold uppercase', (selected?.size ?? size) === z ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800')}
            >
              {z}
            </button>
          ))}
        </div>
        <div className="ml-auto flex flex-wrap gap-1">
          {selected && (selected.tool === 'note' || selected.tool === 'text') && (
            <Button size="sm" variant="ghost" icon={<Type className="size-3.5" />} onClick={() => startEditing(selected.id)}>
              Edit text
            </Button>
          )}
          {selected && (
            <Button size="sm" variant="ghost" icon={<Trash2 className="size-3.5" />} onClick={removeSelected} className="text-red-600 hover:bg-red-50 hover:text-red-700">
              Delete
            </Button>
          )}
          <Button size="sm" variant="ghost" icon={<Undo2 className="size-3.5" />} onClick={undo} disabled={!past.current.length} title="Undo (Ctrl+Z)">
            Undo
          </Button>
          <Button size="sm" variant="ghost" icon={<Redo2 className="size-3.5" />} onClick={redo} disabled={!future.current.length} title="Redo (Ctrl+Shift+Z)">
            Redo
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              commit([]);
              setSelectedId(null);
            }}
            disabled={!shapes.length}
          >
            Clear all
          </Button>
        </div>
      </div>
      <p className="mb-2 min-h-4 text-xs text-slate-500">{hint}</p>
      <div ref={wrapRef} className="flex min-h-64 items-start justify-center overflow-auto rounded-lg bg-slate-100 p-2">
        {!img ? (
          <div className="flex h-64 items-center">
            <Spinner />
          </div>
        ) : (
          <div className="relative">
            <canvas
              ref={canvasRef}
              className="block touch-none rounded shadow"
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              onDoubleClick={onDoubleClick}
            />
            {editShape && editBox && (
              <textarea
                autoFocus
                aria-label={editShape.tool === 'note' ? 'Note text' : 'Label text'}
                placeholder={editShape.tool === 'note' ? 'Type a note…' : 'Label'}
                value={editShape.text ?? ''}
                onChange={(e) => setLive(editShape.id, { text: e.target.value })}
                onBlur={finishEditing}
                onKeyDown={(e) => {
                  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') finishEditing();
                  if (editShape.tool === 'text' && e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    finishEditing();
                  }
                }}
                className="absolute resize-none overflow-hidden rounded-md border-2 border-blue-600 bg-white text-slate-900 shadow-lg outline-none placeholder:text-slate-400"
                style={{
                  left: editBox.box.x,
                  top: editBox.box.y,
                  width: Math.min(view.w - editBox.box.x, editBox.maxW + editBox.pad * 2 + 6),
                  minWidth: Math.min(view.w - editBox.box.x, editBox.font * 10),
                  height: Math.max(editBox.box.h, editBox.lineH + editBox.pad * 2) + editBox.lineH,
                  font: `${editBox.weight} ${editBox.font}px ${FONT}`,
                  lineHeight: `${editBox.lineH}px`,
                  padding: editBox.pad - 2,
                }}
              />
            )}
          </div>
        )}
      </div>
      {editShape && <p className="mt-1.5 text-xs text-slate-500">{editShape.tool === 'note' ? 'Enter starts a new line. Click outside the note or press Esc when done.' : 'Press Enter when done.'}</p>}
      {markers.length > 0 && (
        <div className="mt-3 rounded-lg bg-white p-3 ring-1 ring-slate-200">
          <div className="mb-2 text-xs font-semibold text-slate-700">
            Key for the numbers <span className="font-normal text-slate-500">· printed under the picture; leave blank to skip</span>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {markers.map((m) => (
              <label key={m.id} className="flex items-center gap-2">
                <span className="flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ring-1 ring-slate-300" style={{ background: m.color, color: ink(m.color) }}>
                  {m.n}
                </span>
                <Input
                  ref={(el) => {
                    if (el) keyInputs.current.set(m.id, el);
                    else keyInputs.current.delete(m.id);
                  }}
                  value={m.text ?? ''}
                  placeholder={`What is ${m.n}? e.g. "Scan the pallet label here"`}
                  maxLength={300}
                  onFocus={() => {
                    beginLive();
                    setSelectedId(m.id);
                  }}
                  onBlur={endLive}
                  onChange={(e) => setLive(m.id, { text: e.target.value })}
                />
              </label>
            ))}
          </div>
        </div>
      )}
    </Modal>
  );
}
