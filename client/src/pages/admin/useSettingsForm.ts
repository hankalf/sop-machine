import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import type { AppSettings } from '@shared/types';
import { api } from '../../api';
import { useAuth } from '../../auth';
import { useToast } from '../../components/Toast';

/** Local editable copy of the global settings with save/reset. */
export function useSettingsForm() {
  const qc = useQueryClient();
  const toast = useToast();
  const { refresh } = useAuth();
  const query = useQuery({ queryKey: ['settings'], queryFn: api.settings.get });
  const [form, setForm] = useState<AppSettings | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (query.data) setForm(structuredClone(query.data));
  }, [query.data]);

  const dirty = !!form && !!query.data && JSON.stringify(form) !== JSON.stringify(query.data);

  const set = <K extends keyof AppSettings>(section: K, patch: Partial<AppSettings[K]>) =>
    setForm((f) => (f ? { ...f, [section]: { ...f[section], ...patch } } : f));

  const save = async () => {
    if (!form) return;
    setSaving(true);
    try {
      const saved = await api.settings.update(form);
      qc.setQueryData(['settings'], saved);
      refresh();
      toast.success('Settings saved');
    } catch (e) {
      toast.error(e);
    } finally {
      setSaving(false);
    }
  };

  return { form, set, save, saving, dirty, reset: () => query.data && setForm(structuredClone(query.data)), loading: query.isLoading };
}
