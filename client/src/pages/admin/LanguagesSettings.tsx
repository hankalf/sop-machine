import { LANGUAGES } from '@shared/defaults';
import { Card, cx, Field, PageLoader, Textarea, Toggle } from '../../components/ui';
import { SaveBar } from './SaveBar';
import { useSettingsForm } from './useSettingsForm';

export default function LanguagesSettings() {
  const { form, set, save, saving, dirty, reset, loading } = useSettingsForm();
  if (loading || !form) return <PageLoader />;
  const l = form.languages;
  const toggle = (code: string) => set('languages', { enabled: l.enabled.includes(code) ? l.enabled.filter((c) => c !== code) : [...l.enabled, code] });
  return (
    <div className="grid max-w-5xl gap-6 lg:grid-cols-2">
      <Card title="Languages" description="SOPs are written in English. Pick the other languages your team reads.">
        <div className="grid grid-cols-2 gap-2">
          {LANGUAGES.map((lang) => {
            const on = l.enabled.includes(lang.code);
            return (
              <button key={lang.code} onClick={() => toggle(lang.code)} className={cx('rounded-lg px-3 py-2 text-left text-sm ring-1 transition', on ? 'bg-brand/5 ring-2 ring-brand' : 'ring-slate-200 hover:ring-slate-400')}>
                <div className={cx('font-medium', on && 'text-brand')}>{lang.native}</div>
                <div className="text-xs text-slate-500">{lang.name}</div>
              </button>
            );
          })}
        </div>
      </Card>
      <div className="space-y-6">
        <Card title="How translations work" bodyClassName="space-y-4">
          <Toggle
            checked={l.autoTranslate}
            onChange={(v) => set('languages', { autoTranslate: v })}
            label="Translate automatically on approval"
            description="When an SOP is approved, AI translates it into each language above. Otherwise use the Translate button on the SOP."
          />
          <ul className="list-disc space-y-1 pl-5 text-sm text-slate-600">
            <li>Each language can be shown on its own or bilingual, with the translation under the English.</li>
            <li>Button and screen names stay in English (as shown on screen) with the translation in parentheses.</li>
            <li>A bilingual team member can review and correct each translation side by side.</li>
            <li>Floor staff only see a translation that matches the approved English text. Until then they see English.</li>
          </ul>
        </Card>
        <Card title="Glossary">
          <Field label="Terms and preferences" hint="One per line. For example: 'pallet jack = patín hidráulico' or 'Do not translate: LPN, BOL, dock lock'.">
            <Textarea value={l.glossary} onChange={(e) => set('languages', { glossary: e.target.value })} className="min-h-28" />
          </Field>
        </Card>
      </div>
      <div className="lg:col-span-2">
        <SaveBar dirty={dirty} saving={saving} onSave={save} onReset={reset} />
      </div>
    </div>
  );
}
