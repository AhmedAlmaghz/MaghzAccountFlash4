import React, { useState, useMemo } from 'react';
import { BookOpen, FileDown, Calendar, Printer, Search, X, Wallet, TrendingUp, TrendingDown, Hash } from 'lucide-react';
import { Card, Button, Input, Badge } from '@/core/ui/components';
import { EmptyState } from '@/core/ui/components/EmptyState';
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
  const activeCompany = useAppStore((state) => state.activeCompany);
  const { formatCurrency, formatDate } = useFormatters(activeCompany?.id || '');
  const [accountId, setAccountId] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [search, setSearch] = useState('');
  const [showFilters, setShowFilters] = useState(true);

  const { rows, isLoading } = useAccountLedger(accountId, activeCompany?.id || '', startDate || undefined, endDate || undefined);

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => (r.reference?.toLowerCase() || '').includes(q) || (r.description?.toLowerCase() || '').includes(q));
  }, [rows, search]);

  const totals = useMemo(() => {
    const debit = filteredRows.reduce((s, r) => s + (Number(r.debit) || 0), 0);
    const credit = filteredRows.reduce((s, r) => s + (Number(r.credit) || 0), 0);
    const balance = filteredRows.length ? filteredRows[filteredRows.length - 1].balance : 0;
    return { debit, credit, balance, count: filteredRows.length };
  }, [filteredRows]);

  const handleExportExcel = () => {
    exportToExcel(
      filteredRows,
      [
        { key: 'date', header: t('accounting.date'), width: 12 },
        { key: 'reference', header: t('accounting.reference'), width: 15 },
        { key: 'description', header: t('accounting.description'), width: 30 },
        { key: 'debit', header: t('accounting.debit'), width: 15 },
        { key: 'credit', header: t('accounting.credit'), width: 15 },
        { key: 'balance', header: t('accounting.balance'), width: 15 },
      ],
      `AccountLedger_${accountId || 'all'}`,
    );
  };

  const handleExportPDF = () => {
    exportToPDF(
      filteredRows,
      [
        { key: 'date', header: t('accounting.date') },
        { key: 'reference', header: t('accounting.reference') },
        { key: 'description', header: t('accounting.description') },
        { key: 'debit', header: t('accounting.debit') },
        { key: 'credit', header: t('accounting.credit') },
        { key: 'balance', header: t('accounting.balance') },
      ],
      `AccountLedger_${accountId || 'all'}`,
      {
        title: t('accounting.accountLedger'),
        subtitle: `${activeCompany?.name || ''} — ${accountId ? `حساب ${accountId}` : ''}`,
        rtl: true,
      },
    );
  };

  const handlePrint = () => {
    printDocument({
      type: 'ledger',
      docNumber: accountId,
      date: `${startDate || ''} — ${endDate || ''}`,
      partyName: activeCompany?.name || '',
      partyLabel: t('accounting.company'),
      lines: filteredRows.map((r) => ({
        description: `${r.date ? formatDate(r.date) : ''} | ${r.reference || '-'} | ${r.description || '-'}`,
        quantity: 1,
        unitPrice: r.debit || r.credit,
        total: r.debit || r.credit,
      })),
      subtotal: totals.debit,
      vatAmount: totals.credit,
      totalAmount: totals.balance,
      companyName: activeCompany?.name,
      companyTaxNumber: activeCompany?.taxNumber,
      companyAddress: activeCompany?.address,
      companyPhone: activeCompany?.phone,
      companyEmail: activeCompany?.email,
      currency: activeCompany?.currency,
    });
  };

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-primary-600 to-primary-700 flex items-center justify-center shadow-sm">
              <BookOpen size={22} className="text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50 tracking-tight">{t('accounting.accountLedger')}</h1>
              <p className="text-sm text-slate-500 dark:text-slate-400">{t('accounting.ledgerSubtitle')}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 self-start sm:self-auto flex-wrap">
            <Button variant="secondary" size="sm" leftIcon={<Calendar size={14} />} onClick={() => setShowFilters(!showFilters)}>
              {t('filter')}
            </Button>
            <Button variant="secondary" size="sm" leftIcon={<FileDown size={14} />} onClick={handleExportExcel} disabled={!accountId || !filteredRows.length}>
              Excel
            </Button>
            <Button variant="secondary" size="sm" leftIcon={<FileDown size={14} />} onClick={handleExportPDF} disabled={!accountId || !filteredRows.length}>
              PDF
            </Button>
            <Button variant="secondary" size="sm" leftIcon={<Printer size={14} />} onClick={handlePrint} disabled={!accountId || !filteredRows.length}>
              {t('print')}
            </Button>
          </div>
        </div>

        {accountId && filteredRows.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            <Card className="p-4 flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold tracking-wider uppercase text-slate-500">إجمالي مدين</p>
                <p className="text-lg font-bold text-blue-600 dark:text-blue-400 tabular-nums">{formatCurrency(totals.debit)}</p>
              </div>
              <div className="w-10 h-10 rounded-xl bg-blue-50 dark:bg-blue-900/20 flex items-center justify-center">
                <TrendingUp size={16} className="text-blue-600" />
              </div>
            </Card>
            <Card className="p-4 flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold tracking-wider uppercase text-slate-500">إجمالي دائن</p>
                <p className="text-lg font-bold text-rose-600 dark:text-rose-400 tabular-nums">{formatCurrency(totals.credit)}</p>
              </div>
              <div className="w-10 h-10 rounded-xl bg-rose-50 dark:bg-rose-900/20 flex items-center justify-center">
                <TrendingDown size={16} className="text-rose-600" />
              </div>
            </Card>
            <Card className="p-4 flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold tracking-wider uppercase text-slate-500">الرصيد الختامي</p>
                <p className={cn('text-lg font-bold tabular-nums', totals.balance >= 0 ? 'text-blue-700 dark:text-blue-300' : 'text-rose-700 dark:text-rose-300')}>{formatCurrency(totals.balance)}</p>
              </div>
              <div className="w-10 h-10 rounded-xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
                <Wallet size={16} className="text-slate-600" />
              </div>
            </Card>
            <Card className="p-4 flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold tracking-wider uppercase text-slate-500">عدد الحركات</p>
                <p className="text-2xl font-bold text-slate-900 dark:text-slate-50 tabular-nums">{totals.count}</p>
              </div>
              <div className="w-10 h-10 rounded-xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
                <Hash size={16} className="text-slate-600" />
              </div>
            </Card>
          </div>
        )}
      </div>

      <Card className="p-4">
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 items-end">
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1.5">{t('accounting.accountName')}</label>
            <AccountSelect companyId={activeCompany?.id || ''} value={accountId} onChange={(v) => setAccountId(v || '')} />
          </div>
          <Input label={t('accounting.fromDate')} type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          <Input label={t('accounting.toDate')} type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          <div className="flex gap-2">
            <div className="flex gap-1 p-1 rounded-lg bg-slate-100 dark:bg-slate-800">
              {(['month', 'year'] as const).map((p) => (
                <button
                  key={p}
                  onClick={() => {
                    const now = new Date();
                    if (p === 'month') { setStartDate(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`); setEndDate(new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0]); }
                    else { setStartDate(`${now.getFullYear()}-01-01`); setEndDate(`${now.getFullYear()}-12-31`); }
                  }}
                  className="px-3 py-1.5 rounded-md text-xs font-medium bg-white dark:bg-slate-700 shadow-sm border"
                >
                  {p === 'month' ? 'هذا الشهر' : 'هذه السنة'}
                </button>
              ))}
            </div>
            <Button onClick={() => setShowFilters(false)} disabled={!accountId} className="ml-auto">
              {t('accounting.applyFilter')}
            </Button>
          </div>
        </div>
        {accountId && (
          <div className="mt-4 flex gap-2">
            <div className="relative flex-1 max-w-md">
              <Search size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={`${t('search')} — مرجع / بيان`}
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 py-2 pr-9 pl-8 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
              />
              {search && (
                <button onClick={() => setSearch('')} className="absolute left-2 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-center text-slate-400">
                  <X size={12} />
                </button>
              )}
            </div>
            {search && <Badge className="bg-slate-100 dark:bg-slate-800 text-slate-600 border">{filteredRows.length} نتيجة</Badge>}
          </div>
        )}
      </Card>

      <Card noPadding>
        {!accountId ? (
          <div className="py-12">
            <EmptyState icon="search" title="اختر حساباً" description="اختر حساباً من الأعلى لعرض دفتر الأستاذ" />
          </div>
        ) : isLoading ? (
          <div className="space-y-3 p-4">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-12 bg-slate-100 dark:bg-slate-800 rounded-lg animate-pulse" />
            ))}
          </div>
        ) : filteredRows.length === 0 ? (
          <div className="py-10">
            <EmptyState icon={search ? 'search' : 'inbox'} title={search ? 'لا توجد نتائج' : t('accounting.noData')} description={search ? 'جرّب تغيير كلمات البحث' : 'لا توجد حركات في الفترة المحددة'} />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-start">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700">
                  <th className="px-4 py-3 text-xs font-bold tracking-wider uppercase text-slate-500 text-right">{t('accounting.date')}</th>
                  <th className="px-4 py-3 text-xs font-bold tracking-wider uppercase text-slate-500 text-right">{t('accounting.reference')}</th>
                  <th className="px-4 py-3 text-xs font-bold tracking-wider uppercase text-slate-500 text-right">{t('accounting.description')}</th>
                  <th className="px-4 py-3 text-xs font-bold tracking-wider uppercase text-slate-500 text-right">{t('accounting.debit')}</th>
                  <th className="px-4 py-3 text-xs font-bold tracking-wider uppercase text-slate-500 text-right">{t('accounting.credit')}</th>
                  <th className="px-4 py-3 text-xs font-bold tracking-wider uppercase text-slate-500 text-right">{t('accounting.balance')}</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((row) => {
                  const isOpening = row.id === 'OPENING' || row.reference === 'OPENING';
                  return (
                  <tr key={row.id} className={isOpening ? 'bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-700' : 'border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors'}>
                    <td className="px-4 py-3 text-sm tabular-nums text-slate-700 dark:text-slate-300">{row.date ? formatDate(row.date) : '-'}</td>
                    <td className="px-4 py-3 text-sm font-mono text-slate-600 dark:text-slate-400">{isOpening ? '—' : (row.reference || '-')}</td>
                    <td className="px-4 py-3 text-sm text-slate-800 dark:text-slate-200 max-w-[320px] truncate" title={row.description}>
                      {isOpening ? <span className="font-bold text-primary-700 dark:text-primary-300">{row.description}</span> : (row.description || '-')}
                    </td>
                    <td className="px-4 py-3 text-sm text-right tabular-nums">{row.debit > 0 ? <span className="font-medium text-blue-700 dark:text-blue-300">{formatCurrency(row.debit)}</span> : <span className="text-slate-300">—</span>}</td>
                    <td className="px-4 py-3 text-sm text-right tabular-nums">{row.credit > 0 ? <span className="font-medium text-rose-700 dark:text-rose-300">{formatCurrency(row.credit)}</span> : <span className="text-slate-300">—</span>}</td>
                    <td className={cn('px-4 py-3 text-sm text-right tabular-nums font-bold', Number(row.balance) >= 0 ? 'text-blue-600 dark:text-blue-400' : 'text-rose-600 dark:text-rose-400')}>{formatCurrency(row.balance)}</td>
                  </tr>
                  );
                })}
                <tr className="bg-slate-900 dark:bg-slate-800 text-white font-bold">
                  <td className="px-4 py-3 text-sm" colSpan={3}>
                    الإجمالي — {filteredRows.length} حركة
                  </td>
                  <td className="px-4 py-3 text-sm text-right tabular-nums">{formatCurrency(totals.debit)}</td>
                  <td className="px-4 py-3 text-sm text-right tabular-nums">{formatCurrency(totals.credit)}</td>
                  <td className="px-4 py-3 text-sm text-right tabular-nums">{formatCurrency(totals.balance)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
};

export default AccountLedgerPage;
