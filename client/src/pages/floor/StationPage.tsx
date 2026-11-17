import { useQuery } from '@tanstack/react-query';
import { ChevronRight, ListChecks, LogIn } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, ApiError } from '../../api';
import { useAuth } from '../../auth';
import { Button, cx, PageLoader } from '../../components/ui';
import { publicText } from '../../publicText';
import { FloorShell, loadFloorLang, saveFloorLang } from './shared';

/** What a QR placard opens: the station's current approved SOPs. */
export default function StationPage() {
  const { token = '' } = useParams();
  const { user } = useAuth();
  const view = useQuery({ queryKey: ['station', token, user?.id], queryFn: () => api.pub.station(token), retry: false });
  const [lang, setLang] = useState(() => loadFloorLang() || 'en');
  useEffect(() => {
    if (!loadFloorLang() && user && user.language !== 'en') setLang(user.language);
  }, [user]);
  const t = publicText(lang);

  if (view.isLoading) return <PageLoader />;
  if (view.error || !view.data) {
    const err = view.error as ApiError | null;
    return (
      <FloorShell title="SOP Machine">
        <div className="m-auto max-w-sm p-6 text-center">
          <p className="text-slate-700">{err?.loginRequired ? t.signInNeeded : (err?.message ?? 'Not found')}</p>
          {err?.loginRequired && (
            <Link to={`/login?next=${encodeURIComponent(`/s/${token}`)}`}>
              <Button variant="primary" size="lg" className="mt-4" icon={<LogIn className="size-4" />}>
                {t.signIn}
              </Button>
            </Link>
          )}
        </div>
      </FloorShell>
    );
  }
  const v = view.data;
  const choose = (code: string) => {
    setLang(code);
    saveFloorLang(code);
  };

  return (
    <FloorShell branding={v.branding} title={v.station.name} subtitle={v.station.area || v.branding.companyName}>
      <div className="mx-auto w-full max-w-2xl space-y-4 p-4">
        {v.languages.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {[{ code: 'en', native: 'English' }, ...v.languages].map((l) => (
              <button key={l.code} onClick={() => choose(l.code)} className={cx('rounded-full px-4 py-1.5 text-sm font-medium ring-1', lang === l.code ? 'bg-brand text-white ring-brand' : 'bg-white text-slate-700 ring-slate-300')}>
                {l.native}
              </button>
            ))}
          </div>
        )}
        <h1 className="text-xs font-semibold tracking-wider text-slate-500 uppercase">{t.sopsAt}</h1>
        {!v.sops.length && <p className="rounded-xl bg-white p-6 text-center text-slate-500 ring-1 ring-slate-200">{t.noSops}</p>}
        <ul className="space-y-3">
          {v.sops.map((s) => (
            <li key={s.id}>
              <Link to={`/s/${token}/sop/${s.id}`} className="flex items-center gap-3 rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200 active:bg-slate-50">
                <span className="w-1.5 self-stretch rounded-full" style={{ background: s.categoryColor ?? '#94a3b8' }} />
                <div className="min-w-0 flex-1">
                  <div className="font-mono text-[11px] text-slate-500">
                    {s.number} · {t.rev} {s.version}
                  </div>
                  <div className="text-base leading-snug font-semibold">{s.titles[lang] ?? s.title}</div>
                  {s.checklist && (
                    <span className="mt-1 flex flex-wrap gap-1.5">
                      <span className="inline-flex items-center gap-1 rounded-full bg-brand/10 px-2 py-0.5 text-[11px] font-semibold text-brand">
                        <ListChecks className="size-3" /> {t.checklist}
                      </span>
                      {s.due === 'due' && <span className="inline-flex items-center rounded-full bg-amber-400 px-2 py-0.5 text-[11px] font-bold text-amber-950">{t.dueNow}</span>}
                      {s.due === 'done' && <span className="inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-800">✓ {t.doneThisShift}</span>}
                    </span>
                  )}
                </div>
                <ChevronRight className="size-5 text-slate-400" />
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </FloorShell>
  );
}
