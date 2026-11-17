import { ArrowUpRight, Eraser, Hash, RotateCcw, Square, Type, Undo2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type PointerEvent } from 'react';
import type { MediaItem } from '@shared/types';
import { api, mediaUrl } from '../api';
import { useToast } from './Toast';
import { Button, cx, Modal, Spinner } from './ui';

type Tool = 'rect' | 'arrow' | 'marker' | 'text' | 'redact';
interface Shape {
  tool: Tool;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: string;
  n?: number;
  text?: string;
}

const COLORS = ['#ef4444', '#f59e0b', '#2563eb', '#16a34a'];
const TOOLS: { id: Tool; label: string; icon: typeof Square; hint: string }[] = [
  { id: 'rect', label: 'Box', icon: Square, hint: 'Drag to draw a box around a button or field' },
  { id: 'arrow', label: 'Arrow', icon: ArrowUpRight, hint: 'Drag from the tail to the tip' },
  { id: 'marker', label: 'Number', icon: Hash, hint: 'Click to drop numbered markers (1, 2, 3…)' },
  { id: 'text', label: 'Text', icon: Type, hint: 'Click where the label should go' },
  { id: 'redact', label: 'Redact', icon: Eraser, hint: 'Drag over names, addresses or other private data to black it out' },
];

function draw(ctx: CanvasRenderingContext2D, img: HTMLImageElement, shapes: Shape[], w: number, h: number) {
  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  const lw = Math.max(2, w / 280);
  for (const s of shapes) {
    const x1 = s.x1 * w;
    const y1 = s.y1 * h;
    const x2 = s.x2 * w;
    const y2 = s.y2 * h;
    ctx.save();
    ctx.strokeStyle = s.color;
    ctx.fillStyle = s.color;
    ctx.lineWidth = lw;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    if (s.tool === 'rect') {
      const r = lw * 2;
      ctx.beginPath();
      ctx.roundRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1), r);
      ctx.stroke();
    } else if (s.tool === 'redact') {
      ctx.fillStyle = '#111827';
      ctx.fillRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
    } else if (s.tool === 'arrow') {
      const angle = Math.atan2(y2 - y1, x2 - x1);
      const head = lw * 5;
      ctx.lineWidth = lw * 1.3;
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
    } else if (s.tool === 'marker') {
      const r = Math.max(11, w / 55);
      ctx.beginPath();
      ctx.arc(x1, y1, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = lw * 0.8;
      ctx.strokeStyle = '#fff';
      ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.font = `700 ${r * 1.15}px Inter, Arial, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(s.n ?? 1), x1, y1 + r * 0.05);
    } else if (s.tool === 'text' && s.text) {
      const size = Math.max(14, w / 45);
      ctx.font = `700 ${size}px Inter, Arial, sans-serif`;
      const pad = size * 0.35;
      const tw = ctx.measureText(s.text).width;
      ctx.fillRect(x1, y1 - size, tw + pad * 2, size + pad * 1.4);
      ctx.fillStyle = '#fff';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(s.text, x1 + pad, y1);
    }
    ctx.restore();
  }
}

export function Annotator({ media, open, onClose, onSaved }: { media: MediaItem; open: boolean; onClose: () => void; onSaved: (m: MediaItem) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [sourceId, setSourceId] = useState(media.id);
  const [shapes, setShapes] = useState<Shape[]>([]);
  const [drafting, setDrafting] = useState<Shape | null>(null);
  const [tool, setTool] = useState<Tool>('rect');
  const [color, setColor] = useState(COLORS[0]);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  useEffect(() => {
    if (!open) return;
    setShapes([]);
    setSourceId(media.id);
  }, [open, media.id]);

  useEffect(() => {
    if (!open) return;
    setImg(null);
    const el = new Image();
    el.onload = () => setImg(el);
    el.onerror = () => toast.error('Could not load the image');
    el.src = mediaUrl(sourceId, 'display-hq');
  }, [open, sourceId]);

  // Fit the image into the available space.
  useEffect(() => {
    if (!img || !wrapRef.current) return;
    const maxW = wrapRef.current.clientWidth;
    const maxH = window.innerHeight * 0.62;
    const scale = Math.min(1, maxW / img.naturalWidth, maxH / img.naturalHeight);
    setSize({ w: Math.round(img.naturalWidth * scale), h: Math.round(img.naturalHeight * scale) });
  }, [img]);

  useEffect(() => {
    const c = canvasRef.current;
    if (!c || !img || !size.w) return;
    c.width = size.w;
    c.height = size.h;
    draw(c.getContext('2d')!, img, drafting ? [...shapes, drafting] : shapes, size.w, size.h);
  }, [img, shapes, drafting, size]);

  const pos = (e: PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) };
  };

  const onDown = (e: PointerEvent<HTMLCanvasElement>) => {
    const p = pos(e);
    if (tool === 'marker') {
      const n = shapes.filter((s) => s.tool === 'marker').length + 1;
      setShapes((xs) => [...xs, { tool, x1: p.x, y1: p.y, x2: p.x, y2: p.y, color, n }]);
      return;
    }
    if (tool === 'text') {
      const text = window.prompt('Label text');
      if (text?.trim()) setShapes((xs) => [...xs, { tool, x1: p.x, y1: p.y, x2: p.x, y2: p.y, color, text: text.trim() }]);
      return;
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrafting({ tool, x1: p.x, y1: p.y, x2: p.x, y2: p.y, color });
  };
  const onMove = (e: PointerEvent<HTMLCanvasElement>) => {
    if (!drafting) return;
    const p = pos(e);
    setDrafting({ ...drafting, x2: p.x, y2: p.y });
  };
  const onUp = () => {
    if (!drafting) return;
    if (Math.abs(drafting.x2 - drafting.x1) > 0.005 || Math.abs(drafting.y2 - drafting.y1) > 0.005) setShapes((xs) => [...xs, drafting]);
    setDrafting(null);
  };

  const save = useCallback(async () => {
    if (!img) return;
    setSaving(true);
    try {
      const c = document.createElement('canvas');
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      draw(c.getContext('2d')!, img, shapes, c.width, c.height);
      const blob = await new Promise<Blob>((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not export image'))), 'image/png'));
      const base = media.originalName.replace(/\.[^.]+$/, '');
      const [saved] = await api.media.upload([new File([blob], `${base}-annotated.png`, { type: 'image/png' })], { parentId: media.parentId ?? media.id });
      onSaved(saved);
      onClose();
    } catch (e) {
      toast.error(e);
    } finally {
      setSaving(false);
    }
  }, [img, shapes, media, onSaved, onClose, toast]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Mark up image"
      width="max-w-6xl"
      footer={
        <>
          {media.parentId && sourceId !== media.parentId && (
            <Button variant="ghost" icon={<RotateCcw className="size-4" />} onClick={() => setSourceId(media.parentId!)} className="mr-auto">
              Start over from original
            </Button>
          )}
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={save} loading={saving} disabled={!shapes.length && sourceId === media.id}>
            Save image
          </Button>
        </>
      }
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg bg-slate-100 p-0.5">
          {TOOLS.map((t) => (
            <button key={t.id} title={t.hint} onClick={() => setTool(t.id)} className={cx('flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium', tool === t.id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800')}>
              <t.icon className="size-3.5" /> {t.label}
            </button>
          ))}
        </div>
        <div className="flex gap-1.5">
          {COLORS.map((c) => (
            <button key={c} onClick={() => setColor(c)} aria-label={`Color ${c}`} className={cx('size-6 rounded-full ring-offset-2', color === c && 'ring-2 ring-slate-900')} style={{ background: c }} />
          ))}
        </div>
        <div className="ml-auto flex gap-1">
          <Button size="sm" variant="ghost" icon={<Undo2 className="size-3.5" />} onClick={() => setShapes((xs) => xs.slice(0, -1))} disabled={!shapes.length}>
            Undo
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setShapes([])} disabled={!shapes.length}>
            Clear
          </Button>
        </div>
      </div>
      <p className="mb-2 text-xs text-slate-500">{TOOLS.find((t) => t.id === tool)?.hint}</p>
      <div ref={wrapRef} className="flex min-h-64 items-center justify-center rounded-lg bg-slate-100 p-2">
        {!img ? (
          <Spinner />
        ) : (
          <canvas ref={canvasRef} style={{ width: size.w, height: size.h }} className="cursor-crosshair touch-none rounded shadow" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} />
        )}
      </div>
    </Modal>
  );
}
