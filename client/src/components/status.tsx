import type { SopStatus } from '@shared/types';
import { STATUS_LABELS } from '@shared/defaults';
import { cx } from './ui';

const STYLES: Record<SopStatus, string> = {
  draft: 'bg-amber-100 text-amber-800',
  review: 'bg-blue-100 text-blue-800',
  approved: 'bg-emerald-100 text-emerald-800',
  archived: 'bg-slate-200 text-slate-700',
};

export function StatusBadge({ status, className }: { status: SopStatus; className?: string }) {
  return <span className={cx('inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold', STYLES[status], className)}>{STATUS_LABELS[status]}</span>;
}

export function isReviewDue(reviewDate: string | null, days = 30) {
  if (!reviewDate) return false;
  return new Date(reviewDate).getTime() - Date.now() < days * 86400 * 1000;
}
