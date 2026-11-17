import { Button } from '../../components/ui';

export function SaveBar({ dirty, saving, onSave, onReset }: { dirty: boolean; saving: boolean; onSave: () => void; onReset: () => void }) {
  if (!dirty && !saving) return null;
  return (
    <div className="sticky bottom-4 z-20 mx-auto flex max-w-xl items-center justify-between gap-3 rounded-xl bg-slate-900 px-4 py-3 text-sm text-white shadow-2xl">
      <span>You have unsaved changes</span>
      <div className="flex gap-2">
        <Button size="sm" variant="ghost" className="text-white hover:bg-white/10 hover:text-white" onClick={onReset}>
          Discard
        </Button>
        <Button size="sm" variant="primary" onClick={onSave} loading={saving}>
          Save changes
        </Button>
      </div>
    </div>
  );
}
