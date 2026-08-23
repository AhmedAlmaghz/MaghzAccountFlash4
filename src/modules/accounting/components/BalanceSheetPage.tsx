import React, { useState, useEffect, useMemo } from 'react';
import { Scale, FileDown, Calendar, TrendingUp, Building2, Landmark, Wallet, CheckCircle2, AlertTriangle } from 'lucide-react';
import { Card, Button, Input, Badge } from '@/core/ui/components';
import { EmptyState } from '@/core/ui/components/EmptyState';
import { useAppStore } from '@/core/store';
import { useTranslation } from '@/core/i18n/useTranslation';
import { accountingApi } from '../api';
import { exportToExcel, exportToPDF } from '@/core/utils/exportEngine';
import { useFormatters } from '@/core/utils/useFormatters';
import { useAsyncData } from '@/core/hooks/useAsyncData';
import { useSettings } from '@/core/utils/useSettings';
import type { Account } from '../types';
import { cn } from '@/core/utils';

interface BSRow {
  account: string;
  accountId: string;
  amount: number;
  isTotal?: boolean;
}

interface BalanceSheetData {
  assets: BSRow[];
  liabilities: BSRow[];
  equity: BSRow[];
}

const emptyData: BalanceSheetData = { assets: [], liabilities: [], equity: [] };

function defaultToDate(): string {
  const d = new Date();
  return d.toISOString().split('T')[0];
}

function defaultAsOfDate(fiscalYearStart?: string): string {
  if (fiscalYearStart) {
    const fy = new Date(fiscalYearStart);
    if (!isNaN(fy.getTime())) {
      const now = new Date();
      const fyMonth = fy.getMonth();
      const fyDay = fy.getDate();
      const year = now.getMonth() >= fyMonth ? now.getFullYear() : now.getFullYear() - 1;
      return `${year}-${String(fyMonth + 1).padStart(2, '0')}-${String(fyDay).padStart(2, '0')}`;
    }
  }
  return defaultToDate();
}

export const BalanceSheetReport: React.FC = () => {
  const { t } = useTranslation();
  const activeCompany = useAppStore((state) => state.activeCompany);
  const { formatCurrency, formatDate } = useFormatters(activeCompany?.id || '');
  const { settings: appSettings } = useSettings(activeCompany?.id || '');
  const fiscalYearStart = appSettings?.fiscalYearStart;
  const [asOfDate, setAsOfDate] = useState('');
  const [showFilters, setShowFilters] = useState(false);

  useEffect(() => {
    if (activeCompany?.id && !asOfDate) {
      setAsOfDate(defaultAsOfDate(fiscalYearStart));
    }
  }, [activeCompany?.id, asOfDate, fiscalYearStart]);

  const { data: bsData, isLoading } = useAsyncData<BalanceSheetData>(
    async () => {
      const companyId = activeCompany!.id;
      const result = await accountingApi.getBalanceSheet(companyId, asOfDate || undefined);
      if (!result.success || !result.data) return emptyData;
      const accounts = result.data as Account[];
      const buildRows = (accs: Account[]): BSRow[] => {
        const rows: BSRow[] = [];
        let total = 0;
        for (const acc of accs) {
          if (Math.abs(acc.balance) > 0) {
            rows.push({ account: acc.nameAr, accountId: acc.id, amount: Math.abs(acc.balance) });
            total += Math.abs(acc.balance);
          }
        }
        if (total > 0) rows.push({ account: t('accounting.balanceSheet.total'), accountId: '', amount: total, isTotal: true });
        return rows;
      };
      return {
        assets: buildRows(accounts.filter((a) => a.type === 'asset')),
        liabilities: buildRows(accounts.filter((a) => a.type === 'liability')),
        equity: buildRows(accounts.filter((a) => a.type === 'equity')),
      };
    },
    [activeCompany?.id, asOfDate],
    !!activeCompany?.id,
  );

  const { assets, liabilities, equity } = bsData ?? emptyData;
  const totals = useMemo(() => {
    const a = assets.filter((r) => !r.isTotal).reduce((s, r) => s + r.amount, 0);
    const l = liabilities.filter((r) => !r.isTotal).reduce((s, r) => s + r.amount, 0);
    const e = equity.filter((r) => !r.isTotal).reduce((s, r) => s + r.amount, 0);
    const le = l + e;
    const diff = a - le;
    const balanced = Math.abs(diff) < 0.01;
    return { a, l, e, le, diff, balanced };
  }, [assets, liabilities, equity]);

  const allRows = [...assets, ...liabilities, ...equity];

  const handleExportExcel = () => {
    exportToExcel(
      allRows.filter((r) => !r.isTotal).map((r) => ({ item: r.account, amount: r.amount })),
      [
        { key: 'item', header: t('accounting.profitLoss.item'), width: 40 },
        { key: 'amount', header: t('accounting.amount'), width: 18 },
      ],
      `BalanceSheet_${asOfDate}`,
    );
  };

  const handleExportPDF = () => {
    exportToPDF(
      allRows.filter((r) => !r.isTotal).map((r) => ({ item: r.account, amount: r.amount })),
      [
        { key: 'item', header: t('accounting.profitLoss.item') },
        { key: 'amount', header: t('accounting.amount') },
      ],
      `BalanceSheet_${asOfDate}`,
      {
        title: t('accounting.balanceSheet.title'),
        subtitle: `${activeCompany?.name || ''} — ${asOfDate ? formatDate(asOfDate) : ''}`,
        rtl: true,
      },
    );
  };

  const renderRows = (rows: BSRow[]) => {
    if (!rows.length) return <div className="py-8"><EmptyState icon="inbox" title={t('accounting.noData')} description="لا توجد أرصدة في هذا البند" /></div>;
    return (
      <div className="divide-y divide-slate-100 dark:divide-slate-800">
        {rows.map((row, idx) => {
          if (row.isTotal) {
            return (
              <div key={idx} className="flex justify-between py-2.5 px-3 font-bold bg-slate-50 dark:bg-slate-800 border-t border-slate-200 dark:border-slate-700">
                <span>{row.account}</span>
                <span className="tabular-nums">{formatCurrency(row.amount)}</span>
              </div>
            );
          }
          return (
            <a
              key={idx}
              href={`/accounting/ledger?accountId=${row.accountId}`}
              className="flex justify-between py-2 px-3 text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/50 rounded transition-colors group"
            >
              <span className="truncate pr-2">{row.account}</span>
              <span className="tabular-nums font-medium shrink-0">{formatCurrency(row.amount)}</span>
            </a>
          );
        })}
      </div>
    );
  };

  if (isLoading) {
    return (
      <div className="space-y-4 p-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-32 bg-slate-100 dark:bg-slate-800 rounded-xl animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-primary-600 to-primary-700 flex items-center justify-center shadow-sm">
              <Scale size={22} className="text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50 tracking-tight">{t('accounting.balanceSheet.title')}</h1>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                {asOfDate ? `${t('accounting.date')}: ${formatDate(asOfDate)}` : `${t('accounting.date')}: ${t('accounting.balanceSheet.today')}`} • المعادلة: الأصول = الالتزامات + حقوق الملكية
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
              <p className="text-xs font-semibold tracking-wider uppercase text-slate-500">{t('accounting.balanceSheet.assets')}</p>
              <p className="text-xl font-bold text-emerald-600 dark:text-emerald-400 tabular-nums">{formatCurrency(totals.a)}</p>
              <p className="text-xs text-slate-500">{assets.filter((r) => !r.isTotal).length} حساب</p>
            </div>
            <div className="w-10 h-10 rounded-xl bg-emerald-50 dark:bg-emerald-900/20 flex items-center justify-center">
              <Wallet size={18} className="text-emerald-600" />
            </div>
          </Card>
          <Card className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold tracking-wider uppercase text-slate-500">الالتزامات + حقوق الملكية</p>
              <p className="text-xl font-bold text-blue-600 dark:text-blue-400 tabular-nums">{formatCurrency(totals.le)}</p>
              <p className="text-xs text-slate-500">
                {formatCurrency(totals.l)} + {formatCurrency(totals.e)}
              </p>
            </div>
            <div className="w-10 h-10 rounded-xl bg-blue-50 dark:bg-blue-900/20 flex items-center justify-center">
              <Building2 size={18} className="text-blue-600" />
            </div>
          </Card>
          <Card className={cn('p-4 flex items-center justify-between border', totals.balanced ? 'bg-emerald-50/50 dark:bg-emerald-900/10 border-emerald-200 dark:border-emerald-800' : 'bg-amber-50/50 dark:bg-amber-900/10 border-amber-200 dark:border-amber-800')}>
            <div>
              <p className="text-xs font-semibold tracking-wider uppercase text-slate-500 flex items-center gap-1">
                {totals.balanced ? <CheckCircle2 size={12} className="text-emerald-600" /> : <AlertTriangle size={12} className="text-amber-600" />}
                حالة الميزانية
              </p>
              <p className={cn('text-lg font-bold tabular-nums', totals.balanced ? 'text-emerald-700 dark:text-emerald-300' : 'text-amber-700 dark:text-amber-300')}>{totals.balanced ? 'متوازنة ✓' : `فرق ${formatCurrency(totals.diff)}`}</p>
              <p className="text-xs text-slate-500">{totals.balanced ? 'الأصول = الالتزامات + حقوق الملكية' : 'تحتاج مراجعة قيود'}</p>
            </div>
            <Badge className={cn('border', totals.balanced ? 'bg-emerald-100 text-emerald-700 border-emerald-200' : 'bg-amber-100 text-amber-700 border-amber-200')}>{totals.balanced ? 'متوازنة' : 'غير متوازنة'}</Badge>
          </Card>
        </div>
      </div>

      {showFilters && (
        <Card className="p-4">
          <div className="flex flex-wrap items-end gap-3">
            <Input label={t('accounting.toDate')} type="date" value={asOfDate} onChange={(e) => setAsOfDate(e.target.value)} className="min-w-[180px]" />
            <div className="flex gap-1 p-1 rounded-lg bg-slate-100 dark:bg-slate-800">
              {(['today', 'month', 'year'] as const).map((p) => (
                <button
                  key={p}
                  onClick={() => {
                    if (p === 'today') setAsOfDate(defaultToDate());
                    else if (p === 'month') {
                      const d = new Date();
                      setAsOfDate(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()).padStart(2, '0')}`);
                    } else setAsOfDate(`${new Date().getFullYear()}-12-31`);
                  }}
                  className="px-3 py-1.5 rounded-md text-xs font-medium bg-white dark:bg-slate-700 shadow-sm border"
                >
                  {p === 'today' ? 'اليوم' : p === 'month' ? 'آخر الشهر' : 'آخر السنة'}
                </button>
              ))}
            </div>
            <Button variant="secondary" onClick={() => setAsOfDate('')}>
              {t('cancel')}
            </Button>
            <Button onClick={() => setShowFilters(false)}>{t('accounting.applyFilter')}</Button>
          </div>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Card noPadding>
          <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between bg-emerald-50/50 dark:bg-emerald-900/10">
            <h3 className="font-bold text-emerald-700 dark:text-emerald-300 flex items-center gap-2">
              <TrendingUp size={16} /> {t('accounting.balanceSheet.assets')}
            </h3>
            <span className="text-sm font-bold tabular-nums text-emerald-700 dark:text-emerald-300">{formatCurrency(totals.a)}</span>
          </div>
          {renderRows(assets)}
        </Card>

        <div className="space-y-5">
          <Card noPadding>
            <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between bg-amber-50/50 dark:bg-amber-900/10">
              <h3 className="font-bold text-amber-700 dark:text-amber-300 flex items-center gap-2">
                <Landmark size={16} /> {t('accounting.balanceSheet.liabilities')}
              </h3>
              <span className="text-sm font-bold tabular-nums text-amber-700 dark:text-amber-300">{formatCurrency(totals.l)}</span>
            </div>
            {renderRows(liabilities)}
          </Card>
          <Card noPadding>
            <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between bg-blue-50/50 dark:bg-blue-900/10">
              <h3 className="font-bold text-blue-700 dark:text-blue-300 flex items-center gap-2">
                <Building2 size={16} /> {t('accounting.balanceSheet.equity')}
              </h3>
              <span className="text-sm font-bold tabular-nums text-blue-700 dark:text-blue-300">{formatCurrency(totals.e)}</span>
            </div>
            {renderRows(equity)}
          </Card>
          <Card className="p-4 bg-slate-900 dark:bg-slate-800 text-white">
            <div className="flex justify-between items-center">
              <span className="font-bold">المجموع (التزامات + حقوق ملكية)</span>
              <span className="font-bold tabular-nums text-lg">{formatCurrency(totals.le)}</span>
            </div>
            <div className="mt-2 h-px bg-white/10" />
            <div className="mt-2 flex justify-between text-sm text-slate-300">
              <span>المقارنة بالأصول</span>
              <span className={cn('font-mono', totals.balanced ? 'text-emerald-400' : 'text-amber-400')}>{totals.balanced ? 'متوازنة' : `فرق ${formatCurrency(totals.diff)}`}</span>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
};

export default BalanceSheetReport;
