import React, { useState, useMemo } from 'react';
import { Scale, FileDown, Calendar, ChevronLeft, Search, X, CheckCircle2, AlertTriangle, Wallet, TrendingUp } from 'lucide-react';
import { Card, Button, Input, Badge } from '@/core/ui/components';
import { EmptyState } from '@/core/ui/components/EmptyState';
import { useTrialBalance } from '../hooks/useAccounting';
import { useAppStore } from '@/core/store';
import { useTranslation } from '@/core/i18n/useTranslation';
import { exportToExcel, exportToPDF } from '@/core/utils/exportEngine';
import { useFormatters } from '@/core/utils/useFormatters';
import { cn } from '@/core/utils';

export const TrialBalancePage: React.FC = () => {
  const { t } = useTranslation();
  const activeCompany = useAppStore((state) => state.activeCompany);
  const { formatCurrency, formatDate } = useFormatters(activeCompany?.id || '');
  const [asOfDate, setAsOfDate] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [search, setSearch] = useState('');
  const { rows, isLoading } = useTrialBalance(activeCompany?.id || '', asOfDate || undefined);

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => (r.accountCode?.toLowerCase() || '').includes(q) || (r.accountName?.toLowerCase() || '').includes(q));
  }, [rows, search]);

  const totalDebit = useMemo(() => filteredRows.reduce((s, r) => s + (Number(r.debit) || 0), 0), [filteredRows]);
  const totalCredit = useMemo(() => filteredRows.reduce((s, r) => s + (Number(r.credit) || 0), 0), [filteredRows]);
  const totalBalance = useMemo(() => filteredRows.reduce((s, r) => s + (Number(r.balance) || 0), 0), [filteredRows]);
  const diff = totalDebit - totalCredit;
  const isBalanced = Math.abs(diff) < 0.01;
  const hasFilters = !!asOfDate || !!search;

  const handleExportExcel = () => {
    exportToExcel(
      filteredRows,
      [
        { key: 'accountCode', header: t('accounting.accountCode'), width: 12 },
        { key: 'accountName', header: t('accounting.accountName'), width: 30 },
        { key: 'debit', header: t('accounting.debit'), width: 15 },
        { key: 'credit', header: t('accounting.credit'), width: 15 },
        { key: 'balance', header: t('accounting.balance'), width: 15 },
      ],
      `TrialBalance_${asOfDate || 'all'}`,
    );
  };

  const handleExportPDF = () => {
    exportToPDF(
      filteredRows,
      [
        { key: 'accountCode', header: t('accounting.accountCode') },
        { key: 'accountName', header: t('accounting.accountName') },
        { key: 'debit', header: t('accounting.debit') },
        { key: 'credit', header: t('accounting.credit') },
        { key: 'balance', header: t('accounting.balance') },
      ],
      `TrialBalance_${asOfDate || 'all'}`,
      {
        title: t('accounting.trialBalance'),
        subtitle: `${activeCompany?.name || ''} — ${asOfDate ? formatDate(asOfDate) : t('accounting.all')}`,
        rtl: true,
      },
    );
  };

  const preset = (range: 'today' | 'month' | 'year' | 'all') => {
    if (range === 'all') setAsOfDate('');
    else if (range === 'today') setAsOfDate(new Date().toISOString().split('T')[0]);
    else if (range === 'month') {
      const d = new Date();
      setAsOfDate(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()).padStart(2, '0')}`);
    } else if (range === 'year') setAsOfDate(`${new Date().getFullYear()}-12-31`);
  };

  if (isLoading) {
    return (
      <div className="space-y-4 p-4">
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <div key={i} className="h-14 bg-slate-100 dark:bg-slate-800 rounded-xl animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col gap-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-primary-600 to-primary-700 flex items-center justify-center shadow-sm">
              <Scale size={22} className="text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50 tracking-tight">{t('accounting.trialBalance')}</h1>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                {asOfDate ? `${t('accounting.toDate')}: ${formatDate(asOfDate)}` : t('accounting.all')} • {filteredRows.length} حساب
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 self-start sm:self-auto flex-wrap">
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

        {/* KPI */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Card className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold tracking-wider uppercase text-slate-500">إجمالي مدين</p>
              <p className="text-xl font-bold text-blue-600 dark:text-blue-400 tabular-nums">{formatCurrency(totalDebit)}</p>
            </div>
            <div className="w-10 h-10 rounded-xl bg-blue-50 dark:bg-blue-900/20 flex items-center justify-center">
              <TrendingUp size={18} className="text-blue-600" />
            </div>
          </Card>
          <Card className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold tracking-wider uppercase text-slate-500">إجمالي دائن</p>
              <p className="text-xl font-bold text-rose-600 dark:text-rose-400 tabular-nums">{formatCurrency(totalCredit)}</p>
            </div>
            <div className="w-10 h-10 rounded-xl bg-rose-50 dark:bg-rose-900/20 flex items-center justify-center">
              <Wallet size={18} className="text-rose-600" />
            </div>
          </Card>
          <Card className={cn('p-4 flex items-center justify-between border', isBalanced ? 'bg-emerald-50/50 dark:bg-emerald-900/10 border-emerald-200 dark:border-emerald-800' : 'bg-amber-50/50 dark:bg-amber-900/10 border-amber-200 dark:border-amber-800')}>
            <div>
              <p className="text-xs font-semibold tracking-wider uppercase text-slate-500 flex items-center gap-1">
                {isBalanced ? <CheckCircle2 size={12} className="text-emerald-600" /> : <AlertTriangle size={12} className="text-amber-600" />}
                {isBalanced ? 'متوازن' : 'فرق'}
              </p>
              <p className={cn('text-xl font-bold tabular-nums', isBalanced ? 'text-emerald-700 dark:text-emerald-300' : 'text-amber-700 dark:text-amber-300')}>{formatCurrency(diff)}</p>
              <p className="text-xs text-slate-500">{isBalanced ? 'المدين = الدائن' : 'يحتاج مراجعة'}</p>
            </div>
            <Badge className={cn('text-xs border', isBalanced ? 'bg-emerald-100 text-emerald-700 border-emerald-200' : 'bg-amber-100 text-amber-700 border-amber-200')}>{isBalanced ? 'متوازن ✓' : 'غير متوازن'}</Badge>
          </Card>
        </div>

        {/* Toolbar */}
        <Card className="p-3 sm:p-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={`${t('search')} — كود / اسم الحساب`}
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 py-2.5 pr-10 pl-9 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
              />
              {search && (
                <button onClick={() => setSearch('')} className="absolute left-2 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-center text-slate-400">
                  <X size={14} />
                </button>
              )}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-500 hidden sm:block">{filteredRows.length} من {rows.length}</span>
              {hasFilters && (
                <Button size="sm" variant="ghost" onClick={() => { setAsOfDate(''); setSearch(''); }}>
                  مسح الفلترة
                </Button>
              )}
            </div>
          </div>
        </Card>
      </div>

      {showFilters && (
        <Card className="p-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex gap-1 p-1 rounded-lg bg-slate-100 dark:bg-slate-800">
              {(['all', 'today', 'month', 'year'] as const).map((r) => (
                <button
                  key={r}
                  onClick={() => preset(r)}
                  className="px-3 py-1.5 rounded-md text-xs font-medium bg-white dark:bg-slate-700 shadow-sm border border-slate-200 dark:border-slate-600 hover:bg-slate-50"
                >
                  {r === 'all' ? t('accounting.all') : r === 'today' ? 'اليوم' : r === 'month' ? 'آخر الشهر' : 'آخر السنة'}
                </button>
              ))}
            </div>
            <Input label={t('accounting.toDate')} type="date" value={asOfDate} onChange={(e) => setAsOfDate(e.target.value)} className="min-w-[180px]" />
            <Button variant="secondary" onClick={() => setAsOfDate('')}>
              {t('cancel')}
            </Button>
            <Button onClick={() => setShowFilters(false)}>{t('accounting.applyFilter')}</Button>
          </div>
        </Card>
      )}

      <Card noPadding>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-start">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700">
                <th className="px-4 py-3 text-xs font-bold tracking-wider uppercase text-slate-500 text-right">{t('accounting.accountCode')}</th>
                <th className="px-4 py-3 text-xs font-bold tracking-wider uppercase text-slate-500 text-right">{t('accounting.accountName')}</th>
                <th className="px-4 py-3 text-xs font-bold tracking-wider uppercase text-slate-500 text-right">{t('accounting.debit')}</th>
                <th className="px-4 py-3 text-xs font-bold tracking-wider uppercase text-slate-500 text-right">{t('accounting.credit')}</th>
                <th className="px-4 py-3 text-xs font-bold tracking-wider uppercase text-slate-500 text-right">{t('accounting.balance')}</th>
                <th className="px-4 py-3 text-xs font-bold tracking-wider uppercase text-slate-500 text-right"></th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((row, idx) => (
                <tr key={row.accountId || idx} className="border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors group">
                  <td className="px-4 py-3 text-sm font-mono font-semibold text-slate-600 dark:text-slate-300">
                    <span className="bg-slate-100 dark:bg-slate-800 px-2 py-1 rounded border border-slate-200 dark:border-slate-700">{row.accountCode}</span>
                  </td>
                  <td className="px-4 py-3 text-sm font-medium text-slate-900 dark:text-slate-100">{row.accountName}</td>
                  <td className="px-4 py-3 text-sm text-right tabular-nums">
                    {Number(row.debit) ? <span className="font-medium text-blue-700 dark:text-blue-300">{formatCurrency(row.debit)}</span> : <span className="text-slate-300">—</span>}
                  </td>
                  <td className="px-4 py-3 text-sm text-right tabular-nums">
                    {Number(row.credit) ? <span className="font-medium text-rose-700 dark:text-rose-300">{formatCurrency(row.credit)}</span> : <span className="text-slate-300">—</span>}
                  </td>
                  <td className={cn('px-4 py-3 text-sm text-right tabular-nums font-bold', Number(row.balance) >= 0 ? 'text-blue-600 dark:text-blue-400' : 'text-rose-600 dark:text-rose-400')}>
                    {formatCurrency(row.balance)}
                  </td>
                  <td className="px-4 py-3 text-sm">
                    <a href={`/accounting/ledger?accountId=${row.accountId}`} className="inline-flex items-center gap-1 text-primary-600 hover:text-primary-700 text-xs font-medium opacity-0 group-hover:opacity-100 transition">
                      <ChevronLeft size={13} />
                      {t('accounting.drillDown')}
                    </a>
                  </td>
                </tr>
              ))}
              {filteredRows.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-10">
                    <EmptyState icon={hasFilters ? 'search' : 'inbox'} title={hasFilters ? 'لا توجد نتائج' : t('accounting.noData')} description={hasFilters ? 'جرّب تغيير البحث أو التاريخ' : t('accounting.noData')} />
                  </td>
                </tr>
              )}
              {filteredRows.length > 0 && (
                <tr className="bg-slate-900 dark:bg-slate-800 text-white font-bold">
                  <td className="px-4 py-3 text-sm" colSpan={2}>
                    الإجمالي {hasFilters ? '(مُفلتر)' : ''} — {filteredRows.length} حساب
                  </td>
                  <td className="px-4 py-3 text-sm text-right tabular-nums">{formatCurrency(totalDebit)}</td>
                  <td className="px-4 py-3 text-sm text-right tabular-nums">{formatCurrency(totalCredit)}</td>
                  <td className={cn('px-4 py-3 text-sm text-right tabular-nums', Math.abs(totalBalance) < 0.01 ? 'text-emerald-300' : 'text-amber-300')}>{formatCurrency(totalBalance)}</td>
                  <td />
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
};

export default TrialBalancePage;
