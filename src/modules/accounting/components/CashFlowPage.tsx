import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Banknote, FileDown, Calendar, TrendingUp, Building2, Wallet, ArrowUpCircle, ArrowDownCircle, Activity } from 'lucide-react';
import { Card, Button, Input, Badge } from '@/core/ui/components';
import { EmptyState } from '@/core/ui/components/EmptyState';
import { useAppStore } from '@/core/store';
import { useTranslation } from '@/core/i18n/useTranslation';
import { accountingApi } from '../api';
import { exportToExcel } from '@/core/utils/exportEngine';
import { exportToPdf } from '@/core/utils/export';
import type { CashFlowStatement } from '../types';
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

type CashFlowData = CashFlowStatement;

const LINE_LABELS: Record<string, string> = {
  netProfit: 'accounting.cashFlow.netProfit',
  depreciation: 'accounting.cashFlow.depreciation',
  receivablesChange: 'accounting.cashFlow.receivablesChange',
  payablesChange: 'accounting.cashFlow.payablesChange',
  inventoryChange: 'accounting.cashFlow.inventoryChange',
  vatChange: 'accounting.cashFlow.vatChange',
  payrollChange: 'accounting.cashFlow.payrollChange',
  capex: 'accounting.cashFlow.capex',
  proceeds: 'accounting.cashFlow.proceeds',
  equityChange: 'accounting.cashFlow.equityChange',
};

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

  // Phase 5: single JE-derived source (IAS 7 indirect) — no snapshots,
  // no name/code heuristics.
  const { data: cfData, isLoading } = useAsyncData<CashFlowData>(
    async () => {
      const companyId = activeCompany!.id;
      const res = await accountingApi.getCashFlow(companyId, startDate, endDate);
      if (!res.success || !res.data) throw new Error(res.error);
      return res.data;
    },
    [activeCompany?.id, startDate, endDate],
    !!activeCompany?.id && !!startDate && !!endDate,
  );

  const toRows = useCallback((lines: { key: string; amount: number }[], totalKey: string): CFRow[] => [
    ...lines.map((l) => ({ activity: t(LINE_LABELS[l.key] || 'accounting.cashFlow.activity'), amount: l.amount })),
    ...(lines.length > 0 ? [{ activity: t(totalKey), amount: lines.reduce((s, l) => s + l.amount, 0), isTotal: true }] : []),
  ], [t]);
  const operating = useMemo(
    () => (cfData ? toRows(cfData.operating, 'accounting.cashFlow.netOperating') : []),
    [cfData, toRows]
  );
  const investing = useMemo(
    () => (cfData ? toRows(cfData.investing, 'accounting.cashFlow.netInvesting') : []),
    [cfData, toRows]
  );
  const financing = useMemo(
    () => (cfData ? toRows(cfData.financing, 'accounting.cashFlow.netFinancing') : []),
    [cfData, toRows]
  );
  const netChange = cfData?.netChange || 0;

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
              {t('filter.title')}
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
            <Badge className={cn('border', netChange >= 0 ? 'bg-emerald-100 text-emerald-700 border-emerald-200' : 'bg-rose-100 text-rose-700 border-rose-200')}>{netChange >= 0 ? t('accounting.cashFlow.positive') : t('accounting.cashFlow.negative')}</Badge>
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
                  {p === 'month' ? t('accounting.cashFlow.thisMonth') : p === 'quarter' ? t('accounting.cashFlow.thisQuarter') : t('accounting.cashFlow.thisYear')}
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
          <h3 className="font-semibold text-slate-900 dark:text-slate-100 mb-2 flex items-center gap-2"><Wallet size={16} /> {t('accounting.cashFlow.distributionTitle')}</h3>
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

      {cfData && (
        <Card className="p-4">
          <div className="font-bold mb-2">{t('accounting.cashFlow.reconcileTitle')}</div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            <div>
              <div className="text-slate-500">{t('accounting.cashFlow.cashBegin')}</div>
              <div className="font-bold tabular-nums">{formatCurrency(cfData.cashBegin)}</div>
            </div>
            <div>
              <div className="text-slate-500">{t('accounting.cashFlow.cashEnd')}</div>
              <div className="font-bold tabular-nums">{formatCurrency(cfData.cashEnd)}</div>
            </div>
            <div>
              <div className="text-slate-500">{t('accounting.cashFlow.cashChange')}</div>
              <div className="font-bold tabular-nums">{formatCurrency(cfData.cashChange)}</div>
            </div>
            <div>
              <div className="text-slate-500">{t('accounting.cashFlow.unexplained')}</div>
              <div className={cn('font-bold tabular-nums', cfData.unexplained === 0 ? 'text-emerald-600' : 'text-amber-600')}>
                {formatCurrency(cfData.unexplained)}
              </div>
            </div>
          </div>
        </Card>
      )}

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
