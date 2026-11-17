import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, XCircle } from 'lucide-react';
import { api } from '../../api';
import { Card, Field, Input, PageLoader, Select, Textarea, Toggle } from '../../components/ui';
import { SaveBar } from './SaveBar';
import { useSettingsForm } from './useSettingsForm';

const MODELS = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5 (best quality, recommended)' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5 (faster, lower cost)' },
];

export default function AiSettings() {
  const { form, set, save, saving, dirty, reset, loading } = useSettingsForm();
  const status = useQuery({ queryKey: ['ai-status'], queryFn: api.generate.status });
  if (loading || !form) return <PageLoader />;
  const a = form.ai;
  return (
    <div className="grid max-w-5xl gap-6 lg:grid-cols-2">
      <Card title="Connection">
        {status.data?.configured ? (
          <p className="flex items-center gap-2 text-sm text-emerald-700">
            <CheckCircle2 className="size-5" /> Connected. AI generation is available to editors.
          </p>
        ) : (
          <div className="space-y-2 text-sm text-slate-700">
            <p className="flex items-center gap-2 font-medium text-red-700">
              <XCircle className="size-5" /> Not connected
            </p>
            <p>
              Create an API key at <span className="font-mono">console.anthropic.com</span>, then add it in Railway: your service → <strong>Variables</strong> → <code className="rounded bg-slate-100 px-1">ANTHROPIC_API_KEY</code>. Railway redeploys automatically.
            </p>
          </div>
        )}
        <p className="mt-4 text-xs text-slate-500">
          A 5-minute screen recording typically costs well under a dollar to convert. Uploaded recordings and documents are sent to Anthropic for processing.
        </p>
      </Card>
      <Card title="Model" bodyClassName="space-y-4">
        <Field label="Model">
          <Select value={a.model} onChange={(e) => set('ai', { model: e.target.value })}>
            {MODELS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
            {!MODELS.some((m) => m.id === a.model) && <option value={a.model}>{a.model}</option>}
          </Select>
        </Field>
        <Field label="Effort" hint="Higher effort reads recordings more carefully but takes longer.">
          <Select value={a.effort} onChange={(e) => set('ai', { effort: e.target.value as typeof a.effort })}>
            <option value="medium">Medium</option>
            <option value="high">High (recommended)</option>
            <option value="xhigh">Extra high</option>
          </Select>
        </Field>
        <Field label="Max frames per recording" hint="5–80. More frames capture more detail in long recordings.">
          <Input type="number" min={5} max={80} value={a.maxFrames} onChange={(e) => set('ai', { maxFrames: Number(e.target.value) })} />
        </Field>
        <Toggle checked={a.autoHighlight} onChange={(v) => set('ai', { autoHighlight: v })} label="Highlight what to click" description="Draws a red box around the button or field in each screenshot. You can redo it in the editor." />
      </Card>
      <Card title="Writing style" className="lg:col-span-2" bodyClassName="space-y-4">
        <Field label="House style" hint="Applied to every generated or imported SOP.">
          <Textarea value={a.writingStyle} onChange={(e) => set('ai', { writingStyle: e.target.value })} className="min-h-24" />
        </Field>
        <Field label="Extra instructions" hint="Site-specific rules, e.g. 'Always include a step to scan your badge at the dock door' or 'Write for bilingual English/Spanish readers'.">
          <Textarea value={a.extraInstructions} onChange={(e) => set('ai', { extraInstructions: e.target.value })} />
        </Field>
      </Card>
      <div className="lg:col-span-2">
        <SaveBar dirty={dirty} saving={saving} onSave={save} onReset={reset} />
      </div>
    </div>
  );
}
