import React, { useState, useMemo, useCallback } from 'react';
import {
  Calculator,
  Plus,
  ChevronDown,
  ChevronLeft,
  Search,
  X,
  Wallet,
  Landmark,
  Building2,
  TrendingUp,
  TrendingDown,
  Layers,
  Eye,
  FileText,
  Receipt,
  Hash,
  Filter,
  ChevronUp,
  AlertCircle,
  CheckCircle2,
  FolderTree,
} from 'lucide-react';
import { Card, Button, Input, Modal, Badge } from '@/core/ui/components';
import { ConfirmDialog, StatusBadge, ActionButtons } from '@/core/ui/components';
import { EmptyState } from '@/core/ui/components/EmptyState';
import { SmartSelect, type SmartSelectItem } from '@/core/ui/components/smart';
import { useAccounts } from '../hooks/useAccounting';
import { useAppStore } from '@/core/store';
import { useTranslation } from '@/core/i18n/useTranslation';
import { cn } from '@/core/utils';
import { Can } from '@/core/ui/components/PermissionGate';
import { useFormatters } from '@/core/utils/useFormatters';
import { exportToExcel, exportToPDF } from '@/core/utils/exportEngine';
import { useToastStore } from '@/core/store/toastStore';
import type { Account } from '../types';

const TYPE_META: Record<string, { labelKey: string; icon: typeof Wallet; color: string; bg: string; border: string }> = {
  asset: { labelKey: 'accounting.asset', icon: Wallet, color: 'text-emerald-700 dark:text-emerald-300', bg: 'bg-emerald-50 dark:bg-emerald-900/20', border: 'border-emerald-200 dark:border-emerald-800' },
  liability: { labelKey: 'accounting.liability', icon: Landmark, color: 'text-amber-700 dark:text-amber-300', bg: 'bg-amber-50 dark:bg-amber-900/20', border: 'border-amber-200 dark:border-amber-800' },
  equity: { labelKey: 'accounting.equity', icon: Building2, color: 'text-blue-700 dark:text-blue-300', bg: 'bg-blue-50 dark:bg-blue-900/20', border: 'border-blue-200 dark:border-blue-800' },
  revenue: { labelKey: 'accounting.revenue', icon: TrendingUp, color: 'text-teal-700 dark:text-teal-300', bg: 'bg-teal-50 dark:bg-teal-900/20', border: 'border-teal-200 dark:border-teal-800' },
  expense: { labelKey: 'accounting.expense', icon: TrendingDown, color: 'text-rose-700 dark:text-rose-300', bg: 'bg-rose-50 dark:bg-rose-900/20', border: 'border-rose-200 dark:border-rose-800' },
};

const NATURE_COLORS: Record<string, string> = {
  debit: 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800',
  credit: 'text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-900/20 border-rose-200 dark:border-rose-800',
};

function flattenTree(accounts: Account[]): Account[] {
  const out: Account[] = [];
  const walk = (nodes: Account[]) => {
    for (const n of nodes) {
      out.push(n);
      if (n.children?.length) walk(n.children);
    }
  };
  walk(accounts);
  return out;
}

function getDescendantIds(account: Account): Set<string> {
  const s = new Set<string>();
  const walk = (n: Account) => {
    if (n.children) for (const c of n.children) { s.add(c.id); walk(c); }
  };
  walk(account);
  return s;
}

function computeGroupBalance(acc: Account): number {
  if (!acc.isGroup || !acc.children?.length) return Number(acc.balance) || 0;
  return acc.children.reduce((sum, c) => sum + computeGroupBalance(c), 0);
}

/** Default balance nature per account type (assets/expenses = debit, rest = credit). */
const TYPE_NATURE: Record<Account['type'], Account['nature']> = {
  asset: 'debit',
  liability: 'credit',
  equity: 'credit',
  revenue: 'credit',
  expense: 'debit',
};

/** Root code digit per account type in the standard IFRS-style chart. */
const TYPE_ROOT_CODE: Record<Account['type'], string> = {
  asset: '1',
  liability: '2',
  equity: '3',
  revenue: '4',
  expense: '5',
};

/**
 * Suggest the next free code under `parentId` (or a top-level code for the
 * given type when no parent). Tries 2-digit suffixes first (`11103`), then
 * wider ones — never returns a code already taken by ANY account.
 */
function suggestNextCode(type: Account['type'], parentId: string | undefined, flatList: Account[]): string {
  const taken = new Set(flatList.map((a) => a.code));
  const parent = parentId ? flatList.find((a) => a.id === parentId) : undefined;
  const prefix = parentId ? (parent?.code ?? '') : TYPE_ROOT_CODE[type];
  if (!prefix) return '';
  for (let n = 1; n <= 999; n++) {
    const candidate = `${prefix}${String(n).padStart(2, '0')}`;
    if (!taken.has(candidate)) return candidate;
  }
  return '';
}

function filterTree(accounts: Account[], query: string, typeFilter: string, natureFilter: string, statusFilter: string): Account[] {
  const q = query.trim().toLowerCase();
  const match = (a: Account): boolean => {
    if (q && !((a.nameAr?.toLowerCase() || '').includes(q) || (a.nameEn?.toLowerCase() || '').includes(q) || a.code.includes(q))) return false;
    if (typeFilter && a.type !== typeFilter) return false;
    if (natureFilter && a.nature !== natureFilter) return false;
    if (statusFilter === 'active' && !a.isActive) return false;
    if (statusFilter === 'inactive' && a.isActive) return false;
    return true;
  };
  const recurse = (nodes: Account[]): Account[] | null => {
    const res: Account[] = [];
    for (const n of nodes) {
      const childrenFiltered = n.children ? recurse(n.children) : null;
      const selfMatch = match(n);
      const hasMatchingChild = !!childrenFiltered && childrenFiltered.length > 0;
      if (selfMatch || hasMatchingChild) {
        res.push({ ...n, children: childrenFiltered && childrenFiltered.length ? childrenFiltered : selfMatch ? n.children : [] });
      }
    }
    return res.length ? res : null;
  };
  if (!q && !typeFilter && !natureFilter && !statusFilter) return accounts;
  return recurse(accounts) || [];
}

interface TreeRowProps {
  account: Account;
  level: number;
  expandedIds: Set<string>;
  toggle: (id: string) => void;
  searchQuery?: string;
  onEdit: (a: Account) => void;
  onDelete: (a: Account) => void;
  formatCurrency: (v: number | string) => string;
  isLast?: boolean;
  parentLines?: boolean[];
}

const AccountRow: React.FC<TreeRowProps> = ({ account, level, expandedIds, toggle, onEdit, onDelete, formatCurrency, parentLines = [] }) => {
  const { t } = useTranslation();
  const hasChildren = !!(account.children && account.children.length > 0);
  const isExpanded = expandedIds.has(account.id);
  const typeMeta = TYPE_META[account.type] || TYPE_META.asset;
  const TypeIcon = typeMeta.icon;
  const groupBalance = account.isGroup ? computeGroupBalance(account) : Number(account.balance) || 0;
  const displayBalance = account.isGroup ? groupBalance : Number(account.balance) || 0;

  return (
    <div>
      <div
        className={cn(
          'group flex items-center gap-2 py-2.5 px-3 hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors border-b border-slate-100 dark:border-slate-800/50',
          level === 0 && 'bg-white dark:bg-slate-900',
          level > 0 && 'bg-slate-50/30 dark:bg-slate-800/20',
        )}
      >
        {/* Indent guides */}
        <div className="flex items-center shrink-0" style={{ width: level * 20 }}>
          {parentLines.map((isLast, idx) => (
            <div key={idx} className="w-5 h-6 flex justify-center">
              {!isLast && <div className="w-px h-full bg-slate-200 dark:bg-slate-700" />}
            </div>
          ))}
          {level > 0 && <div className="w-5 h-px bg-slate-200 dark:bg-slate-700 -ml-1" />}
        </div>

        {hasChildren ? (
          <button
            onClick={() => toggle(account.id)}
            className="w-6 h-6 rounded-md bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-center hover:bg-slate-100 dark:hover:bg-slate-700 transition shrink-0"
            aria-label={isExpanded ? 'collapse' : 'expand'}
          >
            {isExpanded ? <ChevronDown size={12} /> : <ChevronLeft size={12} />}
          </button>
        ) : (
          <div className="w-6 shrink-0 flex justify-center">
            <div className="w-1.5 h-1.5 rounded-full bg-slate-300 dark:bg-slate-600 mt-1" />
          </div>
        )}

        <span className="font-mono text-xs font-semibold text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 px-2 py-1 rounded-md border border-slate-200 dark:border-slate-700 shrink-0 tabular-nums">
          {account.code}
        </span>

        <div className="flex items-center gap-2 flex-1 min-w-0">
          <span className={cn('w-7 h-7 rounded-lg flex items-center justify-center shrink-0 border', typeMeta.bg, typeMeta.border)}>
            <TypeIcon size={13} className={typeMeta.color} />
          </span>
          <span className="font-medium text-sm text-slate-900 dark:text-slate-100 truncate">{account.nameAr}</span>
          {account.nameEn && <span className="text-xs text-slate-400 truncate hidden sm:inline">({account.nameEn})</span>}
          {account.isGroup && <Badge className="bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700 text-[10px] hidden sm:inline-flex">مجموعة</Badge>}
        </div>

        <div className="hidden lg:flex items-center gap-2 shrink-0">
          <span className={cn('text-xs px-2 py-1 rounded-full border font-medium', typeMeta.bg, typeMeta.border, typeMeta.color)}>
            {t(typeMeta.labelKey)}
          </span>
          <span className={cn('text-xs px-2 py-1 rounded-full border font-medium', NATURE_COLORS[account.nature])}>
            {account.nature === 'debit' ? t('accounting.debit') : t('accounting.credit')}
          </span>
          <StatusBadge status={account.isActive ? 'active' : 'inactive'} size="sm" />
        </div>

        <div className="hidden md:flex items-center gap-1 shrink-0 w-[140px] justify-end">
          {displayBalance !== 0 || !account.isGroup ? (
            <span className={cn('font-mono text-sm font-semibold tabular-nums px-2.5 py-1 rounded-full border', displayBalance >= 0 ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-800' : 'bg-rose-50 dark:bg-rose-900/20 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-800')}>
              {formatCurrency(displayBalance)}
            </span>
          ) : (
            <span className="text-xs text-slate-400">—</span>
          )}
        </div>

        <div className="flex items-center gap-0.5 shrink-0 opacity-60 group-hover:opacity-100 transition">
          <ActionButtons
            size="sm"
            onView={() => onEdit(account)}
            onEdit={() => onEdit(account)}
            onDelete={() => onDelete(account)}
            showView={false}
            showPrint={false}
            showExport={false}
          />
        </div>
      </div>

      {hasChildren && isExpanded && (
        <div>
          {account.children!.map((child, idx) => (
            <AccountRow
              key={child.id}
              account={child}
              level={level + 1}
              expandedIds={expandedIds}
              toggle={toggle}
              onEdit={onEdit}
              onDelete={onDelete}
              formatCurrency={formatCurrency}
              isLast={idx === account.children!.length - 1}
              parentLines={[...parentLines, idx === account.children!.length - 1]}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export const ChartOfAccounts: React.FC = () => {
  const { t } = useTranslation();
  const addToast = useToastStore((s) => s.addToast);
  const activeCompany = useAppStore((state) => state.activeCompany);
  const { accounts, isLoading, create, update, remove } = useAccounts(activeCompany?.id || '');
  const { formatCurrency } = useFormatters(activeCompany?.id || '');

  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [natureFilter, setNatureFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState<Partial<Account>>({
    type: 'asset',
    nature: 'debit',
    isGroup: false,
    isActive: true,
  });
  const [openingAmountStr, setOpeningAmountStr] = useState('');
  const [openingDirection, setOpeningDirection] = useState<'debit' | 'credit'>('debit');
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [isSaving, setIsSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<Account | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  // True once the user types a code manually — auto-suggestion must never
  // clobber what they typed. Reset on modal open/reset.
  const [codeTouched, setCodeTouched] = useState(false);

  const flatList = useMemo(() => flattenTree(accounts), [accounts]);
  const groupAccounts = useMemo(() => flatList.filter((a) => a.isGroup), [flatList]);

  const stats = useMemo(() => {
    const total = flatList.length;
    const groups = flatList.filter((a) => a.isGroup).length;
    const active = flatList.filter((a) => a.isActive).length;
    const leafBalances = flatList.filter((a) => !a.isGroup).reduce((s, a) => s + (Number(a.balance) || 0), 0);
    const debitTotal = flatList.filter((a) => !a.isGroup && a.nature === 'debit').reduce((s, a) => s + Math.abs(Number(a.balance) || 0), 0);
    const creditTotal = flatList.filter((a) => !a.isGroup && a.nature === 'credit').reduce((s, a) => s + Math.abs(Number(a.balance) || 0), 0);
    return { total, groups, active, leafBalances, debitTotal, creditTotal };
  }, [flatList]);

  const filteredAccounts = useMemo(() => filterTree(accounts, searchQuery, typeFilter, natureFilter, statusFilter), [accounts, searchQuery, typeFilter, natureFilter, statusFilter]);

  const allIds = useMemo(() => {
    const ids = new Set<string>();
    const walk = (nodes: Account[]) => { for (const n of nodes) { if (n.children?.length) { ids.add(n.id); walk(n.children); } } };
    walk(accounts);
    return ids;
  }, [accounts]);

  const toggle = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const expandAll = useCallback(() => setExpandedIds(new Set(allIds)), [allIds]);
  const collapseAll = useCallback(() => setExpandedIds(new Set()), []);

  // auto expand when searching
  React.useEffect(() => {
    if (searchQuery || typeFilter || natureFilter || statusFilter) setExpandedIds(new Set(allIds));
  }, [searchQuery, typeFilter, natureFilter, statusFilter, allIds]);

  const validate = useCallback((): boolean => {
    const e: Record<string, string> = {};
    if (!formData.code?.trim()) e.code = t('validation.required') || 'مطلوب';
    if (!formData.nameAr?.trim()) e.nameAr = t('validation.required') || 'مطلوب';
    if (formData.code && flatList.some((a) => a.code === formData.code && a.id !== editingId)) e.code = 'الرمز مكرر';
    setFormErrors(e);
    return Object.keys(e).length === 0;
  }, [formData, flatList, editingId, t]);

  const handleSave = async () => {
    if (!activeCompany || !validate()) {
      if (!validate()) addToast('error', 'يرجى تصحيح الحقول المطلوبة');
      return;
    }
    setIsSaving(true);
    const payload = {
      companyId: activeCompany.id,
      code: formData.code!.trim(),
      nameAr: formData.nameAr!.trim(),
      nameEn: formData.nameEn?.trim() || undefined,
      parentId: formData.parentId || undefined,
      type: formData.type || 'asset',
      nature: formData.nature || 'debit',
      isGroup: !!formData.isGroup,
      balance: 0,
      openingAmount: isEditMode ? undefined : (Number(openingAmountStr) || 0),
      openingDirection,
      isActive: formData.isActive ?? true,
    } as Omit<Account, 'id'>;
    let result;
    if (isEditMode && editingId) result = await update(editingId, payload);
    else result = await create(payload as Omit<Account, 'id'>);
    if (result.success) {
      addToast('success', isEditMode ? t('accounting.accountDetails') : t('accounting.addAccount'));
      setIsModalOpen(false);
      resetForm();
    } else {
      addToast('error', result.error || t('error'));
    }
    setIsSaving(false);
  };

  const resetForm = () => {
    setFormData({ type: 'asset', nature: 'debit', isGroup: false, isActive: true });
    setOpeningAmountStr('');
    setOpeningDirection('debit');
    setFormErrors({});
    setIsEditMode(false);
    setEditingId(null);
    setCodeTouched(false);
  };

  /** Apply a parent pick: inherit type/nature + auto-generate the code. */
  const applyParent = (parentId: string | undefined) => {
    const parent = parentId ? flatList.find((a) => a.id === parentId) : undefined;
    setFormData((p) => ({
      ...p,
      parentId,
      type: (parent?.type as Account['type']) ?? p.type,
      nature: (parent?.nature as Account['nature']) ?? p.nature,
      // Auto-fill only while the user hasn't typed their own code.
      code: !codeTouched && parentId
        ? (suggestNextCode((parent?.type as Account['type']) ?? p.type, parentId, flatList) || p.code)
        : p.code,
    }));
  };

  const regenerateCode = () => {
    setFormData((p) => ({ ...p, code: suggestNextCode(p.type || 'asset', p.parentId || undefined, flatList) || '' }));
    setCodeTouched(false);
  };

  const handleEdit = (account: Account) => {
    setFormData({
      code: account.code,
      nameAr: account.nameAr,
      nameEn: account.nameEn,
      parentId: account.parentId,
      type: account.type,
      nature: account.nature,
      isGroup: account.isGroup,
      isActive: account.isActive,
    });
    setEditingId(account.id);
    setIsEditMode(true);
    // Existing code belongs to the account — never auto-overwrite it.
    setCodeTouched(true);
    setIsModalOpen(true);
  };

  const handleDelete = async () => {
    if (!confirmDelete) return;
    setIsDeleting(true);
    const res = await remove(confirmDelete.id);
    if (res.success) addToast('success', t('accounting.deleteAccountConfirm'));
    else addToast('error', res.error || t('error'));
    setIsDeleting(false);
    setConfirmDelete(null);
  };

  const handleExportExcel = () => {
    const rows = flatList.map((a) => ({
      code: a.code,
      nameAr: a.nameAr,
      nameEn: a.nameEn || '',
      type: t(TYPE_META[a.type]?.labelKey || a.type),
      nature: a.nature === 'debit' ? t('accounting.debit') : t('accounting.credit'),
      isGroup: a.isGroup ? 'مجموعة' : 'حساب',
      isActive: a.isActive ? t('settings.common.active') : t('settings.common.inactive'),
      balance: Number(a.balance) || 0,
    }));
    exportToExcel(
      rows,
      [
        { key: 'code', header: t('accounting.accountCode'), width: 12 },
        { key: 'nameAr', header: t('accounting.accountName'), width: 28 },
        { key: 'nameEn', header: 'Name EN', width: 20 },
        { key: 'type', header: t('accounting.accountType'), width: 14 },
        { key: 'nature', header: t('accounting.nature'), width: 10 },
        { key: 'isGroup', header: t('accounting.isGroup'), width: 10 },
        { key: 'isActive', header: t('accounting.active'), width: 10 },
        { key: 'balance', header: t('accounting.balance'), width: 14 },
      ],
      `chart_of_accounts_${new Date().toISOString().split('T')[0]}`,
    );
  };

  const handleExportPDF = () => {
    exportToPDF(
      flatList.map((a) => ({
        code: a.code,
        nameAr: a.nameAr,
        type: t(TYPE_META[a.type]?.labelKey || a.type),
        balance: formatCurrency(Number(a.balance) || 0),
      })),
      [
        { key: 'code', header: t('accounting.accountCode') },
        { key: 'nameAr', header: t('accounting.accountName') },
        { key: 'type', header: t('accounting.accountType') },
        { key: 'balance', header: t('accounting.balance') },
      ],
      `chart_of_accounts_${new Date().toISOString().split('T')[0]}`,
      { title: t('accounting.chartOfAccounts'), rtl: true, companyName: activeCompany?.name },
    );
  };

  const parentOptions = useMemo(() => {
    if (!isEditMode || !editingId) return groupAccounts;
    const editingAcc = flatList.find((a) => a.id === editingId);
    if (!editingAcc) return groupAccounts;
    const exclude = getDescendantIds(editingAcc);
    exclude.add(editingId);
    return groupAccounts.filter((a) => !exclude.has(a.id));
  }, [groupAccounts, isEditMode, editingId, flatList]);

  const parentSelectItems = useMemo<SmartSelectItem[]>(
    () => parentOptions.map((a) => ({ id: a.id, label: `${a.code} — ${a.nameAr}` })),
    [parentOptions],
  );

  const selectedParent = formData.parentId ? flatList.find((a) => a.id === formData.parentId) ?? null : null;
  const codeSuggestion = useMemo(
    () => suggestNextCode(formData.type || 'asset', formData.parentId || undefined, flatList),
    [formData.type, formData.parentId, flatList],
  );
  // Soft warning: child codes conventionally start with the parent code.
  const codePrefixMismatch = !!selectedParent
    && !!formData.code
    && !formData.code.startsWith(selectedParent.code);

  if (isLoading) {
    return (
      <div className="space-y-4 p-4">
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <div key={i} className="h-14 bg-slate-100 dark:bg-slate-800 rounded-xl animate-pulse" />
        ))}
      </div>
    );
  }

  const hasFilters = !!(searchQuery || typeFilter || natureFilter || statusFilter);

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col gap-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-primary-600 to-primary-700 flex items-center justify-center shadow-sm">
              <Calculator size={22} className="text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50 tracking-tight">{t('accounting.chartOfAccounts')}</h1>
              <p className="text-sm text-slate-500 dark:text-slate-400">{t('accounting.chartOfAccountsSubtitle')}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 self-start sm:self-auto">
            <Button variant="secondary" size="sm" leftIcon={<FileText size={14} />} onClick={handleExportExcel}>
              Excel
            </Button>
            <Button variant="secondary" size="sm" leftIcon={<Receipt size={14} />} onClick={handleExportPDF}>
              PDF
            </Button>
            <Can action="create" module="accounting">
              <Button variant="primary" leftIcon={<Plus size={16} />} onClick={() => { resetForm(); setIsModalOpen(true); }}>
                {t('accounting.addAccount')}
              </Button>
            </Can>
          </div>
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Card className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold tracking-wider uppercase text-slate-500">إجمالي الحسابات</p>
              <p className="text-2xl font-bold text-slate-900 dark:text-slate-50 tabular-nums">{stats.total}</p>
              <p className="text-xs text-slate-500">{stats.groups} مجموعة • {stats.total - stats.groups} حساب فرعي</p>
            </div>
            <div className="w-10 h-10 rounded-xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
              <Hash size={18} className="text-slate-600" />
            </div>
          </Card>
          <Card className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold tracking-wider uppercase text-slate-500">النشطة</p>
              <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400 tabular-nums">{stats.active}</p>
              <p className="text-xs text-slate-500">{stats.total - stats.active} موقوف</p>
            </div>
            <div className="w-10 h-10 rounded-xl bg-emerald-50 dark:bg-emerald-900/20 flex items-center justify-center">
              <CheckCircle2 size={18} className="text-emerald-600" />
            </div>
          </Card>
          <Card className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold tracking-wider uppercase text-slate-500">إجمالي مدين</p>
              <p className="text-lg font-bold text-blue-600 dark:text-blue-400 tabular-nums">{formatCurrency(stats.debitTotal)}</p>
            </div>
            <div className="w-10 h-10 rounded-xl bg-blue-50 dark:bg-blue-900/20 flex items-center justify-center">
              <TrendingUp size={18} className="text-blue-600" />
            </div>
          </Card>
          <Card className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold tracking-wider uppercase text-slate-500">إجمالي دائن</p>
              <p className="text-lg font-bold text-rose-600 dark:text-rose-400 tabular-nums">{formatCurrency(stats.creditTotal)}</p>
            </div>
            <div className="w-10 h-10 rounded-xl bg-rose-50 dark:bg-rose-900/20 flex items-center justify-center">
              <TrendingDown size={18} className="text-rose-600" />
            </div>
          </Card>
        </div>

        {/* Toolbar */}
        <Card className="p-3 sm:p-4">
          <div className="flex flex-col xl:flex-row gap-3">
            <div className="relative flex-1">
              <Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
              <input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={`${t('accounting.searchAccounts')} — كود / اسم عربي / إنجليزي`}
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 py-2.5 pr-10 pl-9 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 transition"
              />
              {searchQuery && (
                <button onClick={() => setSearchQuery('')} className="absolute left-2 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-center text-slate-400">
                  <X size={14} />
                </button>
              )}
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <div className="flex items-center gap-1.5">
                <Filter size={14} className="text-slate-400 hidden sm:block" />
                <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20">
                  <option value="">{t('accounting.accountType')} — الكل</option>
                  <option value="asset">{t('accounting.asset')}</option>
                  <option value="liability">{t('accounting.liability')}</option>
                  <option value="equity">{t('accounting.equity')}</option>
                  <option value="revenue">{t('accounting.revenue')}</option>
                  <option value="expense">{t('accounting.expense')}</option>
                </select>
                <select value={natureFilter} onChange={(e) => setNatureFilter(e.target.value)} className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20">
                  <option value="">الطبيعة — الكل</option>
                  <option value="debit">{t('accounting.debit')}</option>
                  <option value="credit">{t('accounting.credit')}</option>
                </select>
                <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20">
                  <option value="">الحالة — الكل</option>
                  <option value="active">{t('accounting.active')}</option>
                  <option value="inactive">{t('accounting.inactive')}</option>
                </select>
              </div>
              <div className="h-6 w-px bg-slate-200 dark:bg-slate-700 hidden sm:block" />
              <Button size="sm" variant="secondary" onClick={expandAll} leftIcon={<ChevronDown size={14} />}>
                توسيع الكل
              </Button>
              <Button size="sm" variant="secondary" onClick={collapseAll} leftIcon={<ChevronUp size={14} />}>
                طي الكل
              </Button>
            </div>
          </div>
          {hasFilters && (
            <div className="mt-3 flex items-center gap-2 text-xs text-slate-500">
              <span>{filteredAccounts.length} مجموعة ظاهر • {flatList.length} إجمالي</span>
              <button onClick={() => { setSearchQuery(''); setTypeFilter(''); setNatureFilter(''); setStatusFilter(''); }} className="text-primary-600 hover:underline font-medium">
                مسح الفلترة
              </button>
            </div>
          )}
        </Card>
      </div>

      <Card noPadding>
        {/* Header row */}
        <div className="hidden md:flex items-center gap-2 px-3 py-2.5 bg-slate-50 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 text-[11px] font-bold tracking-wider uppercase text-slate-500">
          <div style={{ width: flatList.length ? 20 * 1 : 0 }} className="shrink-0" />
          <div className="w-6 shrink-0" />
          <div className="w-[110px] shrink-0">الكود</div>
          <div className="flex-1">الحساب</div>
          <div className="w-[340px] hidden lg:flex justify-end gap-2">
            <span className="w-[110px] text-center">النوع</span>
            <span className="w-[70px] text-center">الطبيعة</span>
            <span className="w-[70px] text-center">الحالة</span>
          </div>
          <div className="w-[140px] text-end">الرصيد</div>
          <div className="w-[90px] text-center">إجراءات</div>
        </div>

        <div className="divide-y divide-slate-100 dark:divide-slate-800/50">
          {filteredAccounts.length ? (
            filteredAccounts.map((acc) => (
              <AccountRow
                key={acc.id}
                account={acc}
                level={0}
                expandedIds={expandedIds}
                toggle={toggle}
                onEdit={handleEdit}
                onDelete={(a) => setConfirmDelete(a)}
                formatCurrency={formatCurrency}
              />
            ))
          ) : (
            <div className="py-10">
              <EmptyState
                icon={hasFilters ? 'search' : 'inbox'}
                title={hasFilters ? 'لا توجد نتائج' : t('accounting.noData')}
                description={hasFilters ? 'جرّب تغيير البحث أو الفلترة' : 'أنشئ أول حساب في شجرة الحسابات'}
                action={
                  hasFilters ? (
                    <Button variant="secondary" onClick={() => { setSearchQuery(''); setTypeFilter(''); setNatureFilter(''); setStatusFilter(''); }}>
                      مسح الفلترة
                    </Button>
                  ) : (
                    <Can action="create" module="accounting">
                      <Button variant="primary" leftIcon={<Plus size={16} />} onClick={() => { resetForm(); setIsModalOpen(true); }}>
                        {t('accounting.addAccount')}
                      </Button>
                    </Can>
                  )
                }
              />
            </div>
          )}
        </div>
      </Card>

      {/* Form Modal */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => { setIsModalOpen(false); resetForm(); }}
        title={isEditMode ? t('accounting.editAccount') : t('accounting.addAccount')}
        description={isEditMode ? 'تعديل بيانات الحساب — يراعي التسلسل الهرمي' : 'اختر الحساب الأب واكتب الاسم — الكود والنوع والطبيعة تُولَّد تلقائياً'}
        size="lg"
        footer={
          <div className="flex items-center justify-between w-full">
            <p className="text-xs text-slate-500 hidden sm:flex items-center gap-1.5">
              <AlertCircle size={12} /> الحقول المميزة بـ * مطلوبة
            </p>
            <div className="flex gap-2 ml-auto">
              <Button variant="secondary" onClick={() => { setIsModalOpen(false); resetForm(); }}>
                {t('cancel')}
              </Button>
              <Button variant="primary" onClick={handleSave} isLoading={isSaving}>
                {t('save')}
              </Button>
            </div>
          </div>
        }
      >
        <div className="space-y-5">
          <div>
            <h4 className="text-xs font-bold tracking-wider uppercase text-slate-500 mb-3 flex items-center gap-2">
              <Hash size={12} /> البيانات الأساسية
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="text-xs font-semibold text-slate-500 mb-1.5 block">{t('accounting.accountCode')} *</label>
                <div className="flex gap-1.5">
                  <Input
                    value={formData.code || ''}
                    onChange={(e) => { setCodeTouched(true); setFormData((p) => ({ ...p, code: e.target.value })); }}
                    placeholder={codeSuggestion || '11101'}
                    error={formErrors.code}
                    required
                    dir="ltr"
                    className="flex-1"
                  />
                  <button
                    type="button"
                    onClick={regenerateCode}
                    title={`${t('accounting.form.autoCode')} — ${codeSuggestion || ''}`}
                    aria-label={t('accounting.form.autoCode')}
                    className="shrink-0 w-9 h-9 self-end rounded-lg border border-primary-200 dark:border-primary-800 bg-primary-50 dark:bg-primary-900/20 text-primary-600 dark:text-primary-300 hover:bg-primary-100 dark:hover:bg-primary-900/40 transition flex items-center justify-center"
                  >
                    <Hash size={14} />
                  </button>
                </div>
                {!formData.parentId && !isEditMode && (
                  <p className="text-[11px] text-slate-400 mt-1">{t('accounting.form.inheritHint')}</p>
                )}
              </div>
              <div className="sm:col-span-2">
                <Input label={`${t('accounting.accountName')} (${t('accounting.arabic')}) *`} value={formData.nameAr || ''} onChange={(e) => setFormData((p) => ({ ...p, nameAr: e.target.value }))} placeholder="الصندوق" error={formErrors.nameAr} required />
              </div>
            </div>
            <div className="mt-4">
              <Input label={`${t('accounting.accountName')} (${t('accounting.english')})`} value={formData.nameEn || ''} onChange={(e) => setFormData((p) => ({ ...p, nameEn: e.target.value }))} placeholder="Cash on Hand" dir="ltr" />
            </div>
          </div>

          <div className="h-px bg-slate-100 dark:bg-slate-800" />

          <div>
            <h4 className="text-xs font-bold tracking-wider uppercase text-slate-500 mb-3 flex items-center gap-2">
              <FolderTree size={12} /> {t('accounting.form.hierarchy')}
            </h4>
            <div>
              <label className="text-xs font-semibold text-slate-500 mb-1.5 block">{t('accounting.form.parentAccount')} — {t('accounting.form.parentOptional')}</label>
              <SmartSelect
                value={formData.parentId || ''}
                onChange={(v) => applyParent(typeof v === 'string' && v ? v : undefined)}
                options={parentSelectItems}
                placeholder={t('accounting.form.noParent')}
                searchPlaceholder={`${t('accounting.searchAccounts')}…`}
                clearable
              />
              <p className="text-xs text-slate-500 mt-1">{t('accounting.form.inheritHint')}</p>
            </div>

            {/* Type/nature: inherited & locked when a parent is picked, editable otherwise */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
              {selectedParent ? (
                <>
                  <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 px-4 py-3 flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-500">{t('accounting.accountType')}</span>
                    <span className={cn('text-sm font-medium px-2 py-0.5 rounded-full border', TYPE_META[selectedParent.type]?.bg, TYPE_META[selectedParent.type]?.border, TYPE_META[selectedParent.type]?.color)}>
                      {t(TYPE_META[selectedParent.type]?.labelKey ?? '')}
                    </span>
                  </div>
                  <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 px-4 py-3 flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-500">{t('accounting.nature')}</span>
                    <span className={cn('text-sm font-medium px-2 py-0.5 rounded-full border', NATURE_COLORS[selectedParent.nature])}>
                      {selectedParent.nature === 'debit' ? t('accounting.debit') : t('accounting.credit')}
                    </span>
                  </div>
                  <p className="sm:col-span-2 text-[11px] text-emerald-600 dark:text-emerald-400 -mt-1">
                    ✓ {t('accounting.form.inheritedFromParent')} ({selectedParent.nameAr})
                  </p>
                </>
              ) : (
                <>
                  <div>
                    <label className="text-xs font-semibold text-slate-500 mb-1.5 block">{t('accounting.accountType')} *</label>
                    <select
                      value={formData.type}
                      onChange={(e) => {
                        const type = e.target.value as Account['type'];
                        setFormData((p) => ({ ...p, type, nature: TYPE_NATURE[type] }));
                      }}
                      aria-label={t('accounting.accountType')}
                      className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20"
                    >
                      <option value="asset">{t('accounting.asset')}</option>
                      <option value="liability">{t('accounting.liability')}</option>
                      <option value="equity">{t('accounting.equity')}</option>
                      <option value="revenue">{t('accounting.revenue')}</option>
                      <option value="expense">{t('accounting.expense')}</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-slate-500 mb-1.5 block">{t('accounting.nature')} *</label>
                    <select value={formData.nature} onChange={(e) => setFormData((p) => ({ ...p, nature: e.target.value as Account['nature'] }))} aria-label={t('accounting.nature')} className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20">
                      <option value="debit">{t('accounting.debit')}</option>
                      <option value="credit">{t('accounting.credit')}</option>
                    </select>
                  </div>
                </>
              )}
            </div>
            {codePrefixMismatch && (
              <p className="mt-3 text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1.5">
                <AlertCircle size={12} /> {t('accounting.form.codePrefixWarn')} ({selectedParent?.code}…) — {t('accounting.form.autoCode')}: <button type="button" onClick={regenerateCode} className="underline font-semibold hover:text-amber-700">{codeSuggestion}</button>
              </p>
            )}
          </div>

          <div className="h-px bg-slate-100 dark:bg-slate-800" />

          {/* Opening balance (create mode only) */}
          <div className="rounded-xl border border-dashed border-emerald-300 dark:border-emerald-700 bg-emerald-50/50 dark:bg-emerald-900/10 p-4 space-y-3">
            <p className="text-xs font-bold tracking-wider uppercase text-emerald-700 dark:text-emerald-300 flex items-center gap-2">
              <Wallet size={12} /> {t('openingBalance.title')}
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold text-slate-500 mb-1.5 block">{t('openingBalance.accountAmount')}</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  disabled={isEditMode}
                  value={openingAmountStr}
                  onChange={(e) => setOpeningAmountStr(e.target.value)}
                  placeholder="0.00"
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2.5 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-primary-500/20 disabled:opacity-60 disabled:cursor-not-allowed"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-500 mb-1.5 block">{t('openingBalance.accountDirection')}</label>
                <select
                  value={openingDirection}
                  onChange={(e) => setOpeningDirection(e.target.value as 'debit' | 'credit')}
                  disabled={isEditMode}
                  aria-label={t('openingBalance.accountDirection')}
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  <option value="debit">{t('openingBalance.debit')}</option>
                  <option value="credit">{t('openingBalance.credit')}</option>
                </select>
              </div>
            </div>
            <p className="text-xs text-slate-400">{isEditMode ? t('openingBalance.postedHint') : t('openingBalance.customerHint')}</p>
          </div>

          <div className="h-px bg-slate-100 dark:bg-slate-800" />

          <div>
            <h4 className="text-xs font-bold tracking-wider uppercase text-slate-500 mb-3">الخصائص</h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="flex items-center gap-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 px-4 py-3 cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800 transition">
                <input type="checkbox" checked={!!formData.isGroup} onChange={(e) => setFormData((p) => ({ ...p, isGroup: e.target.checked }))} className="w-4 h-4 rounded border-slate-300 text-primary-600 focus:ring-primary-500" />
                <div>
                  <p className="text-sm font-medium text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                    <Layers size={14} /> {t('accounting.isGroup')}
                  </p>
                  <p className="text-xs text-slate-500">{t('accounting.form.groupHint')}</p>
                </div>
                {formData.isGroup && <span className="ml-auto text-xs px-2 py-1 rounded-full bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300 border border-primary-200">مجموعة</span>}
              </label>
              <label className="flex items-center gap-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 px-4 py-3 cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800 transition">
                <input type="checkbox" checked={formData.isActive ?? true} onChange={(e) => setFormData((p) => ({ ...p, isActive: e.target.checked }))} className="w-4 h-4 rounded border-slate-300 text-primary-600 focus:ring-primary-500" />
                <div>
                  <p className="text-sm font-medium text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                    <Eye size={14} /> {t('accounting.active')}
                  </p>
                  <p className="text-xs text-slate-500">{formData.isActive ?? true ? 'نشط ويمكن التعامل معه' : 'موقوف مؤقتاً'}</p>
                </div>
                <span className={cn('ml-auto text-xs px-2 py-1 rounded-full border', formData.isActive ?? true ? 'bg-emerald-100 text-emerald-700 border-emerald-200' : 'bg-slate-200 text-slate-600 border-slate-300')}>{formData.isActive ?? true ? 'نشط' : 'موقوف'}</span>
              </label>
            </div>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        isOpen={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        onConfirm={handleDelete}
        title={t('accounting.deleteAccount')}
        message={`${t('accounting.deleteAccountConfirm')} — ${confirmDelete?.code} ${confirmDelete?.nameAr}`}
        variant="danger"
        isLoading={isDeleting}
      />
    </div>
  );
};

export default ChartOfAccounts;
