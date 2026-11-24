import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { DollarSign, TrendingUp, Vault } from 'lucide-react';
import { PageHeader, Card, Button, Input, Select } from '@/core/ui/components';
import { EmptyState } from '@/core/ui/components/EmptyState';
import { useTranslation } from '@/core/i18n/useTranslation';
import { useFormatters } from '@/core/utils/useFormatters';
import { type ReportSpec } from '@/core/reports';
import { useAppStore } from '@/core/store';
import { getDbAdapter } from '@/core/database/adapters';
import { ReportTable } from './shared/components/ReportTable';
import { ReportSummaryGrid } from './shared/components/ReportSummaryGrid';
import { ReportExportButtons } from './shared/components/ReportExportButtons';
import { sumCol } from './shared/liveAggregates';

interface AccountRow {
  code: string;
  name: string;
  type: string;
  debit: number;
  credit: number;
  balance: number;
}

export const TrialBalancePage: React.FC = () => {
  const { t } = useTranslation();
  const { formatCurrency } = useFormatters();
  const companyId = useAppStore((s) => s.activeCompany?.id || '');
  const [period, setPeriod] = useState({ from: '', to: '' });
  const [accountTypeFilter, setAccountTypeFilter] = useState('');
  const [, setRefreshKey] = useState(0);

  const queryFn = useCallback(async () => {
    const adapter = await getDbAdapter();
    const res = await adapter.query(
      `SELECT a.code, a.name_ar AS name, a.type,
              SUM(COALESCE(je.debit, 0)) AS debit,
              SUM(COALESCE(je.credit, 0)) AS credit,
              SUM(COALESCE(je.debit, 0)) - SUM(COALESCE(je.credit, 0)) AS balance
         FROM accounts a
         JOIN journal_entries je ON je.account_id = a.id
        WHERE a.company_id = $1 AND je.company_id = $1 AND je.status = 'posted'
          AND ($2::date IS NULL OR je.created_at::date >= $2::date)
          AND ($3::date IS NULL OR je.created_at::date <= $3::date)
          AND ($4::varchar IS NULL OR a.type = $4::varchar)
        GROUP BY a.code, a.name_ar, a.type
        ORDER BY a.code`,
      [companyId, period.from || null, period.to || null, accountTypeFilter || null]
    );
    return (res.rows as AccountRow[]).map((r) => ({
      code: String(r.code ?? ''),
      name: String(r.name ?? ''),
      type: String(r.type ?? ''),
      debit: Number(r.debit ?? 0),
      credit: Number(r.credit ?? 0),
      balance: Number(r.balance ?? 0),
    }));
  }, [companyId, period.from, period.to, accountTypeFilter]);

  const [data, setData] = useState<AccountRow[] | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    setIsLoading(true); setError(null);
    try { setData(await queryFn()); }
    catch (e) { setError(e instanceof Error ? e.message : 'error'); setData(null); }
    finally { setIsLoading(false); }
  }, [queryFn]);
  useEffect(() => { void refresh(); }, [refresh]);
  

  const summary = useMemo(() => {
    const rows = data || [];
    return {
      totalDebit: sumCol(rows, 'debit'),
      totalCredit: sumCol(rows, 'credit'),
      net: sumCol(rows, 'debit') - sumCol(rows, 'credit'),
      accountsCount: rows.length,
    };
  }, [data]);

  return (
    <div className="animate-fade-in space-y-4">
      <PageHeader title={t('reports.tb.title')} subtitle={t('reports.tb.subtitle')} />
      <Card className="flex flex-wrap items-center gap-2">
        <Input className="w-32" placeholder={t('reports.tb.fromDate')} value={period.from} onChange={(e) => setPeriod({ ...period, from: e.target.value })} />
        <Input className="w-32" placeholder={t('reports.tb.toDate')} value={period.to} onChange={(e) => setPeriod({ ...period, to: e.target.value })} />
        <Select value={accountTypeFilter} onChange={(v) => setAccountTypeFilter(v)}>
          <option value="">{t('reports.tb.allTypes')}</option>
          <option value="asset">{t('accounting.types.asset')}</option>
          <option value="liability">{t('accounting.types.liability')}</option>
          <option value="equity">{t('accounting.types.equity')}</option>
          <option value="income">{t('accounting.types.income')}</option>
          <option value="expense">{t('accounting.types.expense')}</option>
        </Select>
        <Button variant="outline" size="sm" onClick={() => setRefreshKey((k) => k + 1)}>{t('common.refresh')}</Button>
      </Card>

      {error && <Card className="p-3 bg-rose-50 dark:bg-rose-900/20 text-rose-600">{error}</Card>}
      {isLoading && <div className="py-8 flex justify-center">…</div>}
      {!isLoading && !error && !data?.length && <EmptyState icon="inbox" title={t('common.noData')} description={t('common.noData')} />}
      {(data || []).length > 0 && (
        <>
          <ReportSummaryGrid items={[
            { key: 'td', title: t('reports.tb.totalDebit'), value: formatCurrency(summary.totalDebit), icon: DollarSign, color: 'emerald', trend: 'up' },
            { key: 'tc', title: t('reports.tb.totalCredit'), value: formatCurrency(summary.totalCredit), icon: DollarSign, color: 'rose' },
            { key: 'diff', title: t('reports.tb.difference'), value: formatCurrency(summary.net), icon: TrendingUp, color: 'emerald' },
            { key: 'count', title: t('reports.tb.accountsCount'), value: summary.accountsCount, icon: Vault, color: 'slate' },
          ]} />
          <ReportTable
            title={t('reports.tb.title')}
            columns={[
              { key: 'code', header: t('accounting.account.code'), width: 70, format: 'text' },
              { key: 'name', header: t('accounting.account.name'), width: 220, format: 'text' },
              { key: 'type', header: t('accounting.account.type'), width: 110, format: 'text' },
              { key: 'debit', header: t('accounting.journal.debit'), width: 140, format: 'money' },
              { key: 'credit', header: t('accounting.journal.credit'), width: 140, format: 'money' },
              { key: 'balance', header: t('accounting.account.balance'), width: 140, format: 'money' },
            ]}
            rows={data || []}
            totals={{ label: t('reports.tb.total'), values: { debit: summary.totalDebit, credit: summary.totalCredit, balance: summary.net } }}
            maxRows={200}
            actions={<ReportExportButtons spec={buildSpec} />}
          />
        </>
      )}
    </div>
  );

  function buildSpec(): ReportSpec | null {
    if (!data) return null;
    return {
      columns: [
        { key: 'code', header: t('accounting.account.code'), width: 30 },
        { key: 'name', header: t('accounting.account.name'), width: 120 },
        { key: 'type', header: t('accounting.account.type'), width: 40 },
        { key: 'debit', header: t('accounting.journal.debit'), width: 80, format: 'money' },
        { key: 'credit', header: t('accounting.journal.credit'), width: 80, format: 'money' },
        { key: 'balance', header: t('accounting.account.balance'), width: 80, format: 'money' },
      ],
      rows: data,
      meta: { title: t('reports.tb.title'), direction: 'rtl' },
      branding: { companyName: companyId, currency: 'YER' },
      filename: `TrialBalance_${companyId}`,
    };
  }
};

export default TrialBalancePage;
