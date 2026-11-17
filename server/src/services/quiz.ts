import { usableQuestions } from '../../../shared/defaults';
import type { QuizQuestionPublic, QuizResult, Sop, SopTranslation } from '../../../shared/types';
import { db } from '../db';
import { newId, nowIso } from '../util';

/** Questions as shown to the person signing off: no answer key, in their language when translated. */
export function publicQuestions(sop: Sop, translation: SopTranslation | null): QuizQuestionPublic[] {
  const all = sop.content.quiz.questions;
  const usable = new Set(usableQuestions(all).map((q) => q.id));
  return all
    .map((q, i) => {
      const t = translation?.content.quiz[i];
      return {
        id: q.id,
        question: t?.question?.trim() || q.question,
        options: q.options.map((o, oi) => t?.options[oi]?.trim() || o),
      };
    })
    .filter((q) => usable.has(q.id));
}

export function gradeQuiz(sop: Sop, answers: Record<string, number>, translation: SopTranslation | null): QuizResult {
  const all = sop.content.quiz.questions;
  const wrong: string[] = [];
  const explanations: Record<string, string> = {};
  for (const q of usableQuestions(all)) {
    if (answers?.[q.id] === q.correctIndex) continue;
    wrong.push(q.id);
    const t = translation?.content.quiz[all.indexOf(q)];
    const text = t?.explanation?.trim() || q.explanation;
    if (text.trim()) explanations[q.id] = text;
  }
  return { passed: wrong.length === 0, wrong, explanations };
}

export function recordAttempt(sop: Sop, personKey: string, result: QuizResult) {
  const total = usableQuestions(sop.content.quiz.questions).length;
  db.prepare('INSERT INTO quiz_attempts (id, sop_id, version, person_key, correct, total, passed, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
    newId(),
    sop.id,
    sop.version,
    personKey,
    total - result.wrong.length,
    total,
    result.passed ? 1 : 0,
    nowIso(),
  );
}
