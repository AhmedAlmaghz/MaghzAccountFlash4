import React, { useState, useEffect, useMemo } from 'react';
import { useTranslation } from '@/core/i18n/useTranslation';
import { useAppStore } from '@/core/store';
import { useFormatters } from '@/core/utils/useFormatters';
import { useAsyncData } from '@/core/hooks/useAsyncData';
import { accountingApi } from '../api';
import { exportToExcel, exportToPDF } from '@/core/utils/exportEngine';
import { Card, Input, Button, Badge } from '@/core/ui/components';
import { EmptyState } from '@/core/ui/components/EmptyState';
import { BarChart3, FileDown, Calendar, TrendingUp, TrendingDown, Wallet, Percent, ArrowUpRight, ArrowDownRight } from 'lucide-react';
import { useSettings } from '@/core/utils/useSettings';
import type { Account } from '../types';
import { cn } from '@/core/utils';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';

interface PnLRow {
  section: 'header' | 'revenue' | 'expense' | 'net';
  account: string;
  accountId: string;
  amount: number;
  isHeader?: boolean;
  isTotal?: boolean;
}

function defaultFromDate(fiscalYearStart?: string): string {
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
  const d = new Date();
  return `${d.getFullYear()}-01-01`;
}

function defaultToDate(): string {
  const d = new Date();
  return d.toISOString().split('T')[0];
}

export const ProfitLossReport: React.FC = () => {
  const { t } = useTranslation();
  const activeCompany = useAppStore((state) => state.activeCompany);
  const { formatCurrency, formatDate } = useFormatters(activeCompany?.id || '');
  const { settings: appSettings } = useSettings(activeCompany?.id || '');
  const fiscalYearStart = appSettings?.fiscalYearStart;
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [showFilters, setShowFilters] = useState(false);

  useEffect(() => {
    if (activeCompany?.id && !startDate && !endDate) {
      setStartDate(defaultFromDate(fiscalYearStart));
      setEndDate(defaultToDate());
    }
  }, [activeCompany?.id, startDate, endDate, fiscalYearStart]);

  const { data: pnlDataResult, isLoading } = useAsyncData<PnLRow[]>(
    async () => {
      const companyId = activeCompany!.id;
      const result = await accountingApi.getProfitLoss(companyId, startDate || undefined, endDate || undefined);
      if (!result.success || !result.data) return [];
      const accounts = result.data as Account[];
      const rows: PnLRow[] = [];
      const revenues = accounts.filter((a) => a.type === 'revenue');
      if (revenues.length > 0) {
        rows.push({ section: 'header', account: t('accounting.profitLoss.revenue'), accountId: '', amount: 0, isHeader: true });
        let totalRev = 0;
        for (const acc of revenues) {
          const amt = Math.abs(acc.balance);
          rows.push({ section: 'revenue', account: acc.nameAr, accountId: acc.id, amount: amt });
          totalRev += amt;
        }
        rows.push({ section: 'revenue', account: t('accounting.profitLoss.totalRevenue'), accountId: '', amount: totalRev, isTotal: true });
      }
      const expenses = accounts.filter((a) => a.type === 'expense');
      if (expenses.length > 0) {
        rows.push({ section: 'header', account: t('accounting.profitLoss.expenses'), accountId: '', amount: 0, isHeader: true });
        let totalExp = 0;
        for (const acc of expenses) {
          const amt = Math.abs(acc.balance);
          rows.push({ section: 'expense', account: acc.nameAr, accountId: acc.id, amount: amt });
          totalExp += amt;
        }
        rows.push({ section: 'expense', account: t('accounting.profitLoss.totalExpenses'), accountId: '', amount: totalExp, isTotal: true });
      }
      const totalRevenue = revenues.reduce((s, a) => s + Math.abs(a.balance), 0);
      const totalExpense = expenses.reduce((s, a) => s + Math.abs(a.balance), 0);
      const netProfit = totalRevenue - totalExpense;
      rows.push({ section: 'net', account: t('accounting.profitLoss.netProfit'), accountId: '', amount: netProfit, isTotal: true });
      return rows;
    },
    [activeCompany?.id, startDate, endDate],
    !!activeCompany?.id,
  );

  const summary = useMemo(() => {
    const data = pnlDataResult ?? [];
    const revTotal = data.find((r) => r.section === 'revenue' && r.isTotal)?.amount || 0;
    const expTotal = data.find((r) => r.section === 'expense' && r.isTotal)?.amount || 0;
    const net = data.find((r) => r.section === 'net')?.amount || 0;
    const margin = revTotal ? (net / revTotal) * 100 : 0;
    const isProfit = net >= 0;
    return { revTotal, expTotal, net, margin, isProfit };
  }, [pnlDataResult]);

  const chartData = useMemo(
    () => [
      { name: t('accounting.profitLoss.revenue'), value: summary.revTotal, color: '#10b981' },
      { name: t('accounting.profitLoss.expenses'), value: summary.expTotal, color: '#f43f5e' },
      { name: t('accounting.profitLoss.netProfit'), value: Math.abs(summary.net), color: summary.isProfit ? '#0ea5e9' : '#f59e0b' },
    ],
    [summary, t],
  );

  const handleExportExcel = () => {
    const pnlData = pnlDataResult ?? [];
    exportToExcel(
      pnlData.map((r) => ({ item: r.account, amount: r.amount })),
      [
        { key: 'item', header: t('accounting.profitLoss.item'), width: 40 },
        { key: 'amount', header: t('accounting.amount'), width: 18 },
      ],
      `ProfitLoss_${startDate}_${endDate}`,
    );
  };

  const handleExportPDF = () => {
    const pnlData = pnlDataResult ?? [];
    exportToPDF(
      pnlData.map((r) => ({ item: r.account, amount: r.amount })),
      [
        { key: 'item', header: t('accounting.profitLoss.item') },
        { key: 'amount', header: t('accounting.amount') },
      ],
      `ProfitLoss_${startDate}_${endDate}`,
      {
        title: t('accounting.profitLoss.title'),
        subtitle: `${activeCompany?.name || ''} — ${startDate ? formatDate(startDate) : ''} → ${endDate ? formatDate(endDate) : ''}`,
        rtl: true,
      },
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
              <BarChart3 size={22} className="text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50 tracking-tight">{t('accounting.profitLoss.title')}</h1>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                {startDate && endDate ? `${t('accounting.period')}: ${formatDate(startDate)} — ${formatDate(endDate)}` : `${t('accounting.period')}: ${t('accounting.all')}`}
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
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <Card className="p-4">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs font-semibold tracking-wider uppercase text-slate-500">{t('accounting.profitLoss.revenue')}</p>
                <p className="text-xl font-bold text-emerald-600 dark:text-emerald-400 tabular-nums mt-1">{formatCurrency(summary.revTotal)}</p>
              </div>
              <div className="w-10 h-10 rounded-xl bg-emerald-50 dark:bg-emerald-900/20 flex items-center justify-center">
                <TrendingUp size={18} className="text-emerald-600" />
              </div>
            </div>
            <Badge className="mt-3 bg-emerald-50 text-emerald-700 border-emerald-200 border">إيراد</Badge>
          </Card>
          <Card className="p-4">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs font-semibold tracking-wider uppercase text-slate-500">{t('accounting.profitLoss.expenses')}</p>
                <p className="text-xl font-bold text-rose-600 dark:text-rose-400 tabular-nums mt-1">{formatCurrency(summary.expTotal)}</p>
              </div>
              <div className="w-10 h-10 rounded-xl bg-rose-50 dark:bg-rose-900/20 flex items-center justify-center">
                <TrendingDown size={18} className="text-rose-600" />
              </div>
            </div>
            <Badge className="mt-3 bg-rose-50 text-rose-700 border-rose-200 border">مصروف</Badge>
          </Card>
          <Card className={cn('p-4 border', summary.isProfit ? 'bg-emerald-50/30 dark:bg-emerald-900/10 border-emerald-200 dark:border-emerald-800' : 'bg-amber-50/30 dark:bg-amber-900/10 border-amber-200 dark:border-amber-800')}>
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs font-semibold tracking-wider uppercase text-slate-500 flex items-center gap-1">
                  {summary.isProfit ? <ArrowUpRight size={12} className="text-emerald-600" /> : <ArrowDownRight size={12} className="text-amber-600" />}
                  {t('accounting.profitLoss.netProfit')}
                </p>
                <p className={cn('text-xl font-bold tabular-nums mt-1', summary.isProfit ? 'text-emerald-700 dark:text-emerald-300' : 'text-amber-700 dark:text-amber-300')}>{formatCurrency(summary.net)}</p>
              </div>
              <div className={cn('w-10 h-10 rounded-xl flex items-center justify-center', summary.isProfit ? 'bg-emerald-100 dark:bg-emerald-900/30' : 'bg-amber-100 dark:bg-amber-900/30')}>
                <Wallet size={18} className={summary.isProfit ? 'text-emerald-600' : 'text-amber-600'} />
              </div>
            </div>
            <p className="text-xs mt-2 flex items-center gap-1 text-slate-500">{summary.isProfit ? 'ربح' : 'خسارة'} • هامش {summary.margin.toFixed(1)}%</p>
          </Card>
          <Card className="p-4">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs font-semibold tracking-wider uppercase text-slate-500">هامش الربح</p>
                <p className="text-xl font-bold text-slate-900 dark:text-slate-100 tabular-nums mt-1">{summary.margin.toFixed(1)}%</p>
              </div>
              <div className="w-10 h-10 rounded-xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
                <Percent size={18} className="text-slate-600" />
              </div>
            </div>
            <div className="mt-3 h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
              <div className={cn('h-full rounded-full transition-all', summary.isProfit ? 'bg-emerald-500' : 'bg-amber-500')} style={{ width: `${Math.min(100, Math.max(0, summary.margin))}%` }} />
            </div>
          </Card>
        </div>
      </div>

      {showFilters && (
        <Card className="p-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
            <Input label={t('accounting.fromDate')} type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            <Input label={t('accounting.toDate')} type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            <div className="flex gap-1 p-1 rounded-lg bg-slate-100 dark:bg-slate-800 w-fit">
              {(['month', 'quarter', 'year'] as const).map((p) => (
                <button
                  key={p}
                  onClick={() => {
                    const now = new Date();
                    if (p === 'month') {
                      setStartDate(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`);
                      setEndDate(defaultToDate());
                    } else if (p === 'quarter') {
                      const q = Math.floor(now.getMonth() / 3) * 3;
                      setStartDate(`${now.getFullYear()}-${String(q + 1).padStart(2, '0')}-01`);
                      setEndDate(defaultToDate());
                    } else {
                      setStartDate(`${now.getFullYear()}-01-01`);
                      setEndDate(defaultToDate());
                    }
                  }}
                  className="px-3 py-1.5 rounded-md text-xs font-medium bg-white dark:bg-slate-700 shadow-sm border"
                >
                  {p === 'month' ? 'هذا الشهر' : p === 'quarter' ? 'هذا الربع' : 'هذه السنة'}
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => { setStartDate(''); setEndDate(''); }}>
                {t('cancel')}
              </Button>
              <Button onClick={() => setShowFilters(false)}>{t('accounting.applyFilter')}</Button>
            </div>
          </div>
        </Card>
      )}

      {/* Chart */}
      <Card className="p-4">
        <h3 className="font-semibold text-slate-900 dark:text-slate-100 mb-4 flex items-center gap-2">
          <BarChart3 size={16} /> ملخص مرئي
        </h3>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} layout="vertical" margin={{ left: 20, right: 20 }}>
              <XAxis type="number" hide />
              <YAxis type="category" dataKey="name" width={100} tick={{ fontSize: 12 }} />
              <Tooltip formatter={(value: unknown) => formatCurrency(Number(value as number) || 0) as unknown as string} />
              <Bar dataKey="value" radius={[0, 8, 8, 0]} barSize={26}>
                {chartData.map((entry, idx) => (
                  <Cell key={idx} fill={entry.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <Card noPadding>
        <div className="divide-y divide-slate-100 dark:divide-slate-800">
          {(pnlDataResult ?? []).length === 0 ? (
            <div className="py-10">
              <EmptyState icon="inbox" title={t('accounting.noData')} description="لا توجد إيرادات أو مصروفات في الفترة المحددة" />
            </div>
          ) : (
            (pnlDataResult ?? []).map((row, idx) => {
              if (row.isHeader) {
                return (
                  <div key={idx} className="px-4 py-3 bg-slate-50 dark:bg-slate-800/50 text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                    <div className={cn('w-1 h-4 rounded-full', row.section === 'revenue' ? 'bg-emerald-500' : 'bg-rose-500')} />
                    {row.account}
                  </div>
                );
              }
              if (row.isTotal && row.section === 'net') {
                return (
                  <div
                    key={idx}
                    className={cn(
                      'flex justify-between py-4 px-4 font-bold text-white rounded-lg mx-2 my-2',
                      summary.isProfit ? 'bg-gradient-to-r from-emerald-600 to-emerald-700' : 'bg-gradient-to-r from-amber-600 to-orange-600',
                    )}
                  >
                    <span className="flex items-center gap-2">{summary.isProfit ? <TrendingUp size={16} /> : <TrendingDown size={16} />} {row.account}</span>
                    <span className="tabular-nums text-lg">{formatCurrency(row.amount)}</span>
                  </div>
                );
              }
              if (row.isTotal) {
                return (
                  <div key={idx} className="flex justify-between py-2.5 px-4 bg-slate-50 dark:bg-slate-800/50 font-semibold border-t border-slate-200 dark:border-slate-700">
                    <span>{row.account}</span>
                    <span className="tabular-nums">{formatCurrency(row.amount)}</span>
                  </div>
                );
              }
              return (
                <a
                  key={idx}
                  href={`/accounting/ledger?accountId=${row.accountId}`}
                  className="flex justify-between py-2.5 px-4 text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors group"
                >
                  <span className="truncate pr-4 group-hover:text-primary-600">{row.account}</span>
                  <span className="tabular-nums font-medium shrink-0">{formatCurrency(row.amount)}</span>
                </a>
              );
            })
          )}
        </div>
      </Card>
    </div>
  );
};

export default ProfitLossReport;
