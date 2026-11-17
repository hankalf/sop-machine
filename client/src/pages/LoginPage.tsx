import { useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import { Button, ErrorText, Field, Input } from '../components/ui';

export default function LoginPage() {
  const { branding } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [params] = useSearchParams();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const user = await api.auth.login(email, password);
      qc.setQueryData(['me'], user);
      const next = params.get('next');
      navigate(next && next.startsWith('/') && !next.startsWith('//') ? next : '/', { replace: true });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-brand-dark via-brand to-brand-dark p-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-8 shadow-2xl">
        <div className="mb-6 flex flex-col items-center text-center">
          {branding?.hasLogo ? (
            <img src={`/api/public/logo?v=${branding.logoVersion}`} alt={branding.companyName} className="mb-4 max-h-16 max-w-48 object-contain" />
          ) : (
            <div className="mb-4 flex size-14 items-center justify-center rounded-2xl bg-brand text-lg font-bold text-white">SOP</div>
          )}
          <h1 className="text-xl font-bold text-slate-900">{branding?.siteName ?? 'SOP Machine'}</h1>
          <p className="text-sm text-slate-500">{branding?.companyName}</p>
        </div>
        <form onSubmit={submit} className="space-y-4">
          <Field label="Email">
            <Input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
          </Field>
          <Field label="Password">
            <Input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          <ErrorText error={error} />
          <Button type="submit" variant="primary" size="lg" className="w-full" loading={busy}>
            Sign in
          </Button>
        </form>
      </div>
    </div>
  );
}
