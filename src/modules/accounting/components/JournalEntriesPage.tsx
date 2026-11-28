import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { BookOpen, Plus, Send, Undo2 } from 'lucide-react';
import { Card, Button, Modal, PageHeader } from '@/core/ui/components';
import { ConfirmDialog, StatusBadge, ActionButtons, DynamicTable } from '@/core/ui/components';
import { Pagination } from '@/core/ui/components/Pagination';
import { useTransactionsPaginated } from '../hooks/useAccounting';
import { accountingApi } from '../api';
import { reverseTransaction } from '../reversal';
import { ReverseDialog } from './ReverseDialog';
import { useAppStore } from '@/core/store';
import { useAuthStore } from '@/modules/auth/store';
import { useTranslation } from '@/core/i18n/useTranslation';
import { printDocument } from '@/core/utils/printDocument';
import { useSettings } from '@/core/utils/useSettings';
import { Can } from '@/core/ui/components/PermissionGate';
import { useFormatters } from '@/core/utils/useFormatters';
import { YER_CODE } from '@/core/utils/currencyConverter';
import { useUserMap } from '@/core/utils/useUserMap';
import type { Transaction } from '../types';
import { useToastStore } from '@/core/store/toastStore';

export const JournalEntriesPage: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const addToast = useToastStore((s) => s.addToast);
  const activeCompany = useAppStore(state => state.activeCompany);
  const [statusFilter, setStatusFilter] = useState<string>('');
  const txFilters = useMemo(() => ({ status: statusFilter || undefined }), [statusFilter]);
  const { transactions, total, page, pageSize, isLoading, goToPage, changePageSize, post, remove, reload } = useTransactionsPaginated(activeCompany?.id || '', txFilters);
  const currentUser = useAuthStore((s) => s.user);
  const { settings } = useSettings(activeCompany?.id || '');
  const { getUserName } = useUserMap();
  const currencySymbol = settings?.defaultCurrency || activeCompany?.currency || YER_CODE;
  const { formatCurrency, formatDate } = useFormatters(activeCompany?.id || '');

  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [selectedTx, setSelectedTx] = useState<Transaction | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Transaction | null>(null);
  const [reverseTx, setReverseTx] = useState<Transaction | null>(null);

  const handleEdit = (tx: Transaction) => {
    navigate(`/accounting/journal/${tx.id}`);
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

  const handleReverseConfirm = async (date: string, reason: string) => {
    if (!activeCompany || !reverseTx) return;
    const res = await reverseTransaction(activeCompany.id, reverseTx.id, { date, reason }, currentUser?.id || '');
    if (res.success) {
      addToast('success', `${t('accounting.reverse.success')} (${res.data.reference})`);
      setReverseTx(null);
      await reload();
    } else {
      addToast('error', res.error || t('common.error'));
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
      companyLogoUrl: activeCompany?.logoUrl,
      currency: currencySymbol,
      vatRate: settings?.vatRate,
      createdBy: tx.createdBy,
    }, false, t);
  };

  const columns = [
    { key: 'date', header: t('accounting.date'), mobile: 'meta' as const, render: (row: Transaction) => row.date ? formatDate(row.date) : '-' },
    { key: 'reference', header: t('accounting.reference'), mobile: 'title' as const, render: (row: Transaction) => row.reference || '-' },
    { key: 'description', header: t('accounting.description'), mobile: 'subtitle' as const, render: (row: Transaction) => row.description || '-' },
    { key: 'totalAmount', header: t('accounting.amount'), align: 'right' as const, render: (row: Transaction) =>
      formatCurrency(row.totalAmount)
    },
    { key: 'status', header: t('sales.status.label'), mobile: 'status' as const, render: (row: Transaction) => (
      <StatusBadge status={row.status} size="sm" />
    )},
    { key: 'createdBy', header: t('accounting.createdBy'), width: '110px', mobile: 'hidden' as const, render: (row: Transaction) => (
      <span className="text-xs text-slate-600 dark:text-slate-400">{getUserName(row.createdBy)}</span>
    ) },
    { key: 'actions', header: t('edit'), mobile: 'actions' as const, render: (row: Transaction) => (
      <div className="flex items-center gap-1">
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
      {row.status === 'posted' && (
        <Can action="post" module="accounting">
          <Button
            variant="ghost"
            size="sm"
            title={t('accounting.reverse.title')}
            aria-label={t('accounting.reverse.title')}
            onClick={() => setReverseTx(row)}
          >
            <Undo2 size={14} />
          </Button>
        </Can>
      )}
      </div>
    )},
  ];

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Page Header */}
      <PageHeader
        icon={<BookOpen size={22} />}
        title={t('accounting.journalEntries')}
        subtitle={t('accounting.journalEntriesSubtitle')}
        actions={
          <>
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
              <Button variant="primary" leftIcon={<Plus size={16} />} onClick={() => navigate("/accounting/journal/new")}>
                {t('accounting.newJournalEntry')}
              </Button>
            </Can>
          </>
        }
      />

      <Card>
        <DynamicTable<Transaction> tableKey="accounting.journal"
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

      <ReverseDialog
        open={!!reverseTx}
        onClose={() => setReverseTx(null)}
        docLabel={reverseTx?.reference || reverseTx?.id || ''}
        onConfirm={handleReverseConfirm}
      />
    </div>
  );
};

export default JournalEntriesPage;

