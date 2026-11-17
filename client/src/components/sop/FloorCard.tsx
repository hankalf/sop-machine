import { useQuery } from '@tanstack/react-query';
import { ListChecks, MapPin, QrCode } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { Sop } from '@shared/types';
import { api, downloadFile } from '../../api';
import { useCan } from '../../auth';
import { useToast } from '../Toast';
import { Button, Card, Select } from '../ui';

/** Checklist start, QR placards and the stations where this SOP is posted. */
export function FloorCard({ sop, language }: { sop: Sop; language: string }) {
  const isEditor = useCan('editor');
  const navigate = useNavigate();
  const toast = useToast();
  const [size, setSize] = useState('letter');
  const [stationId, setStationId] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const stations = useQuery({ queryKey: ['sop-stations', sop.id], queryFn: () => api.sops.stations(sop.id), enabled: isEditor });
  const checklist = sop.content.checklist.enabled;
  if (!isEditor && !checklist) return null;

  const start = async () => {
    setBusy('run');
    try {
      const run = await api.sops.startRun(sop.id, language);
      navigate(`/run/${run.token}`);
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(null);
    }
  };

  const placard = async () => {
    setBusy('qr');
    try {
      await downloadFile(`/api/sops/${sop.id}/placard?size=${size}${stationId ? `&stationId=${stationId}` : ''}`);
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card title={<span className="flex items-center gap-1.5"><QrCode className="size-4" /> On the floor</span>} bodyClassName="space-y-3">
      {checklist && (
        <div>
          <Button variant="primary" className="w-full" icon={<ListChecks className="size-4" />} onClick={start} loading={busy === 'run'} disabled={!sop.publishedVersion && !isEditor}>
            Start checklist
          </Button>
          {isEditor && (
            <Link to={`/records?sopId=${sop.id}`} className="mt-1.5 block text-center text-xs font-medium text-brand hover:underline">
              View completed checklists
            </Link>
          )}
        </div>
      )}
      {isEditor && (
        <>
          <div className={checklist ? 'border-t border-slate-100 pt-3' : ''}>
            <div className="mb-1.5 text-xs font-semibold text-slate-600">QR placard for this SOP</div>
            <div className="flex gap-2">
              <Select value={stationId} onChange={(e) => setStationId(e.target.value)} className="h-8 flex-1 text-xs" title="A station link lets floor staff open it without signing in (if the station allows it)">
                <option value="">Sign-in link</option>
                {stations.data?.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
              <Select value={size} onChange={(e) => setSize(e.target.value)} className="h-8 w-24 text-xs">
                <option value="letter">Letter</option>
                <option value="half">Half</option>
                <option value="card">4×6</option>
              </Select>
            </div>
            <Button size="sm" className="mt-2 w-full" icon={<QrCode className="size-3.5" />} onClick={placard} loading={busy === 'qr'}>
              Download placard
            </Button>
          </div>
          <div className="border-t border-slate-100 pt-3 text-sm">
            <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-slate-600">
              <MapPin className="size-3.5" /> Posted at
            </div>
            {stations.data?.length ? (
              <ul className="space-y-0.5">
                {stations.data.map((s) => (
                  <li key={s.id} className="text-slate-700">
                    {s.name} {s.area && <span className="text-slate-400">· {s.area}</span>}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-slate-500">No stations yet.</p>
            )}
            <Link to="/stations" className="mt-1 inline-block text-xs font-medium text-brand hover:underline">
              Manage stations
            </Link>
          </div>
        </>
      )}
    </Card>
  );
}
