import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import type { Category } from '@shared/types';
import { api } from '../../api';
import { useToast } from '../../components/Toast';
import { Button, Card, Field, IconButton, Input, Modal, PageLoader, Select } from '../../components/ui';

type Draft = Omit<Category, 'id'> & { id?: string };
const blank: Draft = { name: '', code: '', color: '#2563eb', description: '', templateId: null, sortOrder: 0 };

export default function CategoriesSettings() {
  const qc = useQueryClient();
  const toast = useToast();
  const categories = useQuery({ queryKey: ['categories'], queryFn: api.categories.list });
  const templates = useQuery({ queryKey: ['templates'], queryFn: api.templates.list });
  const [editing, setEditing] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);

  if (categories.isLoading) return <PageLoader />;
  const defaultName = templates.data?.find((t) => t.isDefault)?.name ?? 'default';

  const save = async () => {
    if (!editing) return;
    setBusy(true);
    try {
      const { id, ...body } = editing;
      if (id) await api.categories.update(id, body);
      else await api.categories.create({ ...body, sortOrder: categories.data?.length ?? 0 });
      await qc.invalidateQueries({ queryKey: ['categories'] });
      setEditing(null);
      toast.success('Category saved');
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (c: Category) => {
    if (!confirm(`Delete category "${c.name}"? SOPs in it keep their content but lose the category.`)) return;
    await api.categories.remove(c.id);
    void qc.invalidateQueries({ queryKey: ['categories'] });
  };

  return (
    <Card
      title="Categories"
      description="Group SOPs (systems, trailer & dock, receiving…). Each category has a number code and a default template."
      actions={
        <Button variant="primary" size="sm" icon={<Plus className="size-4" />} onClick={() => setEditing({ ...blank })}>
          Add category
        </Button>
      }
      bodyClassName="p-0"
    >
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-left text-xs font-semibold text-slate-500">
          <tr>
            <th className="px-5 py-2.5">Name</th>
            <th className="px-3 py-2.5">Code</th>
            <th className="hidden px-3 py-2.5 md:table-cell">Template</th>
            <th className="w-10" />
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {categories.data?.map((c) => (
            <tr key={c.id} className="cursor-pointer hover:bg-slate-50" onClick={() => setEditing({ ...c })}>
              <td className="px-5 py-3">
                <div className="flex items-center gap-2.5">
                  <span className="size-3 rounded-full" style={{ background: c.color }} />
                  <div>
                    <div className="font-medium">{c.name}</div>
                    <div className="text-xs text-slate-500">{c.description}</div>
                  </div>
                </div>
              </td>
              <td className="px-3 py-3 font-mono text-xs">{c.code}</td>
              <td className="hidden px-3 py-3 text-slate-600 md:table-cell">{templates.data?.find((t) => t.id === c.templateId)?.name ?? `Default (${defaultName})`}</td>
              <td className="pr-3" onClick={(e) => e.stopPropagation()}>
                <IconButton label="Delete category" className="hover:bg-red-50 hover:text-red-600" onClick={() => remove(c)}>
                  <Trash2 className="size-4" />
                </IconButton>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title={editing?.id ? 'Edit category' : 'New category'}
        footer={
          <>
            <Button onClick={() => setEditing(null)}>Cancel</Button>
            <Button variant="primary" loading={busy} onClick={save}>
              Save
            </Button>
          </>
        }
      >
        {editing && (
          <div className="grid gap-4 sm:grid-cols-[1fr_120px]">
            <Field label="Name">
              <Input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} autoFocus />
            </Field>
            <Field label="Code" hint="Used in SOP numbers">
              <Input value={editing.code} maxLength={8} onChange={(e) => setEditing({ ...editing, code: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '') })} className="font-mono" />
            </Field>
            <Field label="Description" className="sm:col-span-2">
              <Input value={editing.description} onChange={(e) => setEditing({ ...editing, description: e.target.value })} />
            </Field>
            <Field label="Default template" className="sm:col-span-2">
              <Select value={editing.templateId ?? ''} onChange={(e) => setEditing({ ...editing, templateId: e.target.value || null })}>
                <option value="">Default template ({defaultName})</option>
                {templates.data?.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Color">
              <input type="color" value={editing.color} onChange={(e) => setEditing({ ...editing, color: e.target.value })} className="h-9 w-full cursor-pointer rounded-lg ring-1 ring-slate-300" />
            </Field>
          </div>
        )}
      </Modal>
    </Card>
  );
}
