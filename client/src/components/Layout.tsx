import { BookOpen, GraduationCap, ListChecks, LogOut, MapPin, Menu, Settings, Sparkles, UserCircle2, X } from 'lucide-react';
import { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { useAuth, useCan } from '../auth';
import { cx } from './ui';

export function BrandMark({ compact }: { compact?: boolean }) {
  const { branding } = useAuth();
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      {branding?.hasLogo ? (
        <img src={`/api/public/logo?v=${branding.logoVersion}`} alt="" className="h-8 max-w-28 rounded bg-white object-contain p-0.5" />
      ) : (
        <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-white/15 text-sm font-bold text-white">SOP</div>
      )}
      {!compact && (
        <div className="min-w-0 leading-tight">
          <div className="truncate text-sm font-semibold text-white">{branding?.siteName ?? 'SOP Machine'}</div>
          <div className="truncate text-[11px] text-white/60">{branding?.companyName}</div>
        </div>
      )}
    </div>
  );
}

export default function Layout() {
  const { user } = useAuth();
  const isEditor = useCan('editor');
  const isAdmin = useCan('admin');
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  const navigate = useNavigate();

  const logout = async () => {
    await api.auth.logout();
    qc.clear();
    navigate('/login');
    window.location.reload();
  };

  const links = [
    { to: '/', label: 'SOP Library', icon: BookOpen, end: true, show: true },
    { to: '/generate', label: 'Generate & import', icon: Sparkles, show: isEditor },
    { to: '/training', label: 'Training', icon: GraduationCap, show: isEditor },
    { to: '/stations', label: 'Stations & QR', icon: MapPin, show: isEditor },
    { to: '/records', label: 'Checklist records', icon: ListChecks, show: isEditor },
    { to: '/admin', label: 'Admin', icon: Settings, show: isAdmin },
  ];

  const nav = (
    <nav className="flex flex-1 flex-col gap-1 px-3">
      {links
        .filter((l) => l.show)
        .map((l) => (
          <NavLink
            key={l.to}
            to={l.to}
            end={l.end}
            onClick={() => setOpen(false)}
            className={({ isActive }) =>
              cx('flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition', isActive ? 'bg-white/15 text-white' : 'text-white/70 hover:bg-white/10 hover:text-white')
            }
          >
            <l.icon className="size-4" />
            {l.label}
          </NavLink>
        ))}
    </nav>
  );

  const account = (
    <div className="border-t border-white/10 p-3">
      <NavLink to="/account" onClick={() => setOpen(false)} className="flex items-center gap-3 rounded-lg px-3 py-2 text-white/80 hover:bg-white/10">
        <UserCircle2 className="size-5" />
        <div className="min-w-0 flex-1 leading-tight">
          <div className="truncate text-sm font-medium text-white">{user?.name}</div>
          <div className="text-[11px] text-white/60 capitalize">{user?.role}</div>
        </div>
      </NavLink>
      <button onClick={logout} className="mt-1 flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-white/70 hover:bg-white/10 hover:text-white">
        <LogOut className="size-4" /> Sign out
      </button>
    </div>
  );

  return (
    <div className="min-h-screen lg:pl-60">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col bg-brand-dark lg:flex">
        <div className="px-5 py-5">
          <BrandMark />
        </div>
        {nav}
        {account}
      </aside>

      <header className="sticky top-0 z-30 flex h-14 items-center justify-between bg-brand-dark px-4 lg:hidden">
        <BrandMark />
        <button onClick={() => setOpen(true)} className="rounded-md p-2 text-white" aria-label="Open menu">
          <Menu className="size-5" />
        </button>
      </header>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-slate-900/50" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-64 flex-col bg-brand-dark">
            <div className="flex items-center justify-between px-5 py-4">
              <BrandMark />
              <button onClick={() => setOpen(false)} className="p-1 text-white/80" aria-label="Close menu">
                <X className="size-5" />
              </button>
            </div>
            {nav}
            {account}
          </aside>
        </div>
      )}

      <main className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6 lg:px-8">
        <Outlet />
      </main>
    </div>
  );
}
