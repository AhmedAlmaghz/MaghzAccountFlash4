import React, { useState, useMemo } from 'react';
import { Calculator, Plus, ChevronDown, ChevronLeft, Search } from 'lucide-react';
import { Card, Button, Input, Modal } from '@/core/ui/components';
import { ConfirmDialog, StatusBadge, ActionButtons } from '@/core/ui/components';
import { useAccounts } from '../hooks/useAccounting';
import { useAppStore } from '@/core/store';
import { useTranslation } from '@/core/i18n/useTranslation';
import { cn } from '@/core/utils';
import { Can } from '@/core/ui/components/PermissionGate';
import { useFormatters } from '@/core/utils/useFormatters';
import type { Account } from '../types';

const TYPE_LABELS_KEYS: Record<string, string> = {
  asset: 'accounting.asset',
  liability: 'accounting.liability',
  equity: 'accounting.equity',
  revenue: 'accounting.revenue',
  expense: 'accounting.expense',
};

const NATURE_COLORS: Record<string, string> = {
  debit: 'text-blue-600 dark:text-blue-400',
  credit: 'text-rose-600 dark:text-rose-400',
};

interface AccountTreeItemProps {
  account: Account;
  level?: number;
  searchQuery: string;
  onEdit: (account: Account) => void;
  onDelete: (account: Account) => void;
  formatCurrency: (value: number | string) => string;
}

function AccountTreeItem({ account, level = 0, searchQuery, onEdit, onDelete, formatCurrency }: AccountTreeItemProps) {
  const { t } = useTranslation();
  const [isExpanded, setIsExpanded] = useState(true);
  const hasChildren = account.children && account.children.length > 0;
  const isMatch = searchQuery === '' || 
    (account.nameAr?.toLowerCase() || '').includes(searchQuery.toLowerCase()) ||
    account.code?.includes(searchQuery);

  const matchesChild = useMemo(() => {
    if (!searchQuery || !hasChildren) return false;
    return account.children!.some(child => 
      (child.nameAr?.toLowerCase() || '').includes(searchQuery.toLowerCase()) ||
      child.code?.includes(searchQuery)
    );
  }, [account, hasChildren, searchQuery]);

  if (!isMatch && !matchesChild) return null;

  return (
    <div>
      <div
        className={cn(
          'flex items-center gap-2 py-2 px-3 hover:bg-slate-50 dark:hover:bg-slate-800/50 rounded-lg transition-colors',
          level > 0 && 'mr-8 border-r-2 border-slate-200 dark:border-slate-700'
        )}
        style={{ marginRight: `${level * 24}px` }}
      >
        {hasChildren && (
          <button onClick={() => setIsExpanded(!isExpanded)} className="p-0.5 rounded hover:bg-slate-200 dark:hover:bg-slate-700">
            {isExpanded ? <ChevronDown size={16} /> : <ChevronLeft size={16} />}
          </button>
        )}
        {!hasChildren && <div className="w-5" />}
        
        <div className="flex-1 flex items-center gap-3">
          <span className="font-mono text-sm text-slate-500 w-20">{account.code}</span>
          <span className="font-medium text-slate-900 dark:text-slate-50">{account.nameAr}</span>
          {account.nameEn && <span className="text-xs text-slate-400">({account.nameEn})</span>}
        </div>
        
        <div className="flex items-center gap-4 text-sm">
          <span className="px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-xs text-slate-600 dark:text-slate-300">
            {t(TYPE_LABELS_KEYS[account.type])}
          </span>
          <span className={cn('font-mono', NATURE_COLORS[account.nature])}>
            {account.nature === 'debit' ? t('accounting.debit') : t('accounting.credit')}
          </span>
          <StatusBadge status={account.isActive ? 'active' : 'inactive'} size="sm" />
          {!account.isGroup && (
            <span className="font-mono text-slate-700 dark:text-slate-200 w-32 text-left tabular-nums">
              {formatCurrency(account.balance)}
            </span>
          )}
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
          {account.children!.map(child => (
            <AccountTreeItem 
              key={child.id} 
              account={child} 
              level={level + 1} 
              searchQuery={searchQuery}
              onEdit={onEdit}
              onDelete={onDelete}
              formatCurrency={formatCurrency}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export const ChartOfAccounts: React.FC = () => {
  const { t } = useTranslation();
  const activeCompany = useAppStore(state => state.activeCompany);
  const { accounts, isLoading, create, update, remove } = useAccounts(activeCompany?.id || '');
  const { formatCurrency } = useFormatters(activeCompany?.id || '');
  
  const [searchQuery, setSearchQuery] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState<Partial<Account>>({
    type: 'asset',
    nature: 'debit',
    isGroup: false,
    isActive: true,
  });
  const [isSaving, setIsSaving] = useState(false);
  
  const [confirmDelete, setConfirmDelete] = useState<Account | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const handleSave = async () => {
    if (!activeCompany || !formData.code || !formData.nameAr) return;
    setIsSaving(true);
    
    const payload = {
      companyId: activeCompany.id,
      code: formData.code,
      nameAr: formData.nameAr,
      nameEn: formData.nameEn,
      parentId: formData.parentId,
      type: formData.type || 'asset',
      nature: formData.nature || 'debit',
      isGroup: formData.isGroup || false,
      balance: 0,
      isActive: formData.isActive ?? true,
    };
    
    let result;
    if (isEditMode && editingId) {
      result = await update(editingId, payload);
    } else {
      result = await create(payload as Omit<Account, 'id'>);
    }
    
    if (result.success) {
      setIsModalOpen(false);
      resetForm();
    }
    setIsSaving(false);
  };

  const resetForm = () => {
    setFormData({ type: 'asset', nature: 'debit', isGroup: false, isActive: true });
    setIsEditMode(false);
    setEditingId(null);
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
    setIsModalOpen(true);
  };

  const handleDelete = async () => {
    if (!confirmDelete) return;
    setIsDeleting(true);
    await remove(confirmDelete.id);
    setIsDeleting(false);
    setConfirmDelete(null);
  };

  const filteredAccounts = useMemo(() => {
    if (!searchQuery) return accounts;
    return accounts.filter(acc => 
      (acc.nameAr?.toLowerCase() || '').includes(searchQuery.toLowerCase()) ||
      acc.code?.includes(searchQuery) ||
      acc.children?.some(child => 
        (child.nameAr?.toLowerCase() || '').includes(searchQuery.toLowerCase()) ||
        child.code?.includes(searchQuery)
      )
    );
  }, [accounts, searchQuery]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Calculator size={28} className="text-primary-600 dark:text-primary-400" />
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">{t('accounting.chartOfAccounts')}</h1>
            <p className="text-slate-500 dark:text-slate-400 text-sm">{t('accounting.chartOfAccountsSubtitle')}</p>
          </div>
        </div>
        <Can action="create" module="accounting">
          <Button variant="primary" leftIcon={<Plus size={16} />} onClick={() => { resetForm(); setIsModalOpen(true); }}>
            {t('accounting.addAccount')}
          </Button>
        </Can>
      </div>

      <div className="relative">
        <Search className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
        <Input 
          placeholder={t('accounting.searchAccounts')} 
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          className="pr-10"
        />
      </div>

      <Card>
        <div className="space-y-1">
          {filteredAccounts.map(account => (
            <AccountTreeItem 
              key={account.id} 
              account={account} 
              searchQuery={searchQuery}
              onEdit={handleEdit}
              onDelete={acc => setConfirmDelete(acc)}
              formatCurrency={formatCurrency}
            />
          ))}
          {filteredAccounts.length === 0 && (
            <p className="text-center text-slate-400 py-8">{t('accounting.noData')}</p>
          )}
        </div>
      </Card>

      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={isEditMode ? t('accounting.editAccount') : t('accounting.addAccount')}
        size="md"
        footer={
          <>
            <Button variant="secondary" onClick={() => setIsModalOpen(false)}>{t('cancel')}</Button>
            <Button variant="primary" onClick={handleSave} isLoading={isSaving}>{t('save')}</Button>
          </>
        }
      >
        <div className="space-y-4">
          <Input label={t('accounting.accountCode')} value={formData.code || ''} onChange={e => setFormData(prev => ({ ...prev, code: e.target.value }))} />
          <Input label={`${t('accounting.accountName')} (${t('accounting.arabic')})`} value={formData.nameAr || ''} onChange={e => setFormData(prev => ({ ...prev, nameAr: e.target.value }))} />
          <Input label={`${t('accounting.accountName')} (${t('accounting.english')})`} value={formData.nameEn || ''} onChange={e => setFormData(prev => ({ ...prev, nameEn: e.target.value }))} />
          <div>
            <label className="text-xs font-semibold text-slate-500 block mb-1.5">{t('accounting.accountType')}</label>
            <select
              value={formData.type}
              onChange={e => setFormData(prev => ({ ...prev, type: e.target.value as Account['type'] }))}
              className="form-control"
            >
              <option value="asset">{t('accounting.asset')}</option>
              <option value="liability">{t('accounting.liability')}</option>
              <option value="equity">{t('accounting.equity')}</option>
              <option value="revenue">{t('accounting.revenue')}</option>
              <option value="expense">{t('accounting.expense')}</option>
            </select>
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-500 block mb-1.5">{t('accounting.nature')}</label>
            <select
              value={formData.nature}
              onChange={e => setFormData(prev => ({ ...prev, nature: e.target.value as Account['nature'] }))}
              className="form-control"
            >
              <option value="debit">{t('accounting.debit')}</option>
              <option value="credit">{t('accounting.credit')}</option>
            </select>
          </div>
          <div className="flex items-center gap-2">
            <input 
              type="checkbox" 
              id="isGroup" 
              checked={formData.isGroup || false}
              onChange={e => setFormData(prev => ({ ...prev, isGroup: e.target.checked }))}
              className="rounded border-slate-300"
            />
            <label htmlFor="isGroup" className="text-sm text-slate-700 dark:text-slate-300">{t('accounting.isGroup')}</label>
          </div>
          <div className="flex items-center gap-2">
            <input 
              type="checkbox" 
              id="isActive" 
              checked={formData.isActive ?? true}
              onChange={e => setFormData(prev => ({ ...prev, isActive: e.target.checked }))}
              className="rounded border-slate-300"
            />
            <label htmlFor="isActive" className="text-sm text-slate-700 dark:text-slate-300">{t('accounting.active')}</label>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        isOpen={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        onConfirm={handleDelete}
        title={t('accounting.deleteAccount')}
        message={t('accounting.deleteAccountConfirm')}
        variant="danger"
        isLoading={isDeleting}
      />
    </div>
  );
};

export default ChartOfAccounts;
