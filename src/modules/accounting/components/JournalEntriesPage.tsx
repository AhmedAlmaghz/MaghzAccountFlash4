import React, { useState, useMemo } from 'react';
import { BookOpen, Plus, Save, Send, X } from 'lucide-react';
import { Card, Button, Input, Modal, Table } from '@/core/ui/components';
import { ConfirmDialog, StatusBadge, ActionButtons } from '@/core/ui/components';
import { AccountSelect } from '@/core/ui/components/smart';
import { Pagination } from '@/core/ui/components/Pagination';
import { useTransactionsPaginated } from '../hooks/useAccounting';
import { accountingApi } from '../api';
import { useAppStore } from '@/core/store';
import { useTranslation } from '@/core/i18n/useTranslation';
import { printDocument } from '@/core/utils/printDocument';
import { useDocumentSequence } from '@/core/utils/useDocumentSequence';
import { useSettings } from '@/core/utils/useSettings';
import { Can } from '@/core/ui/components/PermissionGate';
import { cn } from '@/core/utils';
import { useFormatters } from '@/core/utils/useFormatters';
import { YER_CODE } from '@/core/utils/currencyConverter';
import { useUserMap } from '@/core/utils/useUserMap';
import type { Transaction, JournalEntry as JournalEntryType } from '../types';
import { useToastStore } from '@/core/store/toastStore';

interface EntryLine {
  accountId: string;
  debit: number;
  credit: number;
  memo: string;
}

const emptyLine = (): EntryLine => ({ accountId: '', debit: 0, credit: 0, memo: '' });

export const JournalEntriesPage: React.FC = () => {
  const { t } = useTranslation();
  const addToast = useToastStore((s) => s.addToast);
  const activeCompany = useAppStore(state => state.activeCompany);
  const [statusFilter, setStatusFilter] = useState<string>('');
  const txFilters = useMemo(() => ({ status: statusFilter || undefined }), [statusFilter]);
  const { transactions, total, page, pageSize, isLoading, goToPage, changePageSize, create, update, post, remove } = useTransactionsPaginated(activeCompany?.id || '', txFilters);
  const { getNextNumber } = useDocumentSequence();
  const { settings } = useSettings(activeCompany?.id || '');
  const { getUserName } = useUserMap();
  const currencySymbol = settings?.defaultCurrency || activeCompany?.currency || YER_CODE;
  const { formatCurrency, formatDate } = useFormatters(activeCompany?.id || '');

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selectedTx, setSelectedTx] = useState<Transaction | null>(null);
  
  const [entries, setEntries] = useState<EntryLine[]>([emptyLine(), emptyLine()]);
  const [reference, setReference] = useState('');
  const [description, setDescription] = useState('');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [isSaving, setIsSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<Transaction | null>(null);

  const totalDebit = useMemo(() => entries.reduce((sum, e) => sum + (Number(e.debit) || 0), 0), [entries]);
  const totalCredit = useMemo(() => entries.reduce((sum, e) => sum + (Number(e.credit) || 0), 0), [entries]);
  const isBalanced = totalDebit === totalCredit && totalDebit > 0;

  const addEntry = () => setEntries(prev => [...prev, emptyLine()]);
  const removeEntry = (index: number) => setEntries(prev => prev.length > 2 ? prev.filter((_, i) => i !== index) : prev);
  const updateEntry = (index: number, field: keyof EntryLine, value: string | number) => {
    setEntries(prev => prev.map((e, i) => i === index ? { ...e, [field]: value } : e));
  };

  const resetForm = () => {
    setEntries([emptyLine(), emptyLine()]);
    setReference('');
    setDescription('');
    setDate(new Date().toISOString().split('T')[0]);
    setIsEditMode(false);
    setEditingId(null);
  };

  const handleSave = async (status: 'draft' | 'posted') => {
    if (!activeCompany) return;
    if (status === 'posted' && !isBalanced) return;

    setIsSaving(true);
    let ref = reference;
    if (!isEditMode && activeCompany.id) {
      const seq = await getNextNumber('journal_voucher', activeCompany.id);
      if (seq.success && seq.number) {
        ref = seq.number;
      }
    }

    const payload = {
      companyId: activeCompany.id,
      date,
      reference: ref,
      description,
      totalAmount: totalDebit,
      status,
      entries: entries.filter(e => e.accountId).map(e => ({
        id: crypto.randomUUID(),
        transactionId: editingId || '',
        accountId: e.accountId,
        debit: Number(e.debit) || 0,
        credit: Number(e.credit) || 0,
        memo: e.memo,
      })) as JournalEntryType[],
    };

    let result;
    if (isEditMode && editingId) {
      result = await update(editingId, payload);
    } else {
      result = await create(payload as Omit<Transaction, 'id'>);
    }

    if (result.success) {
      setIsModalOpen(false);
      resetForm();
      addToast('success', t(isEditMode ? 'accounting.transaction.updated' : 'accounting.transaction.created'));
    } else {
      addToast('error', result.error || t('common.error'));
    }
    setIsSaving(false);
  };

  const handleEdit = async (tx: Transaction) => {
    setEditingId(tx.id);
    setIsEditMode(true);
    setDate(tx.date);
    setReference(tx.reference || '');
    setDescription(tx.description || '');
    setEntries([emptyLine(), emptyLine()]);
    setIsModalOpen(true);

    if (!activeCompany) return;
    const result = await accountingApi.getTransactionById(tx.id, activeCompany.id);
    if (result.success && result.data && result.data.entries.length > 0) {
      setEntries(result.data.entries.map(e => ({
        accountId: e.accountId,
        debit: Number(e.debit) || 0,
        credit: Number(e.credit) || 0,
        memo: e.memo || '',
      })));
    }
  };

  const handlePost = async (tx: Transaction) => {
    if (tx.status === 'draft') {
      const result = await post(tx.id);
      if (result.success) {
        addToast('success', t('accounting.transaction.posted'));
      } else {
        addToast('error', result.error || t('common.error'));
      }
    }
  };

  const handlePrint = async (tx: Transaction) => {
    let entries = tx.entries || [];
    if (entries.length === 0 && activeCompany) {
      const result = await accountingApi.getTransactionById(tx.id, activeCompany.id);
      if (result.success && result.data) {
        entries = result.data.entries;
      }
    }
    printDocument({
      type: 'journal-entry',
      docNumber: tx.reference || tx.id,
      date: tx.date,
      partyName: activeCompany?.name || '',
      partyLabel: t('accounting.company'),
      lines: entries.map(e => ({
        description: `${e.account?.nameAr || e.accountId} - ${e.memo || ''}`,
        total: e.debit || e.credit,
      })),
      subtotal: tx.totalAmount,
      vatAmount: 0,
      totalAmount: tx.totalAmount,
      notes: tx.description,
      companyName: activeCompany?.name,
      companyTaxNumber: activeCompany?.taxNumber,
      companyAddress: activeCompany?.address,
      companyPhone: activeCompany?.phone,
      companyEmail: activeCompany?.email,
      currency: currencySymbol,
      createdBy: tx.createdBy,
    });
  };

  const columns = [
    { key: 'date', header: t('accounting.date'), render: (row: Transaction) => row.date ? formatDate(row.date) : '-' },
    { key: 'reference', header: t('accounting.reference'), render: (row: Transaction) => row.reference || '-' },
    { key: 'description', header: t('accounting.description'), render: (row: Transaction) => row.description || '-' },
    { key: 'totalAmount', header: t('accounting.amount'), align: 'right' as const, render: (row: Transaction) => 
      formatCurrency(row.totalAmount)
    },
    { key: 'status', header: t('sales.status.label'), render: (row: Transaction) => (
      <StatusBadge status={row.status} size="sm" />
    )},
    { key: 'createdBy', header: t('accounting.createdBy'), width: '110px', render: (row: Transaction) => (
      <span className="text-xs text-slate-600 dark:text-slate-400">{getUserName(row.createdBy)}</span>
    ) },
    { key: 'actions', header: t('edit'), render: (row: Transaction) => (
      <ActionButtons
        size="sm"
        onView={async () => {
          if (activeCompany) {
            const result = await accountingApi.getTransactionById(row.id, activeCompany.id);
            if (result.success && result.data) {
              setSelectedTx(result.data);
            } else {
              setSelectedTx(row);
            }
          } else {
            setSelectedTx(row);
          }
          setIsDetailOpen(true);
        }}
        onEdit={() => handleEdit(row)}
        onDelete={() => setConfirmDelete(row)}
        onPreview={() => handlePrint(row)}
        onPrint={() => handlePrint(row)}
        showPreview
        showPrint
        showExport={false}
        disabledEdit={row.status === 'posted'}
        disabledDelete={row.status === 'posted'}
      />
    )},
  ];

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <BookOpen size={28} className="text-primary-600 dark:text-primary-400" />
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">{t('accounting.journalEntries')}</h1>
            <p className="text-slate-500 dark:text-slate-400 text-sm">{t('accounting.journalEntriesSubtitle')}</p>
          </div>
      </div>
      <div className="flex items-center gap-2">
        <select
          className="input text-sm"
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          title={t('accounting.status')}
        >
          <option value="">{t('accounting.all')}</option>
          <option value="draft">{t('accounting.draft')}</option>
          <option value="posted">{t('accounting.posted')}</option>
        </select>
        <Can action="create" module="accounting">
          <Button variant="primary" leftIcon={<Plus size={16} />} onClick={() => { resetForm(); setIsModalOpen(true); }}>
            {t('accounting.newJournalEntry')}
          </Button>
        </Can>
      </div>
    </div>

      <Card>
        <Table<Transaction>
          data={transactions}
          columns={columns}
          keyExtractor={(row, i) => row.id || String(i)}
          isLoading={isLoading}
          emptyMessage={t('accounting.noData')}
        />
        <Pagination
          page={page}
          pageSize={pageSize}
          total={total}
          onPageChange={goToPage}
          onPageSizeChange={changePageSize}
        />
      </Card>

      {/* Create/Edit Modal */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={isEditMode ? t('accounting.editJournalEntry') : t('accounting.newJournalEntry')}
        size="xl"
        footer={
          <div className="flex items-center gap-2 justify-end w-full">
            <Button variant="secondary" onClick={() => setIsModalOpen(false)} disabled={isSaving}>{t('cancel')}</Button>
            <Button 
              variant="secondary" 
              leftIcon={<Save size={16} />} 
              onClick={() => handleSave('draft')}
              isLoading={isSaving}
            >
              {t('accounting.saveDraft')}
            </Button>
            <Button 
              variant="primary" 
              leftIcon={<Send size={16} />} 
              onClick={() => handleSave('posted')}
              disabled={!isBalanced}
              isLoading={isSaving}
            >
              {t('accounting.postEntry')}
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-4">
            <Input label={t('accounting.date')} type="date" value={date} onChange={e => setDate(e.target.value)} />
            <Input label={t('accounting.reference')} value={reference} onChange={e => setReference(e.target.value)} />
            <Input label={t('accounting.description')} value={description} onChange={e => setDescription(e.target.value)} />
          </div>
          
          <div className="border border-slate-200 dark:border-slate-700 rounded-lg overflow-hidden">
            <table className="w-full">
              <thead className="bg-slate-50 dark:bg-slate-800">
                <tr>
                  <th className="text-xs font-semibold text-slate-500 p-2 text-right">{t('accounting.accountName')}</th>
                  <th className="text-xs font-semibold text-slate-500 p-2 text-right w-28">{t('accounting.debit')}</th>
                  <th className="text-xs font-semibold text-slate-500 p-2 text-right w-28">{t('accounting.credit')}</th>
                  <th className="text-xs font-semibold text-slate-500 p-2 text-right">{t('accounting.memo')}</th>
                  <th className="w-10"></th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry, idx) => (
                  <tr key={idx} className="border-t border-slate-200 dark:border-slate-700">
                    <td className="p-2">
                      <AccountSelect
                        companyId={activeCompany?.id || ''}
                        value={entry.accountId || ''}
                        onChange={v => updateEntry(idx, 'accountId', v || '')}
                        size="sm"
                      />
                    </td>
                    <td className="p-2">
                      <Input 
                        type="number" 
                        value={String(entry.debit || '')}
                        onChange={e => updateEntry(idx, 'debit', Number(e.target.value))}
                        size="sm"
                      />
                    </td>
                    <td className="p-2">
                      <Input 
                        type="number"
                        value={String(entry.credit || '')}
                        onChange={e => updateEntry(idx, 'credit', Number(e.target.value))}
                        size="sm"
                      />
                    </td>
                    <td className="p-2">
                      <Input 
                        value={entry.memo || ''}
                        onChange={e => updateEntry(idx, 'memo', e.target.value)}
                        size="sm"
                      />
                    </td>
                    <td className="p-2">
                      <button onClick={() => removeEntry(idx)} className="text-rose-500 hover:text-rose-700">
                        <X size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-slate-50 dark:bg-slate-800 font-semibold">
                <tr>
                  <td className="p-2 text-right">{t('accounting.totalDebit')} / {t('accounting.totalCredit')}</td>
                  <td className={cn('p-2 text-right', totalDebit !== totalCredit ? 'text-danger-600' : '')}>
                    {formatCurrency(totalDebit)}
                  </td>
                  <td className={cn('p-2 text-right', totalDebit !== totalCredit ? 'text-danger-600' : '')}>
                    {formatCurrency(totalCredit)}
                  </td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            </table>
          </div>
          
          <Button variant="secondary" onClick={addEntry} size="sm">+ {t('accounting.addLine')}</Button>
          
          {!isBalanced && entries.length > 1 && (
            <p className="text-danger-600 text-sm">{t('accounting.unbalancedEntry')}: {t('accounting.difference')} = {formatCurrency(totalDebit - totalCredit)}</p>
          )}
        </div>
      </Modal>

      {/* Detail View Modal */}
      <Modal
        isOpen={isDetailOpen}
        onClose={() => setIsDetailOpen(false)}
        title={t('accounting.journalEntryDetails')}
        size="lg"
        footer={
          <div className="flex items-center gap-2 justify-end w-full">
            <Button variant="secondary" onClick={() => setIsDetailOpen(false)}>{t('close')}</Button>
            {selectedTx?.status === 'draft' && (
              <Button variant="primary" leftIcon={<Send size={16} />} onClick={() => { handlePost(selectedTx); setIsDetailOpen(false); }}>
                {t('accounting.postEntry')}
              </Button>
            )}
          </div>
        }
      >
        {selectedTx && (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-4 text-sm">
              <div><span className="text-slate-500">{t('accounting.date')}:</span> {selectedTx.date ? formatDate(selectedTx.date) : '-'}</div>
              <div><span className="text-slate-500">{t('accounting.reference')}:</span> {selectedTx.reference || '-'}</div>
              <div><span className="text-slate-500">{t('sales.status.label')}:</span> <StatusBadge status={selectedTx.status} size="sm" /></div>
            </div>
            <div className="text-sm"><span className="text-slate-500">{t('accounting.description')}:</span> {selectedTx.description || '-'}</div>
            
            <div className="border border-slate-200 dark:border-slate-700 rounded-lg overflow-hidden">
              <table className="w-full">
                <thead className="bg-slate-50 dark:bg-slate-800">
                  <tr>
                    <th className="text-xs font-semibold text-slate-500 p-2 text-right">{t('accounting.accountName')}</th>
                    <th className="text-xs font-semibold text-slate-500 p-2 text-right w-28">{t('accounting.debit')}</th>
                    <th className="text-xs font-semibold text-slate-500 p-2 text-right w-28">{t('accounting.credit')}</th>
                    <th className="text-xs font-semibold text-slate-500 p-2 text-right">{t('accounting.memo')}</th>
                  </tr>
                </thead>
                <tbody>
                  {(selectedTx.entries || []).map((entry, idx) => (
                    <tr key={idx} className="border-t border-slate-200 dark:border-slate-700">
                      <td className="p-2 text-sm">{entry.account?.nameAr || entry.accountId}</td>
                      <td className="p-2 text-sm text-right tabular-nums">{entry.debit > 0 ? formatCurrency(entry.debit) : '-'}</td>
                      <td className="p-2 text-sm text-right tabular-nums">{entry.credit > 0 ? formatCurrency(entry.credit) : '-'}</td>
                      <td className="p-2 text-sm">{entry.memo || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            
            <div className="flex justify-between text-sm font-semibold">
              <span>{t('accounting.amount')}</span>
              <span className="tabular-nums">{formatCurrency(selectedTx.totalAmount)}</span>
            </div>
          </div>
        )}
      </Modal>

      <ConfirmDialog
        isOpen={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        onConfirm={async () => {
          if (confirmDelete) {
            const result = await remove(confirmDelete.id);
            if (result.success) {
              addToast('success', t('accounting.transaction.deleted'));
            } else {
              addToast('error', result.error || t('common.error'));
            }
            setConfirmDelete(null);
          }
        }}
        title={t('delete')}
        message={`${t('accounting.deleteConfirm')} "${confirmDelete?.reference || confirmDelete?.id}"?`}
        variant="danger"
      />
    </div>
  );
};

export default JournalEntriesPage;
