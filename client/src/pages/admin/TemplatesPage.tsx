import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Download, FileJson, Paintbrush, Plus, Star, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Template } from '@shared/types';
import { FONT_OPTIONS } from '@shared/defaults';
import { api } from '../../api';
import { useToast } from '../../components/Toast';
import { Badge, Button, Field, IconButton, Input, Modal, PageLoader, Select, Textarea } from '../../components/ui';

export function TemplateSwatch({ t }: { t: Template }) {
  const d = t.design;
  const heading = FONT_OPTIONS.find((f) => f.key === d.typography.headingFont)?.family ?? 'Inter';
  return (
    <div className="relative aspect-[4/3] overflow-hidden rounded-lg bg-white ring-1 ring-slate-200">
      <div className="h-[22%]" style={{ background: d.colors.primary }} />
      <div className="h-[4%]" style={{ background: d.colors.accent }} />
      <div className="space-y-2 p-3">
        <div className="text-[11px] font-bold" style={{ color: d.colors.primary, fontFamily: heading, textTransform: d.style.uppercaseHeadings ? 'uppercase' : undefined }}>
          Procedure
        </div>
        {[1, 2].map((n) => (
          <div key={n} className="flex items-center gap-1.5">
            <span className="flex size-3.5 items-center justify-center rounded-full text-[7px] font-bold" style={{ background: d.colors.stepBadge, color: d.colors.stepBadgeText }}>
              {n}
            </span>
            <div className="h-1.5 flex-1 rounded bg-slate-200" />
            {d.steps.layout === 'side-by-side' && <div className="h-5 w-8 rounded bg-slate-200" />}
          </div>
        ))}
        {d.steps.layout === 'stacked' && <div className="h-6 rounded bg-slate-200" />}
      </div>
    </div>
  );
}

export default function TemplatesPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const templates = useQuery({ queryKey: ['templates'], queryFn: api.templates.list });
  const categories = useQuery({ queryKey: ['categories'], queryFn: api.categories.list });
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [copyFrom, setCopyFrom] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);

  const refresh = () => qc.invalidateQueries({ queryKey: ['templates'] });

  const create = async () => {
    try {
      const t = await api.templates.create({ name: name.trim() || 'New template', description, copyFrom: copyFrom || undefined });
      await refresh();
      navigate(`/admin/templates/${t.id}`);
    } catch (e) {
      toast.error(e);
    }
  };

  const duplicate = async (t: Template) => {
    const copy = await api.templates.create({ name: `${t.name} (copy)`, description: t.description, copyFrom: t.id });
    await refresh();
    toast.success(`Created ${copy.name}`);
  };

  const exportJson = (t: Template) => {
    const blob = new Blob([JSON.stringify({ kind: 'sop-machine-template', version: 1, name: t.name, description: t.description, design: t.design }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${t.name.replace(/[^\w\- ]+/g, '')}.template.json`;
    a.click();
  };

  const importJson = async (file: File) => {
    try {
      const data = JSON.parse(await file.text());
      if (data.kind !== 'sop-machine-template' || !data.design) throw new Error('That file is not an SOP Machine template');
      const t = await api.templates.create({ name: data.name ?? file.name, description: data.description ?? '', design: data.design });
      await refresh();
      toast.success(`Imported ${t.name}`);
    } catch (e) {
      toast.error(e);
    }
  };

  if (templates.isLoading) return <PageLoader />;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-slate-600">
          Templates control how SOPs look when exported: colors, fonts, cover page, header and footer, step layout and which sections appear. Assign templates to categories so every SOP of that type looks the same.
        </p>
        <div className="flex gap-2">
          <Button icon={<FileJson className="size-4" />} onClick={() => fileInput.current?.click()}>
            Import
          </Button>
          <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
            New template
          </Button>
          <input ref={fileInput} type="file" accept="application/json,.json" className="hidden" onChange={(e) => e.target.files?.[0] && importJson(e.target.files[0])} />
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {templates.data?.map((t) => {
          const used = categories.data?.filter((c) => c.templateId === t.id) ?? [];
          return (
            <div key={t.id} className="flex flex-col rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
              <button onClick={() => navigate(`/admin/templates/${t.id}`)} className="text-left">
                <TemplateSwatch t={t} />
              </button>
              <div className="mt-3 flex items-start justify-between gap-2">
                <div>
                  <h3 className="flex items-center gap-2 font-semibold">
                    {t.name} {t.isDefault && <Badge color="#16a34a">Default</Badge>}
                  </h3>
                  <p className="text-xs text-slate-500">{t.description}</p>
                </div>
              </div>
              <div className="mt-2 flex flex-wrap gap-1">
                {used.map((c) => (
                  <Badge key={c.id} color={c.color}>
                    {c.name}
                  </Badge>
                ))}
              </div>
              <div className="mt-auto flex items-center gap-1 pt-4">
                <Button size="sm" variant="primary" icon={<Paintbrush className="size-3.5" />} onClick={() => navigate(`/admin/templates/${t.id}`)}>
                  Design
                </Button>
                <div className="ml-auto flex">
                  {!t.isDefault && (
                    <IconButton label="Make default" onClick={() => api.templates.update(t.id, { isDefault: true }).then(refresh)}>
                      <Star className="size-4" />
                    </IconButton>
                  )}
                  <IconButton label="Duplicate" onClick={() => duplicate(t)}>
                    <Copy className="size-4" />
                  </IconButton>
                  <IconButton label="Export as file" onClick={() => exportJson(t)}>
                    <Download className="size-4" />
                  </IconButton>
                  {!t.isDefault && (
                    <IconButton label="Delete" className="hover:bg-red-50 hover:text-red-600" onClick={() => confirm(`Delete template "${t.name}"? SOPs using it switch to their category or default template.`) && api.templates.remove(t.id).then(refresh).catch(toast.error)}>
                      <Trash2 className="size-4" />
                    </IconButton>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <Modal
        open={creating}
        onClose={() => setCreating(false)}
        title="New template"
        footer={
          <>
            <Button onClick={() => setCreating(false)}>Cancel</Button>
            <Button variant="primary" onClick={create}>
              Create and open designer
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Name">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Forklift & Equipment" autoFocus />
          </Field>
          <Field label="Description">
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} className="min-h-16" />
          </Field>
          <Field label="Start from">
            <Select value={copyFrom} onChange={(e) => setCopyFrom(e.target.value)}>
              <option value="">Standard defaults</option>
              {templates.data?.map((t) => (
                <option key={t.id} value={t.id}>
                  Copy of {t.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </Modal>
    </div>
  );
}
