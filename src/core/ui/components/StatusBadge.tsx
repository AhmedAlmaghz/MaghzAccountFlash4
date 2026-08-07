import React from 'react';
import { useTranslation } from '@/core/i18n/useTranslation';
import { cn } from '@/core/utils';

interface StatusBadgeProps {
  status: string;
  size?: 'sm' | 'md';
  className?: string;
}

const STATUS_KEYS: Record<string, { key: string; className: string }> = {
  draft: { key: 'status.draft', className: 'badge-draft' },
  posted: { key: 'status.posted', className: 'badge-posted' },
  paid: { key: 'status.paid', className: 'badge-paid' },
  partially_paid: { key: 'status.partiallyPaid', className: 'badge-partial' },
  cancelled: { key: 'status.cancelled', className: 'badge-cancelled' },
  cancelled_mfg: { key: 'status.cancelled', className: 'badge-cancelled' },
  active: { key: 'status.active', className: 'badge-posted' },
  inactive: { key: 'status.inactive', className: 'badge-draft' },
  pending: { key: 'status.pending', className: 'badge-partial' },
  completed: { key: 'status.completed', className: 'badge-paid' },
  rejected: { key: 'status.rejected', className: 'badge-cancelled' },
  approved: { key: 'status.approved', className: 'badge-paid' },
  open: { key: 'status.open', className: 'badge-draft' },
  closed: { key: 'status.closed', className: 'badge-posted' },
  planned: { key: 'status.planned', className: 'badge-draft' },
  in_progress: { key: 'status.inProgress', className: 'badge-partial' },
  new: { key: 'status.new', className: 'badge-draft' },
  contacted: { key: 'status.contacted', className: 'badge-partial' },
  qualified: { key: 'status.qualified', className: 'badge-posted' },
  converted: { key: 'status.converted', className: 'badge-paid' },
  lost: { key: 'status.lost', className: 'badge-cancelled' },
  proposal: { key: 'status.proposal', className: 'badge-partial' },
  negotiation: { key: 'status.negotiation', className: 'badge-partial' },
  won: { key: 'status.won', className: 'badge-paid' },
  annual: { key: 'status.annual', className: 'badge-draft' },
  sick: { key: 'status.sick', className: 'badge-partial' },
  emergency: { key: 'status.emergency', className: 'badge-partial' },
  unpaid: { key: 'status.unpaid', className: 'badge-cancelled' },
};

export const StatusBadge: React.FC<StatusBadgeProps> = ({
  status,
  size = 'sm',
  className,
}) => {
  const { t } = useTranslation();
  const config = STATUS_KEYS[status];

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full font-medium',
        size === 'sm' ? 'px-2.5 py-0.5 text-xs' : 'px-3 py-1 text-sm',
        config?.className ?? 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
        className
      )}
    >
      {config ? t(config.key) : status}
    </span>
  );
};

export default StatusBadge;
