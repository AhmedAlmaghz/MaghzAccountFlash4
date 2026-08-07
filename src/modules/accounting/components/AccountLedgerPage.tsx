import React, { useState } from 'react';
import { BookOpen, FileDown, Calendar, Printer } from 'lucide-react';
import { Card, Button, Input } from '@/core/ui/components';
import { AccountSelect } from '@/core/ui/components/smart';
import { useAppStore } from '@/core/store';
import { useTranslation } from '@/core/i18n/useTranslation';
import { useAccountLedger } from '../hooks/useAccounting';
import { exportToExcel, exportToPDF } from '@/core/utils/exportEngine';
import { printDocument } from '@/core/utils/printDocument';
import { cn } from '@/core/utils';
import { useFormatters } from '@/core/utils/useFormatters';

export const AccountLedgerPage: React.FC = () => {
  const { t } = useTranslation();
  const activeCompany = useAppStore(state => state.activeCompany);
  const { formatCurrency, formatDate } = useFormatters(activeCompany?.id || '');
  const [accountId, setAccountId] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  
  const { rows, isLoading } = useAccountLedger(accountId, activeCompany?.id || '', startDate || undefined, endDate || undefined);

  const handleExportExcel = () => {
    exportToExcel(rows, [
      { key: 'date', header: t('accounting.date'), width: 12 },
      { key: 'reference', header: t('accounting.reference'), width: 15 },
      { key: 'description', header: t('accounting.description'), width: 30 },
      { key: 'debit', header: t('accounting.debit'), width: 15 },
      { key: 'credit', header: t('accounting.credit'), width: 15 },
      { key: 'balance', header: t('accounting.balance'), width: 15 },
    ], 'AccountLedger');
  };

  const handleExportPDF = () => {
    exportToPDF(rows, [
      { key: 'date', header: t('accounting.date') },
      { key: 'reference', header: t('accounting.reference') },
      { key: 'description', header: t('accounting.description') },
      { key: 'debit', header: t('accounting.debit') },
      { key: 'credit', header: t('accounting.credit') },
      { key: 'balance', header: t('accounting.balance') },
    ], 'AccountLedger', {
      title: t('accounting.accountLedger'),
      subtitle: activeCompany?.name,
      rtl: true,
    });
  };

  const handlePrint = () => {
    printDocument({
      type: 'ledger',
      docNumber: accountId,
      date: `${startDate} - ${endDate}`,
      partyName: activeCompany?.name || '',
      partyLabel: t('accounting.company'),
      lines: rows.map(r => ({
        description: `${r.date} | ${r.reference || '-'} | ${r.description || '-'}`,
        total: r.debit || r.credit,
      })),
      subtotal: rows.reduce((s, r) => s + r.debit, 0),
      vatAmount: 0,
      totalAmount: rows.length > 0 ? rows[rows.length - 1].balance : 0,
      companyName: activeCompany?.name,
      companyTaxNumber: activeCompany?.taxNumber,
      companyAddress: activeCompany?.address,
      companyPhone: activeCompany?.phone,
      companyEmail: activeCompany?.email,
      currency: activeCompany?.currency,
    });
  };

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
          <BookOpen size={28} className="text-primary-600 dark:text-primary-400" />
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">{t('accounting.accountLedger')}</h1>
            <p className="text-slate-500 dark:text-slate-400 text-sm">{t('accounting.ledgerSubtitle')}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" leftIcon={<Calendar size={14} />} onClick={() => setShowFilters(!showFilters)}>
            {t('filter')}
          </Button>
          <Button variant="secondary" size="sm" leftIcon={<FileDown size={14} />} onClick={handleExportExcel} disabled={!accountId}>
            Excel
          </Button>
          <Button variant="secondary" size="sm" leftIcon={<FileDown size={14} />} onClick={handleExportPDF} disabled={!accountId}>
            PDF
          </Button>
          <Button variant="secondary" size="sm" leftIcon={<Printer size={14} />} onClick={handlePrint} disabled={!accountId}>
            {t('print')}
          </Button>
        </div>
      </div>

      <Card className="p-4">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">{t('accounting.accountName')}</label>
            <AccountSelect 
              companyId={activeCompany?.id || ''} 
              value={accountId} 
              onChange={v => setAccountId(v || '')} 
            />
          </div>
          <Input label={t('accounting.fromDate')} type="date" value={startDate} onChange={e => setStartDate(e.target.value)} />
          <Input label={t('accounting.toDate')} type="date" value={endDate} onChange={e => setEndDate(e.target.value)} />
          <Button onClick={() => setShowFilters(false)} disabled={!accountId}>{t('accounting.applyFilter')}</Button>
        </div>
      </Card>

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-start">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-800">
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 dark:text-slate-400 text-right">{t('accounting.date')}</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 dark:text-slate-400 text-right">{t('accounting.reference')}</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 dark:text-slate-400 text-right">{t('accounting.description')}</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 dark:text-slate-400 text-right">{t('accounting.debit')}</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 dark:text-slate-400 text-right">{t('accounting.credit')}</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 dark:text-slate-400 text-right">{t('accounting.balance')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                  <td className="px-4 py-3 text-sm text-slate-700 dark:text-slate-200">{row.date ? formatDate(row.date) : '-'}</td>
                  <td className="px-4 py-3 text-sm font-mono text-slate-700 dark:text-slate-200">{row.reference || '-'}</td>
                  <td className="px-4 py-3 text-sm text-slate-700 dark:text-slate-200">{row.description || '-'}</td>
                  <td className="px-4 py-3 text-sm text-right tabular-nums text-slate-700 dark:text-slate-200">
                    {row.debit > 0 ? formatCurrency(row.debit) : '-'}
                  </td>
                  <td className="px-4 py-3 text-sm text-right tabular-nums text-slate-700 dark:text-slate-200">
                    {row.credit > 0 ? formatCurrency(row.credit) : '-'}
                  </td>
                  <td className={cn('px-4 py-3 text-sm text-right tabular-nums font-medium', Number(row.balance) >= 0 ? 'text-blue-600 dark:text-blue-400' : 'text-rose-600 dark:text-rose-400')}>
                    {formatCurrency(row.balance)}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="text-center py-8 text-slate-400">{t('accounting.noData')}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
};

export default AccountLedgerPage;
