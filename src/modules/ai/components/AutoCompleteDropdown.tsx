import { memo } from 'react';
import {
  User, Building2, Users, Package, Landmark, Wallet,
  FileText, FileCheck, Receipt, ArrowUpDown,
  Wrench, GitBranch, Target, Diamond,
  type LucideIcon,
} from 'lucide-react';
import { useTranslation } from '@/core/i18n/useTranslation';
import { cn } from '@/core/utils';
import type { EntityType, EntityMatch } from '../entityResolver';

// ─── Entity type config ──────────────────────────────────────────────────────

interface EntityTypeConfig {
  icon: LucideIcon;
  color: string;
  bgColor: string;
}

const ENTITY_TYPE_CONFIG: Record<EntityType, EntityTypeConfig> = {
  account:       { icon: Landmark,    color: 'text-teal-600',       bgColor: 'bg-teal-50 dark:bg-teal-900/20' },
  customer:      { icon: User,        color: 'text-blue-600',       bgColor: 'bg-blue-50 dark:bg-blue-900/20' },
  supplier:      { icon: Building2,   color: 'text-green-600',      bgColor: 'bg-green-50 dark:bg-green-900/20' },
  employee:      { icon: Users,       color: 'text-purple-600',     bgColor: 'bg-purple-50 dark:bg-purple-900/20' },
  product:       { icon: Package,     color: 'text-amber-600',      bgColor: 'bg-amber-50 dark:bg-amber-900/20' },
  warehouse:     { icon: Building2,   color: 'text-stone-600',      bgColor: 'bg-stone-50 dark:bg-stone-900/20' },
  cashBox:       { icon: Wallet,      color: 'text-emerald-600',    bgColor: 'bg-emerald-50 dark:bg-emerald-900/20' },
  invoice:       { icon: FileText,    color: 'text-rose-600',       bgColor: 'bg-rose-50 dark:bg-rose-900/20' },
  purchaseInvoice: { icon: FileCheck, color: 'text-orange-600',     bgColor: 'bg-orange-50 dark:bg-orange-900/20' },
  quotation:     { icon: FileCheck,   color: 'text-violet-600',     bgColor: 'bg-violet-50 dark:bg-violet-900/20' },
  receiptVoucher: { icon: Receipt,    color: 'text-emerald-600',    bgColor: 'bg-emerald-50 dark:bg-emerald-900/20' },
  paymentVoucher: { icon: ArrowUpDown, color: 'text-red-600',       bgColor: 'bg-red-50 dark:bg-red-900/20' },
  journalEntry:  { icon: FileText,    color: 'text-sky-600',        bgColor: 'bg-sky-50 dark:bg-sky-900/20' },
  workOrder:     { icon: Wrench,      color: 'text-cyan-600',       bgColor: 'bg-cyan-50 dark:bg-cyan-900/20' },
  bom:           { icon: GitBranch,   color: 'text-stone-600',      bgColor: 'bg-stone-50 dark:bg-stone-900/20' },
  lead:          { icon: Target,      color: 'text-yellow-600',     bgColor: 'bg-yellow-50 dark:bg-yellow-900/20' },
  opportunity:   { icon: Diamond,     color: 'text-sky-600',        bgColor: 'bg-sky-50 dark:bg-sky-900/20' },
  task:          { icon: FileCheck,   color: 'text-zinc-600 dark:text-zinc-300', bgColor: 'bg-zinc-100 dark:bg-zinc-800' },
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtCurrency(v: unknown): string {
  const n = typeof v === 'number' ? v : Number(v);
  if (!isFinite(n) || isNaN(n)) return String(v ?? '');
  return n.toLocaleString('ar-YE') + ' ر.ي';
}

function fmtSecondaryInfo(match: EntityMatch): string | null {
  const d = match.data;
  if (!d) return null;
  if (d.phone) return String(d.phone);
  if (d.balance !== undefined) return `الرصيد: ${fmtCurrency(d.balance)}`;
  if (d.total !== undefined) return fmtCurrency(d.total);
  if (d.amount !== undefined) return fmtCurrency(d.amount);
  if (d.salePrice !== undefined) return `سعر البيع: ${fmtCurrency(d.salePrice)}`;
  if (d.department) return String(d.department);
  if (d.status) return String(d.status);
  return null;
}

// ─── Props ───────────────────────────────────────────────────────────────────

interface AutoCompleteDropdownProps {
  matches: EntityMatch[];
  isOpen: boolean;
  selectedIndex: number;
  onSelect: (match: EntityMatch) => void;
}

// ─── Component ───────────────────────────────────────────────────────────────

export const AutoCompleteDropdown = memo(function AutoCompleteDropdown({
  matches,
  isOpen,
  selectedIndex,
  onSelect,
}: AutoCompleteDropdownProps) {
  const { t } = useTranslation();

  if (!isOpen || matches.length === 0) return null;

  return (
    <div
      className={cn(
        'absolute bottom-full inset-x-3 z-50 mb-1',
        'max-h-56 overflow-y-auto rounded-xl border shadow-float',
        'bg-white dark:bg-zinc-800 border-zinc-200 dark:border-zinc-700',
      )}
    >
      <div className="py-1">
        {matches.map((match, idx) => {
          const cfg = ENTITY_TYPE_CONFIG[match.type] ?? ENTITY_TYPE_CONFIG.account;
          const Icon = cfg.icon;
          const secondary = fmtSecondaryInfo(match);

          return (
            <button
              key={`${match.type}:${match.id}`}
              type="button"
              onClick={() => onSelect(match)}
              className={cn(
                'w-full text-start px-3 py-2 flex items-start gap-2.5 text-sm transition-colors',
                idx === selectedIndex
                  ? 'bg-primary-50 dark:bg-primary-950/50 text-primary-700 dark:text-primary-300'
                  : 'text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-700/50',
              )}
            >
              {/* Type icon */}
              <div className={cn(
                'w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5',
                cfg.bgColor,
                cfg.color,
              )}>
                <Icon size={14} />
              </div>

              {/* Entity info */}
              <div className="min-w-0 flex-1 text-start">
                <div className="font-semibold truncate">
                  {match.name || t('ai.entity.unnamed')}
                </div>
                <div className="flex items-center gap-2 text-[11px] text-zinc-400 dark:text-zinc-500">
                  <span className="font-medium">{match.labelAr}</span>
                  {match.code && <span dir="ltr">#{match.code}</span>}
                  {secondary && <span className="truncate">— {secondary}</span>}
                </div>
              </div>

              {/* Confidence badge */}
              {match.confidence < 0.75 && match.confidence >= 0.4 && (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-gold-100 text-gold-700 dark:bg-gold-900/30 dark:text-gold-300 flex-shrink-0">
                  {t('ai.entity.fuzzy')}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
});
