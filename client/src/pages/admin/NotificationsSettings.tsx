import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Send, XCircle } from 'lucide-react';
import { useState } from 'react';
import { api } from '../../api';
import { useAuth } from '../../auth';
import { useToast } from '../../components/Toast';
import { Badge, Button, Card, Field, Input, PageLoader, Toggle, timeAgo } from '../../components/ui';
import { SaveBar } from './SaveBar';
import { useSettingsForm } from './useSettingsForm';

export default function NotificationsSettings() {
  const { form, set, save, saving, dirty, reset, loading } = useSettingsForm();
  const { user } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const system = useQuery({ queryKey: ['system'], queryFn: api.system });
  const log = useQuery({ queryKey: ['notifications'], queryFn: api.notifications });
  const [to, setTo] = useState(user?.email ?? '');
  const [testing, setTesting] = useState(false);
  if (loading || !form) return <PageLoader />;
  const n = form.notifications;
  const configured = system.data?.email.configured;

  const test = async () => {
    setTesting(true);
    try {
      await api.testEmail(to);
      toast.success(`Test email sent to ${to}`);
      void qc.invalidateQueries({ queryKey: ['notifications'] });
    } catch (e) {
      toast.error(e);
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="grid max-w-5xl gap-6 lg:grid-cols-2">
      <Card title="Email connection">
        {configured ? (
          <p className="flex items-center gap-2 text-sm text-emerald-700">
            <CheckCircle2 className="size-5" /> Sending as {system.data?.email.from}
          </p>
        ) : (
          <div className="space-y-2 text-sm text-slate-700">
            <p className="flex items-center gap-2 font-medium text-amber-700">
              <XCircle className="size-5" /> Email is not set up, so nothing is sent yet
            </p>
            <p>
              Add your mail server in Railway (service → Variables): <code className="rounded bg-slate-100 px-1">SMTP_HOST</code>, <code className="rounded bg-slate-100 px-1">SMTP_PORT</code>, <code className="rounded bg-slate-100 px-1">SMTP_USER</code>,{' '}
              <code className="rounded bg-slate-100 px-1">SMTP_PASS</code> and <code className="rounded bg-slate-100 px-1">SMTP_FROM</code>. Any provider works (Microsoft 365, Google Workspace, SendGrid, Mailgun, Amazon SES…).
            </p>
          </div>
        )}
        <div className="mt-4 flex gap-2">
          <Input type="email" value={to} onChange={(e) => setTo(e.target.value)} placeholder="you@company.com" />
          <Button icon={<Send className="size-4" />} onClick={test} loading={testing} disabled={!configured || !to}>
            Send test
          </Button>
        </div>
      </Card>

      <Card title="What gets sent" bodyClassName="space-y-4">
        <Toggle checked={n.enabled} onChange={(v) => set('notifications', { enabled: v })} label="Send email notifications" />
        <div className={n.enabled ? 'space-y-4' : 'pointer-events-none space-y-4 opacity-50'}>
          <Field label="Review reminder (days before the review date)" hint="The SOP's reminder contact gets one email when the date is close and one if it passes.">
            <Input type="number" min={1} max={120} value={n.reviewReminderDays} onChange={(e) => set('notifications', { reviewReminderDays: Number(e.target.value) })} className="w-28" />
          </Field>
          <Toggle checked={n.onSubmitted} onChange={(v) => set('notifications', { onSubmitted: v })} label="Submitted for review" description="Admins are told when an SOP is waiting for approval." />
          <Toggle checked={n.onApproved} onChange={(v) => set('notifications', { onApproved: v })} label="Approved" description="The owner is told when their SOP is approved." />
          <Toggle checked={n.onNewRevision} onChange={(v) => set('notifications', { onNewRevision: v })} label="New revision needs sign-off" description="People who signed an earlier revision are asked to read and sign the new one." />
          <div className="border-t border-slate-100 pt-4 text-xs font-semibold tracking-wide text-slate-500 uppercase">Floor</div>
          <Toggle checked={n.onChecklistFailed} onChange={(v) => set('notifications', { onChecklistFailed: v })} label="Checklist item failed" description="The station's supervisor (or the SOP's owner) is emailed the moment a checklist is submitted with a failure." />
          <Toggle checked={n.onActionAssigned} onChange={(v) => set('notifications', { onActionAssigned: v })} label="Corrective action assigned or overdue" description="People are told when an action is given to them, and once when it goes past its due date." />
          <Toggle checked={n.onMissedChecklist} onChange={(v) => set('notifications', { onMissedChecklist: v })} label="Scheduled checklist missed" description="Supervisors get one email when a shift, day or week ends without its checklist." />
          <Field label="Also copy" hint="Extra addresses for review, approval and failed-checklist emails, comma separated (e.g. a safety manager).">
            <Input value={n.extraRecipients} onChange={(e) => set('notifications', { extraRecipients: e.target.value })} placeholder="safety@company.com" />
          </Field>
        </div>
      </Card>

      <Card title="Recently sent" className="lg:col-span-2" bodyClassName="p-0">
        {!log.data?.length ? (
          <p className="px-5 py-4 text-sm text-slate-500">Nothing sent yet.</p>
        ) : (
          <ul className="divide-y divide-slate-100 text-sm">
            {log.data.slice(0, 15).map((m) => (
              <li key={m.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-2.5">
                {m.status === 'sent' ? <Badge color="#16a34a">Sent</Badge> : m.status === 'failed' ? <Badge color="#dc2626">Failed</Badge> : <Badge>Sending</Badge>}
                <span className="min-w-0 flex-1 truncate font-medium">{m.subject}</span>
                <span className="text-xs text-slate-500">{m.recipients}</span>
                <span className="text-xs text-slate-400">{timeAgo(m.createdAt)}</span>
                {m.error && <span className="w-full text-xs text-red-700">{m.error}</span>}
              </li>
            ))}
          </ul>
        )}
      </Card>
      <div className="lg:col-span-2">
        <SaveBar dirty={dirty} saving={saving} onSave={save} onReset={reset} />
      </div>
    </div>
  );
}
