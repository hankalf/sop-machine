import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, Download, XCircle } from 'lucide-react';
import { useState } from 'react';
import { api, downloadFile } from '../../api';
import { useToast } from '../../components/Toast';
import { Button, Card, formatBytes, PageLoader } from '../../components/ui';

export default function SystemPage() {
  const info = useQuery({ queryKey: ['system'], queryFn: api.system });
  const [downloading, setDownloading] = useState(false);
  const toast = useToast();
  if (info.isLoading || !info.data) return <PageLoader />;
  const d = info.data;
  const used = d.disk.uploadsBytes + d.disk.databaseBytes;
  const pct = d.disk.totalBytes ? Math.min(100, ((d.disk.totalBytes - (d.disk.freeBytes ?? 0)) / d.disk.totalBytes) * 100) : null;

  const backup = async () => {
    setDownloading(true);
    try {
      await downloadFile('/api/system/backup');
    } catch (e) {
      toast.error(e);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="grid max-w-5xl gap-6 lg:grid-cols-2">
      <Card title="Storage" description={`Files are stored on the Railway volume at ${d.dataDir}`}>
        <div className="text-3xl font-bold">{formatBytes(used)}</div>
        <div className="text-sm text-slate-500">
          {formatBytes(d.disk.uploadsBytes)} of media · {formatBytes(d.disk.databaseBytes)} database
        </div>
        {pct !== null && (
          <div className="mt-4">
            <div className="h-2 overflow-hidden rounded-full bg-slate-100">
              <div className={`h-full rounded-full ${pct > 85 ? 'bg-red-500' : 'bg-brand'}`} style={{ width: `${pct}%` }} />
            </div>
            <p className="mt-1 text-xs text-slate-500">
              {formatBytes(d.disk.freeBytes ?? 0)} free of {formatBytes(d.disk.totalBytes ?? 0)} on the volume
            </p>
          </div>
        )}
        <dl className="mt-5 grid grid-cols-2 gap-3 text-sm">
          {Object.entries(d.counts).map(([k, v]) => (
            <div key={k} className="rounded-lg bg-slate-50 px-3 py-2">
              <dt className="text-xs text-slate-500 capitalize">{k === 'sops' ? 'SOPs' : k}</dt>
              <dd className="text-lg font-semibold">{v}</dd>
            </div>
          ))}
        </dl>
      </Card>
      <div className="space-y-6">
        <Card title="Backup" description="Download the database and every uploaded file as one zip. Keep a copy off Railway.">
          <Button variant="primary" icon={<Download className="size-4" />} loading={downloading} onClick={backup}>
            Download full backup
          </Button>
          <p className="mt-3 text-xs text-slate-500">Railway can also take scheduled volume backups (service → Volume → Backups).</p>
        </Card>
        <Card title="Health" bodyClassName="space-y-2 text-sm">
          <Status ok={d.pdfEngine.ok} label="PDF engine" detail={d.pdfEngine.detail} />
          <Status ok={d.aiConfigured} label="AI generation" detail={d.aiConfigured ? d.aiModel : 'ANTHROPIC_API_KEY not set'} />
          <Status ok={!d.appUrl.includes('localhost')} label="Public URL (used in QR codes)" detail={d.appUrl} />
          <p className="pt-2 text-xs text-slate-400">
            App {d.versions.app} · Node {d.versions.node}
          </p>
        </Card>
      </div>
    </div>
  );
}

function Status({ ok, label, detail }: { ok: boolean; label: string; detail: string }) {
  return (
    <div className="flex items-start gap-2">
      {ok ? <CheckCircle2 className="mt-0.5 size-4 text-emerald-600" /> : <XCircle className="mt-0.5 size-4 text-amber-600" />}
      <div>
        <div className="font-medium">{label}</div>
        <div className="text-xs break-all text-slate-500">{detail}</div>
      </div>
    </div>
  );
}
