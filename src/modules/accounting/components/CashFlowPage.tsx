import React, { useState, useEffect, useMemo } from 'react';
import { Banknote, FileDown, Calendar, TrendingUp, Building2, Wallet, ArrowUpCircle, ArrowDownCircle, Activity } from 'lucide-react';
import { Card, Button, Input, Badge } from '@/core/ui/components';
import { EmptyState } from '@/core/ui/components/EmptyState';
import { useAppStore } from '@/core/store';
import { useTranslation } from '@/core/i18n/useTranslation';
import { accountingApi } from '../api';
import { salesApi } from '@/modules/sales/api';
import { purchasesApi } from '@/modules/purchases/api';
import { exportToExcel } from '@/core/utils/exportEngine';
import { exportToPdf } from '@/core/utils/export';
import type { Account } from '../types';
import { useFormatters } from '@/core/utils/useFormatters';
import { useAsyncData } from '@/core/hooks/useAsyncData';
import { useSettings } from '@/core/utils/useSettings';
import { cn } from '@/core/utils';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from 'recharts';

interface CFRow {
  activity: string;
  amount: number;
  isTotal?: boolean;
}

interface CashFlowData {
  operating: CFRow[];
  investing: CFRow[];
  financing: CFRow[];
  netChange: number;
}

const emptyData: CashFlowData = { operating: [], investing: [], financing: [], netChange: 0 };

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

const COLORS = ['#10b981', '#3b82f6', '#8b5cf6', '#f59e0b', '#ef4444'];

export const CashFlowReport: React.FC = () => {
  const { t } = useTranslation();
  const activeCompany = useAppStore((state) => state.activeCompany);
  const { settings: appSettings } = useSettings(activeCompany?.id || '');
  const fiscalYearStart = appSettings?.fiscalYearStart;
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const { formatCurrency, formatDate } = useFormatters(activeCompany?.id || '');

  useEffect(() => {
    if (activeCompany?.id && !startDate && !endDate) {
      setStartDate(defaultFromDate(fiscalYearStart));
      setEndDate(defaultToDate());
    }
  }, [activeCompany?.id, startDate, endDate, fiscalYearStart]);

  const formatNumber = (n: number) => formatCurrency(Math.abs(n));

  const { data: cfData, isLoading } = useAsyncData<CashFlowData>(
    async () => {
      const companyId = activeCompany!.id;
      const plResult = await accountingApi.getProfitLoss(companyId, startDate || undefined, endDate || undefined);
      const bsResult = await accountingApi.getBalanceSheet(companyId, endDate || undefined);
      const arResult = await salesApi.getCustomerArAging(companyId);
      const apTotalResult = await purchasesApi.getApAgingTotal(companyId);
      const apTotal = apTotalResult.success ? (apTotalResult.total || 0) : 0;

      let netProfit = 0;
      if (plResult.success && plResult.data) {
        const accounts = plResult.data as Account[];
        const revenue = accounts.filter((a) => a.type === 'revenue').reduce((s, a) => s + Math.abs(a.balance), 0);
        const expense = accounts.filter((a) => a.type === 'expense').reduce((s, a) => s + Math.abs(a.balance), 0);
        netProfit = revenue - expense;
      }
      const arChange = arResult.data?.reduce((s, c) => s + (c.totalDue || 0), 0) || 0;
      const apChange = apTotal;

      const ops: CFRow[] = [];
      if (netProfit !== 0) ops.push({ activity: t('accounting.cashFlow.netProfit'), amount: netProfit });
      if (plResult.success && plResult.data) {
        const accounts = plResult.data as Account[];
        const depreciationAcc = accounts.find((a) => a.nameAr?.includes('إهلاك') || a.nameAr?.includes('اهلاك') || a.code.startsWith('12'));
        if (depreciationAcc) ops.push({ activity: t('accounting.cashFlow.depreciation'), amount: Math.abs(depreciationAcc.balance) });
      }
      if (arChange !== 0) ops.push({ activity: t('accounting.cashFlow.receivablesChange'), amount: -arChange });
      if (apChange !== 0) ops.push({ activity: t('accounting.cashFlow.payablesChange'), amount: apChange });
      let inventoryChange = 0;
      if (bsResult.success && bsResult.data) {
        const accounts = bsResult.data as Account[];
        const inventoryAcc = accounts.find((a) => a.nameAr?.includes('مخزون') || a.code.startsWith('13'));
        if (inventoryAcc) inventoryChange = inventoryAcc.balance;
      }
      if (inventoryChange !== 0) ops.push({ activity: t('accounting.cashFlow.inventoryChange'), amount: -inventoryChange });
      const opsTotal = ops.reduce((s, r) => s + r.amount, 0);
      if (ops.length > 0) ops.push({ activity: t('accounting.cashFlow.netOperating'), amount: opsTotal, isTotal: true });

      const inv: CFRow[] = [];
      if (bsResult.success && bsResult.data) {
        const accounts = bsResult.data as Account[];
        const fixedAssets = accounts.filter((a) => a.type === 'asset' && (a.nameAr?.includes('أصول ثابتة') || a.code.startsWith('12')));
        const faTotal = fixedAssets.reduce((s, a) => s + Math.abs(a.balance), 0);
        if (faTotal > 0) inv.push({ activity: t('accounting.cashFlow.fixedAssetsPurchase'), amount: -faTotal });
      }
      const invTotal = inv.reduce((s, r) => s + r.amount, 0);
      if (inv.length > 0) inv.push({ activity: t('accounting.cashFlow.netInvesting'), amount: invTotal, isTotal: true });

      const fin: CFRow[] = [];
      if (bsResult.success && bsResult.data) {
        const accounts = bsResult.data as Account[];
        const loans = accounts.filter((a) => a.type === 'liability');
        const equity = accounts.filter((a) => a.type === 'equity');
        const loanTotal = loans.reduce((s, a) => s + a.balance, 0);
        const equityTotal = equity.reduce((s, a) => s + a.balance, 0);
        if (loanTotal !== 0) fin.push({ activity: t('accounting.cashFlow.loanRepayment'), amount: loanTotal });
        if (equityTotal !== 0) fin.push({ activity: t('accounting.cashFlow.equityContributions'), amount: equityTotal });
      }
      const finTotal = fin.reduce((s, r) => s + r.amount, 0);
      if (fin.length > 0) fin.push({ activity: t('accounting.cashFlow.netFinancing'), amount: finTotal, isTotal: true });

      return {
        operating: ops,
        investing: inv,
        financing: fin,
        netChange: opsTotal + invTotal + finTotal,
      };
    },
    [activeCompany?.id, startDate, endDate],
    !!activeCompany?.id,
  );

  const { operating, investing, financing, netChange } = cfData ?? emptyData;
  const allRows = [...operating, ...investing, ...financing];

  const totals = useMemo(() => {
    const o = operating.filter((r) => r.isTotal).reduce((s, r) => s + r.amount, 0) || operating.reduce((s, r) => s + (r.isTotal ? 0 : r.amount), 0);
    const i = investing.filter((r) => r.isTotal).reduce((s, r) => s + r.amount, 0) || investing.reduce((s, r) => s + (r.isTotal ? 0 : r.amount), 0);
    const f = financing.filter((r) => r.isTotal).reduce((s, r) => s + r.amount, 0) || financing.reduce((s, r) => s + (r.isTotal ? 0 : r.amount), 0);
    return { o, i, f, net: o + i + f };
  }, [operating, investing, financing]);

  const pieData = useMemo(() => {
    if (!operating.length && !investing.length && !financing.length) return [];
    const oAbs = Math.abs(totals.o);
    const iAbs = Math.abs(totals.i);
    const fAbs = Math.abs(totals.f);
    const sum = oAbs + iAbs + fAbs || 1;
    return [
      { name: t('accounting.cashFlow.operating'), value: oAbs, pct: ((oAbs / sum) * 100).toFixed(1) },
      { name: t('accounting.cashFlow.investing'), value: iAbs, pct: ((iAbs / sum) * 100).toFixed(1) },
      { name: t('accounting.cashFlow.financing'), value: fAbs, pct: ((fAbs / sum) * 100).toFixed(1) },
    ].filter((d) => d.value > 0);
  }, [totals, t, operating.length, investing.length, financing.length]);

  const renderRows = (rows: CFRow[]) => (
    <div className="divide-y divide-slate-100 dark:divide-slate-800">
      {rows.map((row, idx) => {
        if (row.isTotal) {
          return (
            <div key={idx} className="flex justify-between py-2.5 px-3 bg-slate-50 dark:bg-slate-800/50 font-bold border-t border-slate-200 dark:border-slate-700">
              <span>{row.activity}</span>
              <span className={cn('tabular-nums', row.amount >= 0 ? 'text-emerald-600' : 'text-rose-600')}>{row.amount >= 0 ? '+' : '-'}{formatNumber(row.amount)}</span>
            </div>
          );
        }
        return (
          <div key={idx} className="flex justify-between py-2 px-3 text-sm text-slate-700 dark:text-slate-300">
            <span>{row.activity}</span>
            <span className={cn('tabular-nums font-medium', row.amount >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400')}>{row.amount >= 0 ? '+' : '-'}{formatNumber(row.amount)}</span>
          </div>
        );
      })}
    </div>
  );

  if (isLoading) {
    return (
      <div className="space-y-4 p-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-40 bg-slate-100 dark:bg-slate-800 rounded-xl animate-pulse" />
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
              <Banknote size={22} className="text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50 tracking-tight">{t('accounting.cashFlow.title')}</h1>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                {startDate && endDate ? `${t('accounting.period')}: ${formatDate(startDate)} — ${formatDate(endDate)}` : `${t('accounting.period')}: ${t('accounting.all')}`}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 self-start sm:self-auto flex-wrap">
            <Button variant="secondary" size="sm" leftIcon={<Calendar size={14} />} onClick={() => setShowFilters(!showFilters)}>
              {t('filter')}
            </Button>
            <Button variant="secondary" size="sm" leftIcon={<FileDown size={14} />} onClick={() => exportToExcel(allRows.map((r) => ({ activity: r.activity, amount: r.amount })), [{ key: 'activity', header: t('accounting.cashFlow.activity'), width: 40 }, { key: 'amount', header: t('accounting.amount'), width: 18 }], 'CashFlow_Report')}>
              Excel
            </Button>
            <Button variant="secondary" size="sm" leftIcon={<FileDown size={14} />} onClick={() => exportToPdf('cf-print', 'CashFlow_Report', t('accounting.cashFlow.title'))}>
              PDF
            </Button>
          </div>
        </div>

        {/* KPI */}
        <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          <Card className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold tracking-wider uppercase text-slate-500 flex items-center gap-1"><Activity size={12} /> {t('accounting.cashFlow.operating')}</p>
              <p className={cn('text-lg font-bold tabular-nums mt-1', totals.o >= 0 ? 'text-emerald-600' : 'text-rose-600')}>{totals.o >= 0 ? '+' : ''}{formatCurrency(totals.o)}</p>
            </div>
            <div className={cn('w-10 h-10 rounded-xl flex items-center justify-center', totals.o >= 0 ? 'bg-emerald-50 dark:bg-emerald-900/20' : 'bg-rose-50 dark:bg-rose-900/20')}>
              {totals.o >= 0 ? <ArrowUpCircle size={18} className="text-emerald-600" /> : <ArrowDownCircle size={18} className="text-rose-600" />}
            </div>
          </Card>
          <Card className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold tracking-wider uppercase text-slate-500">{t('accounting.cashFlow.investing')}</p>
              <p className={cn('text-lg font-bold tabular-nums mt-1', totals.i >= 0 ? 'text-emerald-600' : 'text-rose-600')}>{totals.i >= 0 ? '+' : ''}{formatCurrency(totals.i)}</p>
            </div>
            <div className="w-10 h-10 rounded-xl bg-blue-50 dark:bg-blue-900/20 flex items-center justify-center">
              <Building2 size={18} className="text-blue-600" />
            </div>
          </Card>
          <Card className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold tracking-wider uppercase text-slate-500">{t('accounting.cashFlow.financing')}</p>
              <p className={cn('text-lg font-bold tabular-nums mt-1', totals.f >= 0 ? 'text-emerald-600' : 'text-rose-600')}>{totals.f >= 0 ? '+' : ''}{formatCurrency(totals.f)}</p>
            </div>
            <div className="w-10 h-10 rounded-xl bg-purple-50 dark:bg-purple-900/20 flex items-center justify-center">
              <Wallet size={18} className="text-purple-600" />
            </div>
          </Card>
          <Card className={cn('p-4 flex items-center justify-between border', netChange >= 0 ? 'bg-emerald-50/30 dark:bg-emerald-900/10 border-emerald-200 dark:border-emerald-800' : 'bg-rose-50/30 dark:bg-rose-900/10 border-rose-200 dark:border-rose-800')}>
            <div>
              <p className="text-xs font-semibold tracking-wider uppercase text-slate-500 flex items-center gap-1"><TrendingUp size={12} /> {t('accounting.cashFlow.netChange')}</p>
              <p className={cn('text-lg font-bold tabular-nums mt-1', netChange >= 0 ? 'text-emerald-700 dark:text-emerald-300' : 'text-rose-700 dark:text-rose-300')}>{netChange >= 0 ? '+' : ''}{formatCurrency(netChange)}</p>
            </div>
            <Badge className={cn('border', netChange >= 0 ? 'bg-emerald-100 text-emerald-700 border-emerald-200' : 'bg-rose-100 text-rose-700 border-rose-200')}>{netChange >= 0 ? 'إيجابي' : 'سلبي'}</Badge>
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
                    if (p === 'month') { setStartDate(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`); setEndDate(defaultToDate()); }
                    else if (p === 'quarter') { const q = Math.floor(now.getMonth() / 3) * 3; setStartDate(`${now.getFullYear()}-${String(q + 1).padStart(2, '0')}-01`); setEndDate(defaultToDate()); }
                    else { setStartDate(`${now.getFullYear()}-01-01`); setEndDate(defaultToDate()); }
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
      {pieData.length > 0 && (
        <Card className="p-4">
          <h3 className="font-semibold text-slate-900 dark:text-slate-100 mb-2 flex items-center gap-2"><Wallet size={16} /> توزيع التدفقات (بالقيمة المطلقة)</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={pieData}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  outerRadius={90}
                  label={({ name, percent }) => `${name} ${((percent as number) * 100).toFixed(0)}%`}
                >
                  {pieData.map((_, idx) => (
                    <Cell key={idx} fill={COLORS[idx % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(value: unknown) => formatCurrency(Number(value as number) || 0) as unknown as string} />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <Card noPadding>
          <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between bg-emerald-50/50 dark:bg-emerald-900/10">
            <h3 className="font-bold text-emerald-700 dark:text-emerald-300 flex items-center gap-2"><TrendingUp size={16} /> {t('accounting.cashFlow.operating')}</h3>
            <span className={cn('text-sm font-bold tabular-nums', totals.o >= 0 ? 'text-emerald-700' : 'text-rose-700')}>{formatCurrency(totals.o)}</span>
          </div>
          {operating.length ? renderRows(operating) : <div className="py-8"><EmptyState icon="inbox" title={t('accounting.noData')} /></div>}
        </Card>
        <Card noPadding>
          <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between bg-blue-50/50 dark:bg-blue-900/10">
            <h3 className="font-bold text-blue-700 dark:text-blue-300 flex items-center gap-2"><Building2 size={16} /> {t('accounting.cashFlow.investing')}</h3>
            <span className={cn('text-sm font-bold tabular-nums', totals.i >= 0 ? 'text-emerald-700' : 'text-rose-700')}>{formatCurrency(totals.i)}</span>
          </div>
          {investing.length ? renderRows(investing) : <div className="py-8"><EmptyState icon="inbox" title={t('accounting.noData')} /></div>}
        </Card>
        <Card noPadding>
          <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between bg-purple-50/50 dark:bg-purple-900/10">
            <h3 className="font-bold text-purple-700 dark:text-purple-300 flex items-center gap-2"><Wallet size={16} /> {t('accounting.cashFlow.financing')}</h3>
            <span className={cn('text-sm font-bold tabular-nums', totals.f >= 0 ? 'text-emerald-700' : 'text-rose-700')}>{formatCurrency(totals.f)}</span>
          </div>
          {financing.length ? renderRows(financing) : <div className="py-8"><EmptyState icon="inbox" title={t('accounting.noData')} /></div>}
        </Card>
      </div>

      <Card className={cn('p-4 flex items-center justify-between', netChange >= 0 ? 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800' : 'bg-rose-50 dark:bg-rose-900/20 border-rose-200 dark:border-rose-800')}>
        <span className="font-bold flex items-center gap-2"><Activity size={16} /> {t('accounting.cashFlow.netChange')}</span>
        <span className={cn('font-bold tabular-nums text-lg', netChange >= 0 ? 'text-emerald-700 dark:text-emerald-300' : 'text-rose-700 dark:text-rose-300')}>{netChange >= 0 ? '+' : ''}{formatCurrency(netChange)}</span>
      </Card>

      <div id="cf-print" className="hidden">
        <table>
          <thead>
            <tr>
              <th>{t('accounting.cashFlow.activity')}</th>
              <th>{t('accounting.amount')}</th>
            </tr>
          </thead>
          <tbody>
            {allRows.map((row, idx) => (
              <tr key={idx} className={row.isTotal ? 'total-row' : ''}>
                <td>{row.activity}</td>
                <td className="number">{formatCurrency(row.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default CashFlowReport;
