import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ChevronLeft, ChevronRight, Copy, Film, GripVertical, ImagePlus, Loader2, PenTool, Plus, Rows3, Trash2, X } from 'lucide-react';
import { useRef, useState, type DragEvent, type ReactNode } from 'react';
import type { CalloutType, MediaItem, Step, StepMedia } from '@shared/types';
import { CALLOUT_META } from '@shared/defaults';
import { api, mediaUrl } from '../api';
import { Annotator } from './Annotator';
import { MarkdownField } from './editor-fields';
import { useToast } from './Toast';
import { cx, IconButton } from './ui';

export const newStepId = () => Math.random().toString(36).slice(2, 12);

export function blankStep(kind: Step['kind'] = 'step'): Step {
  return { id: newStepId(), kind, title: '', body: '', callout: { type: 'none', text: '' }, media: [] };
}

/** Upload helper shared by steps and the reference media section. */
export function useUploader(onDone: (items: MediaItem[]) => void) {
  const [progress, setProgress] = useState<number | null>(null);
  const toast = useToast();
  const upload = async (files: File[]) => {
    const accepted = files.filter((f) => f.type.startsWith('image/') || f.type.startsWith('video/') || /\.(mov|mp4|webm|m4v|avi|mkv)$/i.test(f.name));
    if (!accepted.length) return toast.error('Only images and videos can be added here');
    setProgress(0);
    try {
      const items = await api.media.upload(accepted, { onProgress: setProgress });
      onDone(items);
      if (items.some((m) => m.processing)) toast.success('Video uploaded. It is being converted for playback in the background.');
    } catch (e) {
      toast.error(e);
    } finally {
      setProgress(null);
    }
  };
  return { upload, progress };
}

export function MediaGrid({
  items,
  media,
  onChange,
  onMediaLoaded,
  uploading,
  addButton,
}: {
  items: StepMedia[];
  media: Map<string, MediaItem>;
  onChange: (items: StepMedia[]) => void;
  onMediaLoaded: (m: MediaItem) => void;
  uploading: number | null;
  addButton: ReactNode;
}) {
  const [annotating, setAnnotating] = useState<MediaItem | null>(null);
  const move = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= items.length) return;
    onChange(arrayMove(items, i, j));
  };
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {items.map((item, i) => {
        const m = media.get(item.mediaId);
        return (
          <div key={`${item.mediaId}-${i}`} className="group overflow-hidden rounded-lg bg-white ring-1 ring-slate-200">
            <div className="relative aspect-video bg-slate-100">
              {m?.kind === 'video' ? (
                <>
                  <img src={mediaUrl(item.mediaId, 'thumb')} alt="" className="size-full object-cover" />
                  <span className="absolute bottom-1.5 left-1.5 inline-flex items-center gap-1 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-medium text-white">
                    <Film className="size-3" /> {m.processing ? 'Converting…' : 'Video'}
                  </span>
                </>
              ) : (
                <img src={mediaUrl(item.mediaId, 'thumb')} alt="" className="size-full object-contain" />
              )}
              <div className="absolute inset-x-0 top-0 flex justify-end gap-0.5 bg-gradient-to-b from-black/50 to-transparent p-1 opacity-0 transition group-hover:opacity-100 focus-within:opacity-100">
                {m?.kind === 'image' && (
                  <IconButton label="Mark up (boxes, arrows, redact)" className="size-7 text-white hover:bg-white/20 hover:text-white" onClick={() => setAnnotating(m)}>
                    <PenTool className="size-3.5" />
                  </IconButton>
                )}
                <IconButton label="Move left" className="size-7 text-white hover:bg-white/20 hover:text-white" onClick={() => move(i, -1)} disabled={i === 0}>
                  <ChevronLeft className="size-4" />
                </IconButton>
                <IconButton label="Move right" className="size-7 text-white hover:bg-white/20 hover:text-white" onClick={() => move(i, 1)} disabled={i === items.length - 1}>
                  <ChevronRight className="size-4" />
                </IconButton>
                <IconButton label="Remove" className="size-7 text-white hover:bg-red-500 hover:text-white" onClick={() => onChange(items.filter((_, j) => j !== i))}>
                  <X className="size-4" />
                </IconButton>
              </div>
            </div>
            <input
              value={item.caption}
              onChange={(e) => onChange(items.map((x, j) => (j === i ? { ...x, caption: e.target.value } : x)))}
              placeholder="Caption (optional)"
              className="w-full border-0 border-t border-slate-100 px-2 py-1.5 text-xs outline-none placeholder:text-slate-400 focus:bg-slate-50"
            />
          </div>
        );
      })}
      {uploading !== null && (
        <div className="flex aspect-video flex-col items-center justify-center gap-1 rounded-lg bg-slate-50 text-xs text-slate-500 ring-1 ring-slate-200">
          <Loader2 className="size-5 animate-spin" /> Uploading {uploading}%
        </div>
      )}
      {addButton}
      {annotating && (
        <Annotator
          open
          media={annotating}
          onClose={() => setAnnotating(null)}
          onSaved={(saved) => {
            onMediaLoaded(saved);
            onChange(items.map((x) => (x.mediaId === annotating.id ? { ...x, mediaId: saved.id } : x)));
          }}
        />
      )}
    </div>
  );
}

function AddMediaTile({ onFiles }: { onFiles: (files: File[]) => void }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <button
      type="button"
      onClick={() => input.current?.click()}
      className="flex aspect-video flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-slate-300 text-xs font-medium text-slate-500 transition hover:border-brand hover:text-brand"
    >
      <ImagePlus className="size-5" />
      Add photo, screenshot or video
      <span className="text-[10px] font-normal text-slate-400">or drop / paste (Ctrl+V)</span>
      <input
        ref={input}
        type="file"
        accept="image/*,video/*,.mov,.mkv"
        multiple
        className="hidden"
        onChange={(e) => {
          onFiles(Array.from(e.target.files ?? []));
          e.target.value = '';
        }}
      />
    </button>
  );
}

const CALLOUTS: { value: CalloutType; label: string }[] = [
  { value: 'none', label: 'None' },
  ...(Object.keys(CALLOUT_META) as Exclude<CalloutType, 'none'>[]).map((k) => ({ value: k, label: CALLOUT_META[k].label.charAt(0) + CALLOUT_META[k].label.slice(1).toLowerCase() })),
];

function StepCard({
  step,
  number,
  media,
  onChange,
  onRemove,
  onDuplicate,
  onInsertAfter,
  onMediaLoaded,
  registerUploader,
  onFocus,
}: {
  step: Step;
  number: number;
  media: Map<string, MediaItem>;
  onChange: (s: Step) => void;
  onRemove: () => void;
  onDuplicate: () => void;
  onInsertAfter: (kind: Step['kind']) => void;
  onMediaLoaded: (m: MediaItem) => void;
  registerUploader: (id: string, fn: (files: File[]) => void) => void;
  onFocus: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: step.id });
  const [dragOver, setDragOver] = useState(false);
  const stepRef = useRef(step);
  stepRef.current = step;
  const { upload, progress } = useUploader((items) => {
    items.forEach(onMediaLoaded);
    onChange({ ...stepRef.current, media: [...stepRef.current.media, ...items.map((m) => ({ mediaId: m.id, caption: '' }))] });
  });
  registerUploader(step.id, upload);

  const onDrop = (e: DragEvent) => {
    if (!e.dataTransfer.files.length) return;
    e.preventDefault();
    setDragOver(false);
    void upload(Array.from(e.dataTransfer.files));
  };

  const style = { transform: CSS.Translate.toString(transform), transition };

  if (step.kind === 'section') {
    return (
      <div ref={setNodeRef} style={style} className={cx('group flex items-center gap-2 rounded-lg bg-slate-800 px-2 py-2 text-white', isDragging && 'z-10 opacity-80 shadow-xl')} onFocus={onFocus}>
        <button className="cursor-grab touch-none rounded p-1 text-white/50 hover:text-white" {...attributes} {...listeners} aria-label="Drag to reorder">
          <GripVertical className="size-4" />
        </button>
        <Rows3 className="size-4 text-white/60" />
        <input
          value={step.title}
          onChange={(e) => onChange({ ...step, title: e.target.value })}
          placeholder="Section heading, e.g. Before unloading"
          className="flex-1 bg-transparent text-sm font-semibold outline-none placeholder:text-white/40"
        />
        <IconButton label="Remove section" className="text-white/60 hover:bg-white/10 hover:text-white" onClick={onRemove}>
          <Trash2 className="size-4" />
        </IconButton>
      </div>
    );
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      onFocus={onFocus}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault();
          setDragOver(true);
        }
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
      className={cx('rounded-xl bg-white shadow-sm ring-1 transition', dragOver ? 'ring-2 ring-brand' : 'ring-slate-200', isDragging && 'z-10 shadow-xl')}
    >
      <div className="flex items-center gap-2 border-b border-slate-100 px-2 py-2">
        <button className="cursor-grab touch-none rounded p-1 text-slate-400 hover:text-slate-700" {...attributes} {...listeners} aria-label="Drag to reorder">
          <GripVertical className="size-4" />
        </button>
        <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-brand text-xs font-bold text-white">{number}</span>
        <input
          value={step.title}
          onChange={(e) => onChange({ ...step, title: e.target.value })}
          placeholder="Step title, e.g. Scan the pallet label"
          className="min-w-0 flex-1 bg-transparent text-sm font-semibold text-slate-900 outline-none placeholder:font-normal placeholder:text-slate-400"
        />
        <IconButton label="Duplicate step" onClick={onDuplicate}>
          <Copy className="size-4" />
        </IconButton>
        <IconButton label="Delete step" className="hover:bg-red-50 hover:text-red-600" onClick={onRemove}>
          <Trash2 className="size-4" />
        </IconButton>
      </div>
      <div className="space-y-3 p-4">
        <MarkdownField value={step.body} onChange={(body) => onChange({ ...step, body })} placeholder="What to do. Put button and field names in bold, e.g. Click **Confirm Receipt**." minRows={2} compact />
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-xs font-medium text-slate-500">Callout</span>
          {CALLOUTS.map((c) => {
            const meta = c.value === 'none' ? null : CALLOUT_META[c.value];
            const active = step.callout.type === c.value;
            return (
              <button
                key={c.value}
                type="button"
                onClick={() => onChange({ ...step, callout: { ...step.callout, type: c.value } })}
                className={cx('rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 transition', active ? 'ring-transparent' : 'bg-white text-slate-500 ring-slate-200 hover:ring-slate-400')}
                style={active ? (meta ? { background: meta.bg, color: meta.color, boxShadow: `inset 0 0 0 1.5px ${meta.color}` } : { background: '#e2e8f0', color: '#334155' }) : undefined}
              >
                {c.label}
              </button>
            );
          })}
        </div>
        {step.callout.type !== 'none' && (
          <div className="rounded-lg border-l-4 p-0.5" style={{ borderColor: CALLOUT_META[step.callout.type].color, background: CALLOUT_META[step.callout.type].bg }}>
            <MarkdownField value={step.callout.text} onChange={(text) => onChange({ ...step, callout: { ...step.callout, text } })} placeholder={`${CALLOUT_META[step.callout.type].label.toLowerCase()} text`} minRows={1} compact />
          </div>
        )}
        <MediaGrid
          items={step.media}
          media={media}
          onChange={(m) => onChange({ ...step, media: m })}
          onMediaLoaded={onMediaLoaded}
          uploading={progress}
          addButton={<AddMediaTile onFiles={upload} />}
        />
      </div>
      <div className="flex justify-center gap-2 border-t border-slate-100 py-1.5 opacity-60 transition hover:opacity-100">
        <button type="button" onClick={() => onInsertAfter('step')} className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs text-slate-500 hover:bg-slate-100 hover:text-slate-900">
          <Plus className="size-3" /> Step below
        </button>
        <button type="button" onClick={() => onInsertAfter('section')} className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs text-slate-500 hover:bg-slate-100 hover:text-slate-900">
          <Rows3 className="size-3" /> Section below
        </button>
      </div>
    </div>
  );
}

export function StepsEditor({
  steps,
  media,
  onChange,
  onMediaLoaded,
  registerUploader,
  onFocusStep,
}: {
  steps: Step[];
  media: Map<string, MediaItem>;
  onChange: (steps: Step[]) => void;
  onMediaLoaded: (m: MediaItem) => void;
  registerUploader: (id: string, fn: (files: File[]) => void) => void;
  onFocusStep: (id: string) => void;
}) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const stepsRef = useRef(steps);
  stepsRef.current = steps;
  const update = (id: string, s: Step) => onChange(stepsRef.current.map((x) => (x.id === id ? s : x)));
  const insertAt = (index: number, kind: Step['kind']) => {
    const next = [...stepsRef.current];
    next.splice(index, 0, blankStep(kind));
    onChange(next);
  };
  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    const from = steps.findIndex((s) => s.id === e.active.id);
    const to = steps.findIndex((s) => s.id === e.over!.id);
    onChange(arrayMove(steps, from, to));
  };

  let n = 0;
  return (
    <div className="space-y-3">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={steps.map((s) => s.id)} strategy={verticalListSortingStrategy}>
          {steps.map((s, i) => (
            <StepCard
              key={s.id}
              step={s}
              number={s.kind === 'step' ? ++n : 0}
              media={media}
              onChange={(next) => update(s.id, next)}
              onRemove={() => {
                const hasContent = s.body.trim() || s.media.length || s.callout.text.trim();
                if (!hasContent || confirm('Delete this step?')) onChange(stepsRef.current.filter((x) => x.id !== s.id));
              }}
              onDuplicate={() => {
                const next = [...stepsRef.current];
                next.splice(i + 1, 0, { ...s, id: newStepId(), media: [...s.media] });
                onChange(next);
              }}
              onInsertAfter={(kind) => insertAt(i + 1, kind)}
              onMediaLoaded={onMediaLoaded}
              registerUploader={registerUploader}
              onFocus={() => onFocusStep(s.id)}
            />
          ))}
        </SortableContext>
      </DndContext>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => insertAt(steps.length, 'step')} className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-slate-300 py-3 text-sm font-medium text-slate-500 hover:border-brand hover:text-brand">
          <Plus className="size-4" /> Add step
        </button>
        <button type="button" onClick={() => insertAt(steps.length, 'section')} className="inline-flex items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-slate-300 px-4 py-3 text-sm font-medium text-slate-500 hover:border-brand hover:text-brand">
          <Rows3 className="size-4" /> Add section
        </button>
      </div>
    </div>
  );
}
