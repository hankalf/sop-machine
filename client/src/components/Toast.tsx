import { CheckCircle2, AlertTriangle, X } from 'lucide-react';
import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { cx } from './ui';

interface ToastItem {
  id: number;
  kind: 'success' | 'error';
  message: string;
}

const ToastContext = createContext<(kind: 'success' | 'error', message: string) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const push = useCallback((kind: 'success' | 'error', message: string) => {
    const id = Date.now() + Math.random();
    setItems((xs) => [...xs, { id, kind, message }]);
    setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), kind === 'error' ? 7000 : 3500);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed right-4 bottom-4 z-[60] flex w-[min(380px,calc(100vw-2rem))] flex-col gap-2">
        {items.map((t) => (
          <div key={t.id} className={cx('pointer-events-auto flex items-start gap-2.5 rounded-xl px-4 py-3 text-sm shadow-lg ring-1', t.kind === 'success' ? 'bg-white text-slate-800 ring-slate-200' : 'bg-red-50 text-red-800 ring-red-200')}>
            {t.kind === 'success' ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" /> : <AlertTriangle className="mt-0.5 size-4 shrink-0 text-red-600" />}
            <span className="flex-1">{t.message}</span>
            <button onClick={() => setItems((xs) => xs.filter((x) => x.id !== t.id))} className="text-slate-400 hover:text-slate-700" aria-label="Dismiss">
              <X className="size-4" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const push = useContext(ToastContext);
  return {
    success: (m: string) => push('success', m),
    error: (e: unknown) => push('error', e instanceof Error ? e.message : String(e)),
  };
}
