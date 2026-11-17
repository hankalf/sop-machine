import { useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, Plus, Trash2, UserX, UserCheck } from 'lucide-react';
import { useState } from 'react';
import type { Role, User } from '@shared/types';
import { api } from '../../api';
import { useAuth } from '../../auth';
import { useToast } from '../../components/Toast';
import { Badge, Button, Card, ErrorText, Field, IconButton, Input, Modal, PageLoader, Select, timeAgo } from '../../components/ui';

const ROLE_INFO: Record<Role, string> = {
  admin: 'Everything, including settings, templates, users and approving SOPs',
  editor: 'Create, edit and generate SOPs; submit them for review',
  viewer: 'Read and export approved SOPs (good for floor associates)',
};

export default function UsersSettings() {
  const qc = useQueryClient();
  const toast = useToast();
  const { user: me } = useAuth();
  const users = useQuery({ queryKey: ['users'], queryFn: api.users.list });
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', role: 'editor' as Role, password: '' });
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const refresh = () => qc.invalidateQueries({ queryKey: ['users'] });
  const run = async (fn: () => Promise<unknown>, msg: string) => {
    try {
      await fn();
      await refresh();
      toast.success(msg);
    } catch (e) {
      toast.error(e);
    }
  };

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.users.create(form);
      await refresh();
      setAdding(false);
      setForm({ name: '', email: '', role: 'editor', password: '' });
      toast.success('User added. Share the temporary password with them; they can change it under My account.');
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  if (users.isLoading) return <PageLoader />;
  return (
    <Card
      title="Users"
      description="Who can sign in and what they can do."
      actions={
        <Button variant="primary" size="sm" icon={<Plus className="size-4" />} onClick={() => setAdding(true)}>
          Add user
        </Button>
      }
      bodyClassName="p-0"
    >
      <ul className="divide-y divide-slate-100">
        {users.data?.map((u: User) => (
          <li key={u.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
            <div className="flex size-9 items-center justify-center rounded-full bg-slate-100 text-sm font-semibold text-slate-600">{u.name.slice(0, 1).toUpperCase()}</div>
            <div className="min-w-40 flex-1">
              <div className="flex items-center gap-2 font-medium">
                {u.name} {u.id === me?.id && <Badge>You</Badge>} {u.disabled && <Badge color="#dc2626">Disabled</Badge>}
              </div>
              <div className="text-xs text-slate-500">
                {u.email} · {u.lastLoginAt ? `last seen ${timeAgo(u.lastLoginAt)}` : 'never signed in'}
              </div>
            </div>
            <Select value={u.role} className="w-32" onChange={(e) => run(() => api.users.update(u.id, { role: e.target.value }), 'Role updated')} title={ROLE_INFO[u.role]}>
              <option value="admin">Admin</option>
              <option value="editor">Editor</option>
              <option value="viewer">Viewer</option>
            </Select>
            <IconButton
              label="Reset password"
              onClick={() => {
                const pw = prompt(`New temporary password for ${u.name} (at least 8 characters)`);
                if (pw) void run(() => api.users.update(u.id, { password: pw }), 'Password reset');
              }}
            >
              <KeyRound className="size-4" />
            </IconButton>
            {u.id !== me?.id && (
              <>
                <IconButton label={u.disabled ? 'Enable' : 'Disable'} onClick={() => run(() => api.users.update(u.id, { disabled: !u.disabled }), u.disabled ? 'User enabled' : 'User disabled')}>
                  {u.disabled ? <UserCheck className="size-4" /> : <UserX className="size-4" />}
                </IconButton>
                <IconButton label="Delete user" className="hover:bg-red-50 hover:text-red-600" onClick={() => confirm(`Delete ${u.name}?`) && run(() => api.users.remove(u.id), 'User deleted')}>
                  <Trash2 className="size-4" />
                </IconButton>
              </>
            )}
          </li>
        ))}
      </ul>
      <div className="border-t border-slate-100 px-5 py-3 text-xs text-slate-500">
        {(Object.keys(ROLE_INFO) as Role[]).map((r) => (
          <div key={r}>
            <strong className="capitalize">{r}:</strong> {ROLE_INFO[r]}
          </div>
        ))}
      </div>
      <Modal
        open={adding}
        onClose={() => setAdding(false)}
        title="Add user"
        footer={
          <>
            <Button onClick={() => setAdding(false)}>Cancel</Button>
            <Button variant="primary" loading={busy} onClick={create}>
              Add user
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Name">
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus />
          </Field>
          <Field label="Email">
            <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </Field>
          <Field label="Role" hint={ROLE_INFO[form.role]}>
            <Select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
              <option value="admin">Admin</option>
              <option value="editor">Editor</option>
              <option value="viewer">Viewer</option>
            </Select>
          </Field>
          <Field label="Temporary password" hint="At least 8 characters">
            <Input value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          </Field>
          <ErrorText error={error} />
        </div>
      </Modal>
    </Card>
  );
}
