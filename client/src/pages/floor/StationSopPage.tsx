import { useQuery } from '@tanstack/react-query';
import { BadgeCheck, ClipboardSignature, ListChecks } from 'lucide-react';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../../api';
import { useAuth } from '../../auth';
import { useToast } from '../../components/Toast';
import { Button, cx, ErrorText, Field, Input, Modal, PageLoader } from '../../components/ui';
import { languageInfo } from '@shared/defaults';
import { publicText } from '../../publicText';
import { FloorShell, loadFloorLang, loadPerson, saveFloorLang, savePerson } from './shared';

/** One SOP at a station: read it, then sign off or start its checklist. */
export default function StationSopPage() {
  const { token = '', sopId = '' } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const view = useQuery({ queryKey: ['station', token, user?.id], queryFn: () => api.pub.station(token), retry: false });
  const [langCode, setLangCode] = useState(() => loadFloorLang() || (user && user.language !== 'en' ? user.language : 'en'));
  const [both, setBoth] = useState(false);
  const [ask, setAsk] = useState<'sign' | 'run' | null>(null);
  const [person, setPerson] = useState(loadPerson);
  const [busy, setBusy] = useState(false);
  const [signed, setSigned] = useState(false);
  const [error, setError] = useState<unknown>(null);

  if (view.isLoading) return <PageLoader />;
  const sop = view.data?.sops.find((s) => s.id === sopId);
  if (view.error || !view.data || !sop) {
    return (
      <FloorShell title="SOP" back={`/s/${token}`}>
        <div className="p-4"><ErrorText error={view.error ?? 'This SOP is not posted at this station.'} /></div>
      </FloorShell>
    );
  }
  const v = view.data;
  const available = sop.languages.includes(langCode) ? langCode : 'en';
  const t = publicText(langCode);
  const lang = { code: available, bilingual: both && available !== 'en' };

  const act = async (kind: 'sign' | 'run') => {
    if (!v.signedIn && !person.name.trim()) return setError(new Error(t.yourName));
    setBusy(true);
    setError(null);
    try {
      savePerson(person);
      if (kind === 'sign') {
        const r = await api.pub.acknowledge(token, sopId, person);
        setSigned(true);
        setAsk(null);
        toast.success(r.created ? t.signedThanks : t.alreadySigned);
      } else {
        const run = await api.pub.startRun(token, sopId, { ...person, language: available });
        navigate(`/run/${run.token}`);
      }
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  const start = (kind: 'sign' | 'run') => (v.signedIn ? act(kind) : setAsk(kind));

  return (
    <FloorShell
      branding={v.branding}
      title={(!lang.bilingual && sop.titles[available]) || sop.title}
      subtitle={`${sop.number} · ${t.rev} ${sop.version} · ${v.station.name}`}
      back={`/s/${token}`}
      footer={
        <div className="mx-auto flex max-w-2xl flex-col gap-2 sm:flex-row">
          {v.trainingEnabled && (
            <Button size="lg" variant={sop.checklist ? 'secondary' : 'primary'} className="w-full min-w-0 sm:flex-1" icon={signed ? <BadgeCheck className="size-4 text-emerald-600" /> : <ClipboardSignature className="size-4" />} onClick={() => start('sign')} disabled={signed} loading={busy && ask !== 'run'}>
              {signed ? t.signedThanks.split('.')[0] : t.signOffButton}
            </Button>
          )}
          {sop.checklist && (
            <Button size="lg" variant="primary" className="w-full min-w-0 sm:flex-1" icon={<ListChecks className="size-4" />} onClick={() => start('run')}>
              {t.startChecklist}
            </Button>
          )}
        </div>
      }
    >
      {sop.languages.length > 0 && (
        <div className="flex gap-1.5 overflow-x-auto bg-white px-3 py-2 ring-1 ring-slate-200">
          {['en', ...sop.languages].map((code) => (
            <button
              key={code}
              onClick={() => {
                setLangCode(code);
                saveFloorLang(code);
                setBoth(false);
              }}
              className={cx('rounded-full px-3 py-1 text-xs font-semibold whitespace-nowrap ring-1', available === code && !lang.bilingual ? 'bg-brand text-white ring-brand' : 'bg-white text-slate-600 ring-slate-300')}
            >
              {code === 'en' ? 'English' : languageInfo(code).native}
            </button>
          ))}
          {available !== 'en' && (
            <button onClick={() => setBoth(!both)} className={cx('rounded-full px-3 py-1 text-xs font-semibold whitespace-nowrap ring-1', lang.bilingual ? 'bg-brand text-white ring-brand' : 'bg-white text-slate-600 ring-slate-300')}>
              {t.both}
            </button>
          )}
        </div>
      )}
      <iframe title={sop.title} src={api.pub.stationRenderUrl(token, sopId, lang)} className="min-h-[60vh] w-full flex-1 border-0 bg-white" />

      <Modal
        open={!!ask}
        onClose={() => setAsk(null)}
        title={ask === 'run' ? t.startChecklist : t.signOffTitle}
        footer={
          <Button variant="primary" size="lg" className="w-full" loading={busy} onClick={() => ask && act(ask)}>
            {ask === 'run' ? t.startChecklist : t.signOffButton}
          </Button>
        }
      >
        <div className="space-y-4">
          {ask === 'sign' && <p className="text-sm text-slate-700">{t.signOffText}</p>}
          <Field label={t.yourName}>
            <Input value={person.name} onChange={(e) => setPerson({ ...person, name: e.target.value })} autoFocus autoComplete="name" className="h-11 text-base" />
          </Field>
          <Field label={t.employeeId}>
            <Input value={person.employeeId} onChange={(e) => setPerson({ ...person, employeeId: e.target.value })} className="h-11 text-base" />
          </Field>
          <ErrorText error={error} />
        </div>
      </Modal>
    </FloorShell>
  );
}
