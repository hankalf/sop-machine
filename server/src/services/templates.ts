import { normalizeDesign, starterTemplates, STARTER_CATEGORIES } from '../../../shared/defaults';
import type { Category, Template, TemplateDesign } from '../../../shared/types';
import { db } from '../db';
import { badRequest, newId, notFound, nowIso } from '../util';

interface TemplateRow {
  id: string;
  name: string;
  description: string;
  design: string;
  is_default: number;
  created_at: string;
  updated_at: string;
}

const toTemplate = (r: TemplateRow): Template => ({
  id: r.id,
  name: r.name,
  description: r.description,
  design: normalizeDesign(JSON.parse(r.design)),
  isDefault: !!r.is_default,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export function listTemplates(): Template[] {
  return (db.prepare('SELECT * FROM templates ORDER BY is_default DESC, name').all() as TemplateRow[]).map(toTemplate);
}

export function getTemplate(id: string): Template {
  const row = db.prepare('SELECT * FROM templates WHERE id = ?').get(id) as TemplateRow | undefined;
  if (!row) throw notFound('Template not found');
  return toTemplate(row);
}

export function defaultTemplate(): Template {
  const row = (db.prepare('SELECT * FROM templates WHERE is_default = 1').get() ??
    db.prepare('SELECT * FROM templates ORDER BY created_at LIMIT 1').get()) as TemplateRow | undefined;
  if (row) return toTemplate(row);
  // Should not happen after seeding, but never fail a render because of it.
  return createTemplate({ name: 'Standard SOP', description: '', design: normalizeDesign({}), isDefault: true });
}

export function createTemplate(input: { name: string; description: string; design: unknown; isDefault?: boolean }): Template {
  const id = newId();
  const now = nowIso();
  db.transaction(() => {
    if (input.isDefault) db.prepare('UPDATE templates SET is_default = 0').run();
    db.prepare(
      'INSERT INTO templates (id, name, description, design, is_default, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run(id, input.name, input.description, JSON.stringify(normalizeDesign(input.design)), input.isDefault ? 1 : 0, now, now);
  })();
  return getTemplate(id);
}

export function updateTemplate(
  id: string,
  input: { name?: string; description?: string; design?: unknown; isDefault?: boolean },
): Template {
  const current = getTemplate(id);
  const design: TemplateDesign = input.design !== undefined ? normalizeDesign(input.design) : current.design;
  db.transaction(() => {
    if (input.isDefault) db.prepare('UPDATE templates SET is_default = 0').run();
    db.prepare(
      'UPDATE templates SET name = ?, description = ?, design = ?, is_default = ?, updated_at = ? WHERE id = ?',
    ).run(
      input.name ?? current.name,
      input.description ?? current.description,
      JSON.stringify(design),
      input.isDefault ? 1 : current.isDefault ? 1 : 0,
      nowIso(),
      id,
    );
  })();
  return getTemplate(id);
}

export function deleteTemplate(id: string) {
  const t = getTemplate(id);
  if (t.isDefault) throw badRequest('Choose another default template before deleting this one');
  db.prepare('DELETE FROM templates WHERE id = ?').run(id);
}

/** SOP override → category template → default template. */
export function resolveTemplate(sopTemplateId: string | null, category: Category | null): Template {
  for (const id of [sopTemplateId, category?.templateId]) {
    if (!id) continue;
    const row = db.prepare('SELECT * FROM templates WHERE id = ?').get(id) as TemplateRow | undefined;
    if (row) return toTemplate(row);
  }
  return defaultTemplate();
}

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

interface CategoryRow {
  id: string;
  name: string;
  code: string;
  color: string;
  description: string;
  template_id: string | null;
  sort_order: number;
}

const toCategory = (r: CategoryRow): Category => ({
  id: r.id,
  name: r.name,
  code: r.code,
  color: r.color,
  description: r.description,
  templateId: r.template_id,
  sortOrder: r.sort_order,
});

export function listCategories(): Category[] {
  return (db.prepare('SELECT * FROM categories ORDER BY sort_order, name').all() as CategoryRow[]).map(toCategory);
}

export function getCategory(id: string | null | undefined): Category | null {
  if (!id) return null;
  const row = db.prepare('SELECT * FROM categories WHERE id = ?').get(id) as CategoryRow | undefined;
  return row ? toCategory(row) : null;
}

export function saveCategory(id: string | null, c: Omit<Category, 'id'>): Category {
  const catId = id ?? newId();
  if (id) {
    const res = db
      .prepare('UPDATE categories SET name=?, code=?, color=?, description=?, template_id=?, sort_order=? WHERE id=?')
      .run(c.name, c.code, c.color, c.description, c.templateId, c.sortOrder, id);
    if (res.changes === 0) throw notFound('Category not found');
  } else {
    db.prepare(
      'INSERT INTO categories (id, name, code, color, description, template_id, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run(catId, c.name, c.code, c.color, c.description, c.templateId, c.sortOrder);
  }
  return getCategory(catId)!;
}

export function deleteCategory(id: string) {
  db.prepare('DELETE FROM categories WHERE id = ?').run(id);
}

/** First boot: starter templates + warehouse categories. */
export function seedTemplatesAndCategories() {
  const count = (db.prepare('SELECT COUNT(*) AS n FROM templates').get() as { n: number }).n;
  if (count > 0) return;
  const created = starterTemplates().map((t) => createTemplate(t));
  STARTER_CATEGORIES.forEach((c, i) =>
    saveCategory(null, {
      name: c.name,
      code: c.code,
      color: c.color,
      description: c.description,
      templateId: created[c.template]?.id ?? null,
      sortOrder: i,
    }),
  );
}
