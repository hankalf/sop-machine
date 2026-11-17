import { useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';
import { useToast } from '../components/Toast';
import { Button, Card, Field, Input } from '../components/ui';

export default function AccountPage() {
  const { user, refresh } = useAuth();
  const toast = useToast();
  const [name, setName] = useState(user?.name ?? '');
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      await api.auth.updateMe({ name, ...(next ? { currentPassword: current, newPassword: next } : {}) });
      setCurrent('');
      setNext('');
      refresh();
      toast.success('Account updated');
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <h1 className="text-2xl font-bold">My account</h1>
      <Card title="Profile" description={`${user?.email} · ${user?.role}`}>
        <div className="space-y-4">
          <Field label="Display name">
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Current password">
            <Input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
          </Field>
          <Field label="New password" hint="At least 8 characters. Leave blank to keep your password.">
            <Input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
          </Field>
          <Button variant="primary" onClick={save} loading={busy}>
            Save changes
          </Button>
        </div>
      </Card>
    </div>
  );
}
