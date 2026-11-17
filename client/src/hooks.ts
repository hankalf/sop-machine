import { useEffect, useRef, useState } from 'react';

export function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** Warn before leaving the page with unsaved work. */
export function useUnsavedWarning(dirty: boolean) {
  const ref = useRef(dirty);
  ref.current = dirty;
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (ref.current) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, []);
}
