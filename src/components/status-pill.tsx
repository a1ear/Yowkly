import { Icon, type IconName } from './icons';
import type { TemplateStatus } from '@/lib/types';

// Icon + text, never colour alone (design system rule).
const MAP: Record<TemplateStatus | 'scanning', [string, IconName, string]> = {
  draft: ['Draft', 'file', 'text-ink-2'],
  scanning: ['Scanning', 'shield', 'text-info'],
  pending_review: ['Pending review', 'eye', 'text-warning'],
  published: ['Published', 'check', 'text-success'],
  unlisted: ['Unlisted', 'lock', 'text-ink-2'],
  removed: ['Removed', 'x', 'text-danger'],
};

export function StatusPill({ status }: { status: TemplateStatus | 'scanning' }) {
  const [label, icon, color] = MAP[status];
  return (
    <span className={`inline-flex items-center gap-1 rounded-full bg-surface-2 px-2.5 py-1 text-[12px] font-medium whitespace-nowrap ${color}`}>
      <Icon name={icon} size={13} strokeWidth={2.2} />{label}
    </span>
  );
}
