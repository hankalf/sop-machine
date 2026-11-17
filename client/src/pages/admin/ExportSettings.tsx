import { Card, Field, Input, PageLoader, Segmented, Select, Toggle } from '../../components/ui';
import { SaveBar } from './SaveBar';
import { useSettingsForm } from './useSettingsForm';

export default function ExportSettings() {
  const { form, set, save, saving, dirty, reset, loading } = useSettingsForm();
  if (loading || !form) return <PageLoader />;
  const e = form.export;
  const example = e.filenamePattern
    .replace('{number}', 'WH-TRL-001')
    .replace('{title}', 'Trailer Check-In')
    .replace('{version}', '2.0')
    .replace('{status}', 'Approved')
    .replace('{date}', new Date().toISOString().slice(0, 10))
    .replace('{company}', form.branding.companyName);

  return (
    <div className="grid max-w-5xl gap-6 lg:grid-cols-2">
      <Card title="Export" description="How SOPs are exported. The page layout itself is designed in Templates." bodyClassName="space-y-5">
        <Field group label="Default format" hint="The main Export button uses this format. The other one is always available too.">
          <Segmented value={e.defaultFormat} onChange={(v) => set('export', { defaultFormat: v })} options={[{ value: 'pdf', label: 'PDF' }, { value: 'docx', label: 'Word (.docx)' }]} />
        </Field>
        <Field label="File name" hint={<>Tokens: {'{number} {title} {version} {status} {date} {company}'}. Example: <strong>{example}.pdf</strong></>}>
          <Input value={e.filenamePattern} onChange={(ev) => set('export', { filenamePattern: ev.target.value })} />
        </Field>
        <Field label="Videos in printed SOPs">
          <Select value={e.videoHandling} onChange={(ev) => set('export', { videoHandling: ev.target.value as typeof e.videoHandling })}>
            <option value="qr">Thumbnail with a QR code that opens the video</option>
            <option value="thumbnail">Thumbnail only</option>
            <option value="omit">Leave videos out</option>
          </Select>
        </Field>
        <Field group label="Image quality in PDFs">
          <Segmented value={e.imageQuality} onChange={(v) => set('export', { imageQuality: v })} options={[{ value: 'standard', label: 'Standard (smaller files)' }, { value: 'high', label: 'High (sharper zoom)' }]} />
        </Field>
        <Toggle checked={e.allowViewerExport} onChange={(v) => set('export', { allowViewerExport: v })} label="Let viewers export" description="Viewers can download approved SOPs as PDF or Word." />
      </Card>

      <div className="space-y-6">
        <Card title="Approval workflow" bodyClassName="space-y-5">
          <Toggle checked={form.workflow.requireApproval} onChange={(v) => set('workflow', { requireApproval: v })} label="Only admins can approve" description="Editors submit SOPs for review; an admin approves and publishes them." />
          <Toggle checked={form.training.enabled} onChange={(v) => set('training', { enabled: v })} label="Training sign-off" description="Ask people to confirm they have read and understood each approved SOP, and again after every new revision." />
          <Field label="Review every (months)" hint="Sets the next review date on approval. 0 turns it off. SOPs due within 30 days are flagged in the library.">
            <Input type="number" min={0} max={60} value={form.workflow.reviewIntervalMonths} onChange={(ev) => set('workflow', { reviewIntervalMonths: Number(ev.target.value) })} />
          </Field>
        </Card>
        <Card title="SOP numbering" description="New SOPs are numbered PREFIX-CATEGORY-001." bodyClassName="grid grid-cols-2 gap-4">
          <Field label="Prefix">
            <Input value={form.numbering.prefix} onChange={(ev) => set('numbering', { prefix: ev.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '') })} />
          </Field>
          <Field label="Digits">
            <Input type="number" min={1} max={6} value={form.numbering.digits} onChange={(ev) => set('numbering', { digits: Number(ev.target.value) })} />
          </Field>
          <p className="col-span-2 text-xs text-slate-500">
            Next Trailer & Dock SOP: <strong className="font-mono">{[form.numbering.prefix, 'TRL', '1'.padStart(form.numbering.digits, '0')].filter(Boolean).join('-')}</strong>
          </p>
        </Card>
      </div>
      <div className="lg:col-span-2">
        <SaveBar dirty={dirty} saving={saving} onSave={save} onReset={reset} />
      </div>
    </div>
  );
}
