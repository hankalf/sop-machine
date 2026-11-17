import { CircleHelp, Plus, Sparkles, Trash2 } from 'lucide-react';
import { useState } from 'react';
import type { QuizConfig, QuizQuestion } from '@shared/types';
import { api } from '../../api';
import { useToast } from '../Toast';
import { Button, Card, cx, IconButton, Input, Toggle } from '../ui';

const blank = (): QuizQuestion => ({ id: Math.random().toString(36).slice(2, 12), question: '', options: ['', '', ''], correctIndex: 0, explanation: '' });

/** Editor for the quiz people answer before signing off. */
export function QuizEditorCard({ sopId, value, onChange, beforeSuggest }: { sopId: string; value: QuizConfig; onChange: (q: QuizConfig) => void; beforeSuggest: () => Promise<void> }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const set = (questions: QuizQuestion[]) => onChange({ ...value, questions });
  const upd = (i: number, p: Partial<QuizQuestion>) => set(value.questions.map((q, j) => (j === i ? { ...q, ...p } : q)));

  const suggest = async () => {
    setBusy(true);
    try {
      await beforeSuggest();
      const add = await api.sops.suggestQuiz(sopId, Math.max(1, Math.min(3, 10 - value.questions.length)));
      onChange({ enabled: true, questions: [...value.questions, ...add].slice(0, 10) });
      toast.success(`Added ${add.length} suggested question${add.length === 1 ? '' : 's'}. Check each one before approving.`);
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card
      title={<span className="flex items-center gap-1.5"><CircleHelp className="size-4" /> Sign-off quiz</span>}
      description="People answer a few questions before they can sign off, so a signature shows they understood the SOP. Supervisors recording a training session skip it."
      actions={<Toggle checked={value.enabled} onChange={(enabled) => onChange({ ...value, enabled, questions: enabled && !value.questions.length ? [blank()] : value.questions })} />}
      bodyClassName={value.enabled ? 'space-y-4' : 'hidden'}
    >
      {value.questions.map((q, i) => (
        <div key={q.id} className="space-y-2 rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-slate-400">{i + 1}</span>
            <Input value={q.question} onChange={(e) => upd(i, { question: e.target.value })} placeholder="Question, e.g. When can you enter the trailer?" className="flex-1 font-medium" />
            <IconButton label="Remove question" className="hover:text-red-600" onClick={() => set(value.questions.filter((_, j) => j !== i))}>
              <Trash2 className="size-4" />
            </IconButton>
          </div>
          <div className="space-y-1.5 pl-5">
            {q.options.map((o, oi) => (
              <div key={oi} className="flex items-center gap-2">
                <label className={cx('flex shrink-0 cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-semibold', q.correctIndex === oi ? 'bg-emerald-100 text-emerald-800' : 'text-slate-400 hover:text-slate-700')}>
                  <input type="radio" name={`correct-${q.id}`} checked={q.correctIndex === oi} onChange={() => upd(i, { correctIndex: oi })} className="size-3.5 accent-emerald-600" />
                  {q.correctIndex === oi ? 'Correct' : 'Wrong'}
                </label>
                <Input value={o} onChange={(e) => upd(i, { options: q.options.map((x, xi) => (xi === oi ? e.target.value : x)) })} placeholder={`Answer ${oi + 1}`} className="h-8 flex-1" />
                {q.options.length > 2 && (
                  <IconButton
                    label="Remove answer"
                    className="size-7"
                    onClick={() => upd(i, { options: q.options.filter((_, xi) => xi !== oi), correctIndex: q.correctIndex > oi ? q.correctIndex - 1 : q.correctIndex === oi ? 0 : q.correctIndex })}
                  >
                    <Trash2 className="size-3.5" />
                  </IconButton>
                )}
              </div>
            ))}
            {q.options.length < 5 && (
              <button type="button" onClick={() => upd(i, { options: [...q.options, ''] })} className="text-xs font-medium text-brand hover:underline">
                + Add answer
              </button>
            )}
            <Input value={q.explanation} onChange={(e) => upd(i, { explanation: e.target.value })} placeholder="Hint shown after a wrong answer, e.g. See step 2: check the dock lock light." className="h-8 text-xs" />
          </div>
        </div>
      ))}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" icon={<Plus className="size-3.5" />} onClick={() => set([...value.questions, blank()])} disabled={value.questions.length >= 10}>
          Add question
        </Button>
        <Button size="sm" variant="subtle" icon={<Sparkles className="size-3.5" />} onClick={suggest} loading={busy} disabled={value.questions.length >= 10}>
          Suggest questions with AI
        </Button>
      </div>
      <p className="text-xs text-slate-500">Questions with fewer than two answers are skipped. Translations include the quiz, so re-translate after editing it.</p>
    </Card>
  );
}
