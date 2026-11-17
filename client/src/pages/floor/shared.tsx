import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { PublicBranding } from '@shared/types';
import { ArrowLeft } from 'lucide-react';

const PERSON_KEY = 'sop:floor-person';
const LANG_KEY = 'sop:floor-lang';

export interface FloorPerson {
  name: string;
  employeeId: string;
}

export function loadPerson(): FloorPerson {
  try {
    return { name: '', employeeId: '', ...JSON.parse(localStorage.getItem(PERSON_KEY) ?? '{}') };
  } catch {
    return { name: '', employeeId: '' };
  }
}
export const savePerson = (p: FloorPerson) => localStorage.setItem(PERSON_KEY, JSON.stringify(p));

export const loadFloorLang = () => localStorage.getItem(LANG_KEY) ?? '';
export const saveFloorLang = (code: string) => localStorage.setItem(LANG_KEY, code);

/** Phone-first page frame for floor pages (no sidebar, no login chrome). */
export function FloorShell({ branding, title, subtitle, back, right, children, footer }: { branding?: PublicBranding | null; title: string; subtitle?: string; back?: string; right?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col overflow-x-clip bg-slate-100" style={branding ? ({ '--brand': branding.appColor } as React.CSSProperties) : undefined}>
      <header className="sticky top-0 z-20 flex items-center gap-3 bg-brand-dark px-3 py-2.5 text-white shadow">
        {back ? (
          <Link to={back} className="rounded-md p-1.5 hover:bg-white/10" aria-label="Back">
            <ArrowLeft className="size-5" />
          </Link>
        ) : branding?.hasLogo ? (
          <img src={`/api/public/logo?v=${branding.logoVersion}`} alt="" className="h-8 max-w-24 rounded bg-white object-contain p-0.5" />
        ) : null}
        <div className="min-w-0 flex-1 leading-tight">
          <div className="truncate text-sm font-semibold">{title}</div>
          {subtitle && <div className="truncate text-[11px] text-white/70">{subtitle}</div>}
        </div>
        {right}
      </header>
      <main className="flex min-h-0 flex-1 flex-col">{children}</main>
      {footer && <footer className="sticky bottom-0 z-20 border-t border-slate-200 bg-white p-3 shadow-[0_-4px_12px_rgba(0,0,0,0.06)]">{footer}</footer>}
    </div>
  );
}
