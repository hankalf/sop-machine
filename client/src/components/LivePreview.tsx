import { Loader2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { cx } from './ui';

/**
 * Shows a rendered SOP (by same-origin URL) in an iframe. Uses two iframes: the next version renders
 * off-screen and is swapped in when Paged.js finishes, keeping the scroll position, so live editing
 * doesn't flicker.
 */
export function LivePreview({
  src,
  paged,
  className,
  scrollTarget,
  onPages,
}: {
  src: string | null;
  paged: boolean;
  className?: string;
  scrollTarget?: string | null;
  onPages?: (n: number) => void;
}) {
  const frames = [useRef<HTMLIFrameElement>(null), useRef<HTMLIFrameElement>(null)];
  const [front, setFront] = useState(0);
  const [busy, setBusy] = useState(false);
  const pending = useRef<{ index: number; timer: number } | null>(null);
  const frontRef = useRef(front);
  frontRef.current = front;
  const onPagesRef = useRef(onPages);
  onPagesRef.current = onPages;

  useEffect(() => {
    if (src === null) return;
    const back = 1 - frontRef.current;
    const iframe = frames[back].current;
    if (!iframe) return;
    setBusy(true);
    if (pending.current) window.clearTimeout(pending.current.timer);

    const swap = () => {
      const frontWin = frames[frontRef.current].current?.contentWindow;
      const backWin = frames[back].current?.contentWindow;
      const y = frontWin?.scrollY ?? 0;
      try {
        backWin?.scrollTo(0, y);
      } catch {
        /* ignore */
      }
      setFront(back);
      setBusy(false);
      pending.current = null;
    };
    const timer = window.setTimeout(swap, 20000);
    pending.current = { index: back, timer };

    if (!paged) {
      iframe.onload = () => {
        window.clearTimeout(timer);
        swap();
      };
    } else {
      iframe.onload = null;
    }
    iframe.src = src;
  }, [src, paged]);

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.data?.type !== 'sop-preview-rendered') return;
      const p = pending.current;
      if (!p || frames[p.index].current?.contentWindow !== e.source) return;
      onPagesRef.current?.(e.data.pages);
      window.clearTimeout(p.timer);
      const frontWin = frames[frontRef.current].current?.contentWindow;
      const y = frontWin?.scrollY ?? 0;
      try {
        frames[p.index].current?.contentWindow?.scrollTo(0, y);
      } catch {
        /* ignore */
      }
      setFront(p.index);
      setBusy(false);
      pending.current = null;
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  useEffect(() => {
    if (!scrollTarget) return;
    frames[front].current?.contentWindow?.postMessage({ type: 'sop-preview-scroll', target: scrollTarget }, '*');
    if (!paged) {
      const el = frames[front].current?.contentDocument?.getElementById(scrollTarget);
      el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [scrollTarget]);

  return (
    <div className={cx('relative overflow-hidden', paged ? 'bg-[#525659]' : 'bg-slate-100', className)}>
      {[0, 1].map((i) => (
        <iframe
          key={i}
          ref={frames[i]}
          title={i === front ? 'SOP preview' : 'SOP preview (updating)'}
          className={cx('absolute inset-0 size-full border-0 transition-opacity duration-150', i === front ? 'z-10 opacity-100' : 'pointer-events-none z-0 opacity-0')}
        />
      ))}
      {(busy || src === null) && (
        <div className="absolute top-3 right-3 z-20 inline-flex items-center gap-1.5 rounded-full bg-slate-900/80 px-2.5 py-1 text-[11px] font-medium text-white">
          <Loader2 className="size-3 animate-spin" /> Updating preview
        </div>
      )}
    </div>
  );
}
