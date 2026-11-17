import { ImageUp, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../../api';
import { useAuth } from '../../auth';
import { useToast } from '../../components/Toast';
import { Button, Card, ColorInput, Field, Input, PageLoader } from '../../components/ui';
import { SaveBar } from './SaveBar';
import { useSettingsForm } from './useSettingsForm';

const APP_COLORS = ['#1e3a8a', '#0f766e', '#111827', '#b91c1c', '#7c3aed', '#c2410c', '#15803d'];

export default function BrandingSettings() {
  const { form, set, save, saving, dirty, reset, loading } = useSettingsForm();
  const { branding, refresh } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  if (loading || !form) return <PageLoader />;

  const uploadLogo = async (file: File) => {
    setUploading(true);
    try {
      const s = await api.settings.uploadLogo(file);
      qc.setQueryData(['settings'], s);
      refresh();
      toast.success('Logo updated. It appears on every SOP export and in the app.');
    } catch (e) {
      toast.error(e);
    } finally {
      setUploading(false);
    }
  };

  const removeLogo = async () => {
    const s = await api.settings.removeLogo();
    qc.setQueryData(['settings'], s);
    refresh();
  };

  return (
    <div className="grid max-w-5xl gap-6 lg:grid-cols-2">
      <Card title="Logo" description="Used on cover pages, page headers, Word exports, the login screen and the sidebar.">
        <div className="flex flex-col items-center gap-4">
          <div className="flex h-36 w-full items-center justify-center rounded-xl bg-[repeating-conic-gradient(#f1f5f9_0_25%,#fff_0_50%)] bg-[length:20px_20px] ring-1 ring-slate-200">
            {branding?.hasLogo ? <img src={`/api/public/logo?v=${branding.logoVersion}`} alt="Logo" className="max-h-28 max-w-[80%] object-contain" /> : <span className="text-sm text-slate-400">No logo yet</span>}
          </div>
          <div className="flex gap-2">
            <Button variant="primary" icon={<ImageUp className="size-4" />} loading={uploading} onClick={() => input.current?.click()}>
              {branding?.hasLogo ? 'Replace logo' : 'Upload logo'}
            </Button>
            {branding?.hasLogo && (
              <Button icon={<Trash2 className="size-4" />} onClick={removeLogo}>
                Remove
              </Button>
            )}
          </div>
          <p className="text-center text-xs text-slate-500">PNG with a transparent background or SVG works best. Wide logos fit headers better than square ones.</p>
          <input ref={input} type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp" className="hidden" onChange={(e) => e.target.files?.[0] && uploadLogo(e.target.files[0])} />
        </div>
      </Card>

      <Card title="Company" bodyClassName="space-y-4">
        <Field label="Company name" hint="Printed on SOPs. Use {company} in header and footer text.">
          <Input value={form.branding.companyName} onChange={(e) => set('branding', { companyName: e.target.value })} />
        </Field>
        <Field label="App name" hint="Shown in the browser tab and on the login screen.">
          <Input value={form.branding.siteName} onChange={(e) => set('branding', { siteName: e.target.value })} />
        </Field>
        <div>
          <ColorInput label="App accent color" value={form.branding.appColor} onChange={(v) => set('branding', { appColor: v })} />
          <div className="mt-2 flex gap-1.5">
            {APP_COLORS.map((c) => (
              <button key={c} onClick={() => set('branding', { appColor: c })} className="size-6 rounded-full ring-1 ring-black/10" style={{ background: c }} aria-label={c} />
            ))}
          </div>
          <p className="mt-2 text-xs text-slate-500">This colors the app itself. Colors for printed SOPs are set per template.</p>
        </div>
      </Card>
      <div className="lg:col-span-2">
        <SaveBar dirty={dirty} saving={saving} onSave={save} onReset={reset} />
      </div>
    </div>
  );
}
