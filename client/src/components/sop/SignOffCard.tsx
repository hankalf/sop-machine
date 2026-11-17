import { useQuery, useQueryClient } from '@tanstack/react-query';
import { BadgeCheck, ClipboardSignature, RefreshCw, Trash2, UserPlus } from 'lucide-react';
import { useState } from 'react';
import type { QuizQuestionPublic, QuizResult, Sop } from '@shared/types';
import { QuizForm } from '../quiz/QuizForm';
import { api } from '../../api';
import { useCan } from '../../auth';
import { useToast } from '../Toast';
import { Button, Card, Field, IconButton, Modal, Textarea } from '../ui';

/** "Read and understood" sign-off, plus the training record for editors. */
export function SignOffCard({ sop, language }: { sop: Sop; language: string }) {
  const isEditor = useCan('editor');
  const isAdmin = useCan('admin');
  const qc = useQueryClient();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [quiz, setQuiz] = useState<QuizQuestionPublic[] | null>(null);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [result, setResult] = useState<QuizResult | null>(null);
  const acks = useQuery({ queryKey: ['acks', sop.id], queryFn: () => api.sops.acknowledgments(sop.id) });

  if (!sop.publishedVersion) {
    return isEditor ? (
      <Card title={<Title />}>
        <p className="text-sm text-slate-500">Sign-off opens once this SOP is approved.</p>
      </Card>
    ) : null;
  }

  const mine = acks.data?.mine ?? null;
  const all = acks.data?.all ?? [];
  const current = all.filter((a) => a.current).length;
  const refresh = () => qc.invalidateQueries({ queryKey: ['acks', sop.id] });

  const sign = async () => {
    setBusy(true);
    try {
      if (!quiz) {
        const q = await api.sops.quiz(sop.id, language);
        if (q.questions.length) {
          setAnswers({});
          setResult(null);
          setQuiz(q.questions);
          return;
        }
      }
      const r = await api.sops.acknowledge(sop.id, answers, language);
      if (r.quiz && !r.quiz.passed) {
        setResult(r.quiz);
        return;
      }
      setQuiz(null);
      await refresh();
      toast.success(`Signed off on revision ${sop.publishedVersion}`);
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title={<Title />} bodyClassName="space-y-3">
      {mine?.current ? (
        <p className="flex items-start gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          <BadgeCheck className="mt-0.5 size-4 shrink-0" />
          You signed off on revision {mine.version} on {new Date(mine.createdAt).toLocaleDateString()}.
        </p>
      ) : (
        <>
          {mine && (
            <p className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
              <RefreshCw className="mt-0.5 size-4 shrink-0" />
              This SOP was updated since you signed revision {mine.version}. Please read it again.
            </p>
          )}
          <Button variant="primary" className="w-full" icon={<ClipboardSignature className="size-4" />} onClick={sign} loading={busy}>
            I have read and understood Rev {sop.publishedVersion}
          </Button>
        </>
      )}

      {isEditor && (
        <div className="border-t border-slate-100 pt-3">
          <div className="flex items-center justify-between">
            <button className="text-sm font-medium text-slate-700 hover:text-brand" onClick={() => setShowAll(!showAll)}>
              {current} signed the current revision
              {all.length > current && <span className="text-amber-700"> · {all.length - current} need to re-sign</span>}
            </button>
            <Button size="sm" icon={<UserPlus className="size-3.5" />} onClick={() => setRecording(true)}>
              Record
            </Button>
          </div>
          {showAll && all.length > 0 && (
            <ul className="mt-2 max-h-56 space-y-1 overflow-y-auto text-xs scrollbar-thin">
              {all.map((a) => (
                <li key={a.id} className="flex items-center gap-2 rounded px-1 py-1 hover:bg-slate-50">
                  <span className={`size-2 shrink-0 rounded-full ${a.current ? 'bg-emerald-500' : 'bg-amber-400'}`} />
                  <span className="min-w-0 flex-1 truncate">
                    <span className="font-medium text-slate-800">{a.personName}</span>
                    {a.employeeId && <span className="text-slate-400"> · {a.employeeId}</span>}
                  </span>
                  <span className="text-slate-500" title={a.method === 'recorded' ? `Recorded by ${a.recordedByName ?? 'a supervisor'}` : a.method === 'station' ? `Signed at ${a.stationName ?? 'a station'}` : 'Signed in the app'}>
                    Rev {a.version} · {new Date(a.createdAt).toLocaleDateString()}
                  </span>
                  {isAdmin && (
                    <IconButton label="Remove sign-off" className="size-6 hover:text-red-600" onClick={() => confirm(`Remove ${a.personName}'s sign-off?`) && api.training.removeAck(a.id).then(refresh)}>
                      <Trash2 className="size-3" />
                    </IconButton>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <RecordModal open={recording} onClose={() => setRecording(false)} sop={sop} onDone={refresh} />
      <Modal
        open={!!quiz}
        onClose={() => setQuiz(null)}
        title="Quick check before you sign"
        footer={
          <Button variant="primary" onClick={sign} loading={busy} disabled={!quiz || quiz.some((q) => answers[q.id] === undefined)}>
            Check answers and sign off
          </Button>
        }
      >
        {quiz && (
          <QuizForm
            questions={quiz}
            answers={answers}
            onAnswer={(qid, o) => setAnswers((a) => ({ ...a, [qid]: o }))}
            result={result}
            intro={`Answer these to confirm you understood revision ${sop.publishedVersion}.`}
            wrongText="Not quite. Read the hint, check the SOP and try again."
          />
        )}
      </Modal>
    </Card>
  );
}

function Title() {
  return (
    <span className="flex items-center gap-1.5">
      <ClipboardSignature className="size-4" /> Training sign-off
    </span>
  );
}

function RecordModal({ open, onClose, sop, onDone }: { open: boolean; onClose: () => void; sop: Sop; onDone: () => void }) {
  const [text, setText] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const people = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const [name, employeeId = ''] = l.split(/[,;\t]/).map((x) => x.trim());
      return { name, employeeId };
    })
    .filter((p) => p.name);
  const save = async () => {
    setBusy(true);
    try {
      const r = await api.sops.recordTraining(sop.id, people, note);
      toast.success(`Recorded ${r.created} sign-off${r.created === 1 ? '' : 's'}`);
      setText('');
      setNote('');
      onDone();
      onClose();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Record training for Rev ${sop.publishedVersion}`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={save} loading={busy} disabled={!people.length}>
            Record {people.length || ''} sign-off{people.length === 1 ? '' : 's'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-slate-600">Use this after a toolbox talk or classroom session for associates who don't sign on a phone. You are recorded as the trainer.</p>
        <Field label="Associates" hint="One per line. Add an employee ID after a comma: Maria Lopez, E1042">
          <Textarea value={text} onChange={(e) => setText(e.target.value)} className="min-h-36 font-mono text-xs" placeholder={'Maria Lopez, E1042\nDev Patel'} autoFocus />
        </Field>
        <Field label="Note (optional)">
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} className="min-h-12" placeholder="e.g. Shift 2 toolbox talk" />
        </Field>
      </div>
    </Modal>
  );
}
