import React, { useState, useMemo } from 'react';
import { Scale, FileDown, Calendar, ChevronLeft } from 'lucide-react';
import { Card, Button, Input } from '@/core/ui/components';
import { useTrialBalance } from '../hooks/useAccounting';
import { useAppStore } from '@/core/store';
import { useTranslation } from '@/core/i18n/useTranslation';
import { exportToExcel, exportToPDF } from '@/core/utils/exportEngine';
import { useFormatters } from '@/core/utils/useFormatters';
import { cn } from '@/core/utils';


export const TrialBalancePage: React.FC = () => {
  const { t } = useTranslation();
  const activeCompany = useAppStore(state => state.activeCompany);
  const { formatCurrency } = useFormatters(activeCompany?.id || '');
  const [asOfDate, setAsOfDate] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const { rows, isLoading } = useTrialBalance(activeCompany?.id || '', asOfDate || undefined);

  const totalDebit = useMemo(() => rows.reduce((s, r) => s + (Number(r.debit) || 0), 0), [rows]);
  const totalCredit = useMemo(() => rows.reduce((s, r) => s + (Number(r.credit) || 0), 0), [rows]);

  const handleExportExcel = () => {
    exportToExcel(rows, [
      { key: 'accountCode', header: t('accounting.accountCode'), width: 12 },
      { key: 'accountName', header: t('accounting.accountName'), width: 30 },
      { key: 'debit', header: t('accounting.debit'), width: 15 },
      { key: 'credit', header: t('accounting.credit'), width: 15 },
      { key: 'balance', header: t('accounting.balance'), width: 15 },
    ], 'TrialBalance');
  };

  const handleExportPDF = () => {
    exportToPDF(rows, [
      { key: 'accountCode', header: t('accounting.accountCode') },
      { key: 'accountName', header: t('accounting.accountName') },
      { key: 'debit', header: t('accounting.debit') },
      { key: 'credit', header: t('accounting.credit') },
      { key: 'balance', header: t('accounting.balance') },
    ], 'TrialBalance', {
      title: t('accounting.trialBalance'),
      subtitle: activeCompany?.name,
      rtl: true,
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
          <Scale size={28} className="text-primary-600 dark:text-primary-400" />
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">{t('accounting.trialBalance')}</h1>
            <p className="text-slate-500 dark:text-slate-400 text-sm">
              {asOfDate ? `${t('accounting.toDate')}: ${asOfDate}` : t('accounting.all')}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" leftIcon={<Calendar size={14} />} onClick={() => setShowFilters(!showFilters)}>
            {t('filter')}
          </Button>
          <Button variant="secondary" size="sm" leftIcon={<FileDown size={14} />} onClick={handleExportExcel}>
            Excel
          </Button>
          <Button variant="secondary" size="sm" leftIcon={<FileDown size={14} />} onClick={handleExportPDF}>
            PDF
          </Button>
        </div>
      </div>

      {showFilters && (
        <Card className="p-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
            <Input 
              label={t('accounting.toDate')} 
              type="date" 
              value={asOfDate} 
              onChange={e => setAsOfDate(e.target.value)} 
            />
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => setAsOfDate('')}>{t('cancel')}</Button>
              <Button onClick={() => setShowFilters(false)}>{t('accounting.applyFilter')}</Button>
            </div>
          </div>
        </Card>
      )}

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-start">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-800">
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 dark:text-slate-400 text-right">{t('accounting.accountCode')}</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 dark:text-slate-400 text-right">{t('accounting.accountName')}</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 dark:text-slate-400 text-right">{t('accounting.debit')}</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 dark:text-slate-400 text-right">{t('accounting.credit')}</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 dark:text-slate-400 text-right">{t('accounting.balance')}</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 dark:text-slate-400 text-right"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, idx) => (
                <tr key={row.accountId || idx} className="border-b border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                  <td className="px-4 py-3 text-sm font-mono text-slate-700 dark:text-slate-200">{row.accountCode}</td>
                  <td className="px-4 py-3 text-sm text-slate-700 dark:text-slate-200">{row.accountName}</td>
                  <td className="px-4 py-3 text-sm text-right tabular-nums text-slate-700 dark:text-slate-200">
                    {formatCurrency(row.debit)}
                  </td>
                  <td className="px-4 py-3 text-sm text-right tabular-nums text-slate-700 dark:text-slate-200">
                    {formatCurrency(row.credit)}
                  </td>
                  <td className={cn('px-4 py-3 text-sm text-right tabular-nums font-medium', Number(row.balance) >= 0 ? 'text-blue-600 dark:text-blue-400' : 'text-rose-600 dark:text-rose-400')}>
                    {formatCurrency(row.balance)}
                  </td>
                  <td className="px-4 py-3 text-sm">
                    <a href={`/accounting/ledger?accountId=${row.accountId}`} className="text-primary-600 hover:text-primary-700 flex items-center gap-1">
                      <ChevronLeft size={14} />
                      <span className="text-xs">{t('accounting.drillDown')}</span>
                    </a>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="text-center py-8 text-slate-400">{t('accounting.noData')}</td>
                </tr>
              )}
              <tr className="bg-slate-50 dark:bg-slate-800 font-semibold border-t-2 border-slate-200 dark:border-slate-700">
                <td className="px-4 py-3 text-sm" colSpan={2}>{t('accounting.balance')}</td>
                <td className="px-4 py-3 text-sm text-right tabular-nums">{formatCurrency(totalDebit)}</td>
                <td className="px-4 py-3 text-sm text-right tabular-nums">{formatCurrency(totalCredit)}</td>
                <td className="px-4 py-3 text-sm text-right tabular-nums">{formatCurrency(totalDebit - totalCredit)}</td>
                <td />
              </tr>
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
};

export default TrialBalancePage;
