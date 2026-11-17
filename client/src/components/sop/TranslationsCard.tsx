import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Languages, Loader2, Pencil, RefreshCw } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import type { Sop } from '@shared/types';
import { languageInfo } from '@shared/defaults';
import { api } from '../../api';
import { useToast } from '../Toast';
import { Badge, Button, Card } from '../ui';

/** Translation status per language, with one-click AI translation. */
export function TranslationsCard({ sop, onChanged }: { sop: Sop; onChanged: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const settings = useQuery({ queryKey: ['settings'], queryFn: api.settings.get });
  const translations = useQuery({ queryKey: ['translations', sop.id, sop.updatedAt], queryFn: () => api.sops.translations(sop.id) });
  const jobs = useQuery({
    queryKey: ['jobs', 'translate'],
    queryFn: () => api.jobs.list('translate'),
    refetchInterval: (q) => (q.state.data?.some((j) => j.status === 'queued' || j.status === 'running') ? 1500 : false),
  });

  const running = (jobs.data ?? []).filter((j) => (j.status === 'queued' || j.status === 'running') && j.title.includes(sop.number));
  const wasRunning = useRef(0);
  useEffect(() => {
    if (wasRunning.current > 0 && running.length === 0) {
      void qc.invalidateQueries({ queryKey: ['translations', sop.id] });
      void qc.invalidateQueries({ queryKey: ['sop-languages', sop.id] });
      const failed = jobs.data?.find((j) => j.status === 'error' && j.title.includes(sop.number));
      if (failed && Date.now() - new Date(failed.updatedAt).getTime() < 10000) toast.error(failed.error ?? 'Translation failed');
      onChanged();
    }
    wasRunning.current = running.length;
  }, [running.length, jobs.data, qc, sop.id, sop.number, toast, onChanged]);

  const enabled = settings.data?.languages.enabled ?? [];
  const existing = translations.data ?? [];
  const codes = [...new Set([...enabled, ...existing.map((t) => t.language)])];

  const translate = async (code: string) => {
    try {
      await api.sops.translate(sop.id, code);
      void qc.invalidateQueries({ queryKey: ['jobs', 'translate'] });
    } catch (e) {
      toast.error(e);
    }
  };

  return (
    <Card title={<span className="flex items-center gap-1.5"><Languages className="size-4" /> Translations</span>} bodyClassName="space-y-2">
      {!codes.length && (
        <p className="text-sm text-slate-500">
          No languages are turned on. Add them under <Link to="/admin/languages" className="font-medium text-brand hover:underline">Admin → Languages</Link>.
        </p>
      )}
      {codes.map((code) => {
        const lang = languageInfo(code);
        const t = existing.find((x) => x.language === code);
        const busy = running.some((j) => j.title.startsWith(`${lang.name}:`) || j.title.startsWith(`${code.toUpperCase()}:`));
        return (
          <div key={code} className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2">
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium">{lang.native}</div>
              <div className="text-xs text-slate-500">
                {busy ? (
                  <span className="inline-flex items-center gap-1 text-brand">
                    <Loader2 className="size-3 animate-spin" /> Translating…
                  </span>
                ) : !t ? (
                  'Not translated'
                ) : t.outdated ? (
                  <Badge color="#d97706">English changed since Rev {t.sourceVersion}</Badge>
                ) : t.status === 'reviewed' ? (
                  <Badge color="#16a34a">Reviewed</Badge>
                ) : (
                  <Badge color="#2563eb">AI translation, not reviewed</Badge>
                )}
              </div>
            </div>
            {t && !busy && (
              <Link to={`/sops/${sop.id}/translate/${code}`}>
                <Button size="sm" icon={<Pencil className="size-3.5" />}>
                  Review
                </Button>
              </Link>
            )}
            {!busy && (
              <Button size="sm" variant={t && !t.outdated ? 'ghost' : 'subtle'} icon={<RefreshCw className="size-3.5" />} onClick={() => (t && !t.outdated && t.status === 'reviewed' ? confirm('Translate again? This replaces the reviewed translation.') && translate(code) : translate(code))}>
                {t ? 'Redo' : 'Translate'}
              </Button>
            )}
          </div>
        );
      })}
      {codes.length > 0 && <p className="text-xs text-slate-500">Floor staff only see a translation once it matches the approved English text.</p>}
    </Card>
  );
}
