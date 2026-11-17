import { CircleAlert } from 'lucide-react';
import type { QuizQuestionPublic, QuizResult } from '@shared/types';
import { cx } from '../ui';

/** Multiple-choice questions shown before someone can sign off. */
export function QuizForm({
  questions,
  answers,
  onAnswer,
  result,
  intro,
  wrongText,
  large,
}: {
  questions: QuizQuestionPublic[];
  answers: Record<string, number>;
  onAnswer: (questionId: string, option: number) => void;
  result: QuizResult | null;
  intro: string;
  wrongText: string;
  large?: boolean;
}) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600">{intro}</p>
      {result && !result.passed && (
        <p className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-amber-200">
          <CircleAlert className="mt-0.5 size-4 shrink-0" /> {wrongText}
        </p>
      )}
      {questions.map((q, qi) => {
        const wrong = result?.wrong.includes(q.id);
        return (
          <fieldset key={q.id} className={cx('rounded-xl p-3 ring-1', wrong ? 'bg-red-50/60 ring-red-300' : 'ring-slate-200')}>
            {/* Floated so the question sits inside the box instead of on its edge. */}
            <legend className={cx('float-left mb-2 w-full px-1 font-semibold', large ? 'text-base' : 'text-sm')}>
              {qi + 1}. {q.question}
            </legend>
            <div className="clear-left space-y-1.5">
              {q.options.map((o, oi) => (
                <label
                  key={oi}
                  className={cx(
                    'flex cursor-pointer items-start gap-3 rounded-lg px-3 ring-1 transition',
                    large ? 'py-3 text-base' : 'py-2 text-sm',
                    answers[q.id] === oi ? 'bg-brand/5 ring-2 ring-brand' : 'bg-white ring-slate-200 hover:ring-slate-400',
                  )}
                >
                  <input type="radio" name={q.id} checked={answers[q.id] === oi} onChange={() => onAnswer(q.id, oi)} className="mt-0.5 size-4 shrink-0 accent-[var(--brand)]" />
                  <span>{o}</span>
                </label>
              ))}
            </div>
            {wrong && result?.explanations[q.id] && <p className="mt-2 px-1 text-sm text-red-800">{result.explanations[q.id]}</p>}
          </fieldset>
        );
      })}
    </div>
  );
}
