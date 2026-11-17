import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, CloudUpload, Download, XCircle } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, downloadFile } from '../../api';
import { useToast } from '../../components/Toast';
import { Button, Card, formatBytes, PageLoader } from '../../components/ui';

export default function SystemPage() {
  const info = useQuery({ queryKey: ['system'], queryFn: api.system });
  const [downloading, setDownloading] = useState(false);
  const toast = useToast();
  const qc = useQueryClient();
  const moves = useQuery({
    queryKey: ['jobs', 'storage'],
    queryFn: () => api.jobs.list('storage'),
    refetchInterval: (q) => {
      const active = q.state.data?.some((j) => j.status === 'queued' || j.status === 'running');
      if (!active && q.state.data?.length) void qc.invalidateQueries({ queryKey: ['system'] });
      return active ? 1500 : false;
    },
  });
  const moving = moves.data?.find((j) => j.status === 'queued' || j.status === 'running');
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
      <Card title="Storage" description={d.storage.driver === 's3' ? `Uploads go to the bucket "${d.storage.bucket}". The database and image previews stay on the volume at ${d.dataDir}.` : `Files are stored on the Railway volume at ${d.dataDir}`}>
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
        <div className="mt-5 rounded-lg bg-slate-50 p-3 text-sm">
          <div className="flex items-center gap-2 font-medium">
            <CloudUpload className="size-4 text-slate-500" /> Object storage
            {d.storage.driver === 's3' ? <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-800">On</span> : <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[11px] font-semibold text-slate-700">Off</span>}
          </div>
          {d.storage.driver === 's3' ? (
            <>
              <p className="mt-1 text-xs text-slate-600">
                {d.storage.objectFiles} files in the bucket · {d.storage.localFiles} still on the volume
              </p>
              {moving ? (
                <p className="mt-2 text-xs font-medium text-brand">{moving.message}…</p>
              ) : (
                d.storage.localFiles > 0 && (
                  <Button size="sm" className="mt-2" icon={<CloudUpload className="size-3.5" />} onClick={() => api.migrateStorage().then(() => qc.invalidateQueries({ queryKey: ['jobs', 'storage'] })).catch(toast.error)}>
                    Move {d.storage.localFiles} files to the bucket
                  </Button>
                )
              )}
            </>
          ) : (
            <p className="mt-1 text-xs text-slate-600">
              Videos fill a volume quickly. To keep them in a bucket instead, add a Railway Bucket (or any S3-compatible storage) and set <code className="rounded bg-white px-1">S3_BUCKET</code>, <code className="rounded bg-white px-1">S3_ENDPOINT</code>,{' '}
              <code className="rounded bg-white px-1">S3_ACCESS_KEY_ID</code> and <code className="rounded bg-white px-1">S3_SECRET_ACCESS_KEY</code>. Existing files can then be moved with one click.
            </p>
          )}
        </div>
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
          <Status ok={d.email.configured} label="Email" detail={d.email.from ?? 'SMTP not set'} />
          <Status ok={d.transcription.configured} label="Speech-to-text (narrated recordings)" detail={d.transcription.model ?? 'Not set (optional)'} />
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
