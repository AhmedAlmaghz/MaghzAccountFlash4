import React from 'react';
import { useAppStore } from '@/core/store';
import { useFormatters } from '@/core/utils/useFormatters';
import { useTranslation } from '@/core/i18n/useTranslation';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, AreaChart, Area, LineChart, Line, Legend
} from 'recharts';

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899', '#6366f1'];

interface ChartCardProps {
  title: string;
  children: React.ReactNode;
  height?: number;
  action?: React.ReactNode;
}

const ChartCard: React.FC<ChartCardProps> = ({ title, children, height = 300, action }) => (
  <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4 shadow-sm">
    <div className="flex items-center justify-between mb-4">
      <h3 className="font-semibold text-slate-900 dark:text-slate-50 text-sm">{title}</h3>
      {action}
    </div>
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        {children}
      </ResponsiveContainer>
    </div>
  </div>
);

// --- Monthly Revenue & Expenses (Bar) ---
interface MonthlyRevenueProps {
  data: Array<{ month: string; revenue: number; expenses: number }>;
}

export const MonthlyRevenueChart: React.FC<MonthlyRevenueProps> = ({ data }) => {
  const activeCompany = useAppStore((state) => state.activeCompany);
  const { formatCurrency } = useFormatters(activeCompany?.id || '');
  const { t } = useTranslation();
  const chartData = data?.length ? data : [{ month: t('reports.none'), revenue: 0, expenses: 0 }];
  return (
    <ChartCard title={t('reports.charts.monthlySalesAndExpenses')}>
      <BarChart data={chartData}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
        <XAxis dataKey="month" tick={{ fontSize: 12 }} />
        <YAxis tick={{ fontSize: 12 }} tickFormatter={(v) => `${(v / 1000).toFixed(0)}K`} />
        <Tooltip
          formatter={(value: unknown) => [formatCurrency(Number(value)), '']}
          contentStyle={{ borderRadius: '8px', border: '1px solid #e2e8f0' }}
        />
        <Legend />
        <Bar dataKey="revenue" fill="#3b82f6" name={t('reports.revenue')} radius={[4, 4, 0, 0]} />
        <Bar dataKey="expenses" fill="#ef4444" name={t('reports.totalExpenses')} radius={[4, 4, 0, 0]} />
      </BarChart>
    </ChartCard>
  );
};

// --- Top Products (Donut) ---
interface TopProductsProps {
  data: Array<{ name: string; value: number }>;
}

export const TopProductsChart: React.FC<TopProductsProps> = ({ data }) => {
  const activeCompany = useAppStore((state) => state.activeCompany);
  const { formatCurrency } = useFormatters(activeCompany?.id || '');
  const { t } = useTranslation();
  const chartData = data?.length ? data : [{ name: t('reports.none'), value: 0 }];
  return (
    <ChartCard title={t('reports.topSellingProducts')}>
      <PieChart>
        <Pie
          data={chartData}
          cx="50%"
          cy="45%"
          innerRadius={60}
          outerRadius={90}
          paddingAngle={4}
          dataKey="value"
          nameKey="name"
        >
          {chartData.map((_, index) => (
            <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
          ))}
        </Pie>
        <Tooltip formatter={(value: unknown) => formatCurrency(Number(value))} />
        <Legend verticalAlign="bottom" height={36} iconType="circle" />
      </PieChart>
    </ChartCard>
  );
};

// --- AR Aging (Horizontal Bar) ---
interface ArAgingProps {
  data: Array<{ range: string; amount: number }>;
}

export const ArAgingChart: React.FC<ArAgingProps> = ({ data }) => {
  const activeCompany = useAppStore((state) => state.activeCompany);
  const { formatCurrency } = useFormatters(activeCompany?.id || '');
  const { t } = useTranslation();
  const chartData = data?.length ? data : [{ range: '0-30', amount: 0 }];
  return (
    <ChartCard title={t('reports.charts.arAging')}>
      <BarChart data={chartData} layout="vertical">
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
        <XAxis type="number" tickFormatter={(v: number | string) => `${(Number(v) / 1000).toFixed(0)}K`} />
        <YAxis dataKey="range" type="category" tick={{ fontSize: 12 }} width={60} />
        <Tooltip formatter={(value: unknown) => formatCurrency(Number(value))} />
        <Bar dataKey="amount" fill="#8b5cf6" radius={[0, 4, 4, 0]} name={t('reports.amount')} />
      </BarChart>
    </ChartCard>
  );
};

// --- Cash Flow (Area) ---
interface CashFlowProps {
  data: Array<{ month: string; inflow: number; outflow: number }>;
}

export const CashFlowChart: React.FC<CashFlowProps> = ({ data }) => {
  const activeCompany = useAppStore((state) => state.activeCompany);
  const { formatCurrency } = useFormatters(activeCompany?.id || '');
  const { t } = useTranslation();
  const chartData = data?.length ? data : [{ month: t('reports.months.jan'), inflow: 0, outflow: 0 }];
  return (
    <ChartCard title={t('reports.charts.cashFlow')}>
      <AreaChart data={chartData}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
        <XAxis dataKey="month" tick={{ fontSize: 12 }} />
        <YAxis tickFormatter={(v: number | string) => `${(Number(v) / 1000).toFixed(0)}K`} />
        <Tooltip formatter={(value: unknown) => formatCurrency(Number(value))} />
        <Legend />
        <Area type="monotone" dataKey="inflow" stroke="#10b981" fill="#10b981" fillOpacity={0.2} name={t('reports.cashInflow')} />
        <Area type="monotone" dataKey="outflow" stroke="#ef4444" fill="#ef4444" fillOpacity={0.2} name={t('reports.cashOutflow')} />
      </AreaChart>
    </ChartCard>
  );
};

// --- Sales Trend (Line) ---
interface SalesTrendProps {
  data: Array<{ date: string; sales: number; purchases: number }>;
}

export const SalesTrendChart: React.FC<SalesTrendProps> = ({ data }) => {
  const activeCompany = useAppStore((state) => state.activeCompany);
  const { formatCurrency } = useFormatters(activeCompany?.id || '');
  const { t } = useTranslation();
  const chartData = data?.length ? data : [{ date: '-', sales: 0, purchases: 0 }];
  return (
    <ChartCard title={t('reports.charts.salesAndPurchasesTrend')}>
      <LineChart data={chartData}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
        <XAxis dataKey="date" tick={{ fontSize: 11 }} angle={-30} textAnchor="end" height={50} />
        <YAxis tickFormatter={(v: number | string) => `${(Number(v) / 1000).toFixed(0)}K`} />
        <Tooltip formatter={(value: unknown) => formatCurrency(Number(value))} />
        <Legend />
        <Line type="monotone" dataKey="sales" stroke="#3b82f6" strokeWidth={2} dot={false} name={t('reports.sales')} />
        <Line type="monotone" dataKey="purchases" stroke="#f59e0b" strokeWidth={2} dot={false} name={t('reports.purchases')} />
      </LineChart>
    </ChartCard>
  );
};

// --- Profit Trend (Area) ---
interface ProfitTrendProps {
  data: Array<{ date: string; profit: number }>;
}

export const ProfitTrendChart: React.FC<ProfitTrendProps> = ({ data }) => {
  const activeCompany = useAppStore((state) => state.activeCompany);
  const { formatCurrency } = useFormatters(activeCompany?.id || '');
  const { t } = useTranslation();
  const chartData = data?.length ? data : [{ date: '-', profit: 0 }];
  return (
    <ChartCard title={t('reports.charts.profitTrend')}>
      <AreaChart data={chartData}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
        <XAxis dataKey="date" tick={{ fontSize: 11 }} angle={-30} textAnchor="end" height={50} />
        <YAxis tickFormatter={(v: number | string) => `${(Number(v) / 1000).toFixed(0)}K`} />
        <Tooltip formatter={(value: unknown) => formatCurrency(Number(value))} />
        <Area type="monotone" dataKey="profit" stroke="#10b981" fill="#10b981" fillOpacity={0.2} name={t('reports.profit')} />
      </AreaChart>
    </ChartCard>
  );
};

// --- Opportunity Funnel (Horizontal Bar) ---
interface OpportunityFunnelProps {
  data: Array<{ stage: string; value: number; count: number }>;
}

const STAGE_ORDER = ['new', 'qualified', 'proposal', 'negotiation', 'won', 'lost'];
const STAGE_COLORS: Record<string, string> = {
  new: '#94a3b8',
  qualified: '#3b82f6',
  proposal: '#f59e0b',
  negotiation: '#8b5cf6',
  won: '#10b981',
  lost: '#ef4444',
};

function stageLabelKey(stage: string): string {
  const map: Record<string, string> = {
    new: 'crm.stage.new',
    qualified: 'crm.stage.qualified',
    proposal: 'crm.stage.proposal',
    negotiation: 'crm.stage.negotiation',
    won: 'crm.stage.won',
    lost: 'crm.stage.lost',
  };
  return map[stage] || stage;
}

export const OpportunityFunnelChart: React.FC<OpportunityFunnelProps> = ({ data }) => {
  const { t } = useTranslation();
  const activeCompany = useAppStore((state) => state.activeCompany);
  const { formatCurrency } = useFormatters(activeCompany?.id || '');

  const chartData = STAGE_ORDER
    .map((s) => {
      const found = (data || []).find((d) => d.stage === s);
      return { stage: t(stageLabelKey(s)), value: found?.value || 0, count: found?.count || 0, rawStage: s };
    })
    .filter((d) => d.count > 0);

  if (chartData.length === 0) {
    return (
      <ChartCard title={t('reports.pipelineByStage')}>
        <div className="h-full flex items-center justify-center text-slate-400 text-sm">{t('reports.opportunityPipelineNoData')}</div>
      </ChartCard>
    );
  }

  return (
    <ChartCard title={t('reports.pipelineByStage')}>
      <BarChart data={chartData} layout="vertical" margin={{ top: 5, right: 20, left: 20, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
        <XAxis type="number" tickFormatter={(v: number) => `${(v / 1000).toFixed(0)}K`} />
        <YAxis dataKey="stage" type="category" tick={{ fontSize: 12 }} width={100} />
        <Tooltip
          formatter={(value: unknown, _name: unknown) => [
            `${t('reports.totalValue')}: ${formatCurrency(Number(value))}`,
            '',
          ]}
        />
        <Bar dataKey="value" radius={[0, 4, 4, 0]}>
          {chartData.map((entry) => (
            <Cell key={entry.rawStage} fill={STAGE_COLORS[entry.rawStage] || '#94a3b8'} />
          ))}
        </Bar>
      </BarChart>
    </ChartCard>
  );
};

// --- Category Share (Pie) ---
interface CategoryShareProps {
  data: Array<{ name: string; value: number }>;
}

export const CategoryShareChart: React.FC<CategoryShareProps> = ({ data }) => {
  const activeCompany = useAppStore((state) => state.activeCompany);
  const { formatCurrency } = useFormatters(activeCompany?.id || '');
  const { t } = useTranslation();
  const chartData = data?.length ? data : [{ name: t('reports.none'), value: 0 }];
  return (
    <ChartCard title={t('reports.charts.inventoryByCategory')}>
      <PieChart>
        <Pie
          data={chartData}
          cx="50%"
          cy="45%"
          outerRadius={90}
          paddingAngle={3}
          dataKey="value"
          nameKey="name"
        >
          {chartData.map((_, index) => (
            <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
          ))}
        </Pie>
        <Tooltip formatter={(value: unknown) => formatCurrency(Number(value))} />
        <Legend verticalAlign="bottom" height={36} iconType="circle" />
      </PieChart>
    </ChartCard>
  );
};
