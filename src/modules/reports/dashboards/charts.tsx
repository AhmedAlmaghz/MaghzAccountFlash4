import React, { useMemo } from 'react';
import { useAppStore } from '@/core/store';
import { useFormatters } from '@/core/utils/useFormatters';
import { useTranslation } from '@/core/i18n/useTranslation';
import { getChartColors, getChartTheme } from '@/core/ui/components/patterns/chartTheme';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, AreaChart, Area, LineChart, Line, Legend
} from 'recharts';

/** Theme-aware palette — read once per render from CSS vars (light/dark aware). */
function useChartColors(): string[] {
  return useMemo(() => getChartColors(), []);
}

function useChartTheme() {
  const theme = useAppStore((state) => state.theme);
  return useMemo(() => {
    const t = getChartTheme();
    return { ...t, isDark: theme === 'dark' };
  }, [theme]);
}

interface ChartCardProps {
  title: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}

const ChartCard: React.FC<ChartCardProps> = ({ title, children, action }) => (
  <div className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 p-4 shadow-card transition-all duration-200 hover:shadow-lift">
    <div className="flex items-center justify-between mb-4">
      <h3 className="font-bold text-zinc-900 dark:text-zinc-50 text-sm">{title}</h3>
      {action}
    </div>
    <div className="h-60 sm:h-72">
      <ResponsiveContainer width="100%" height="100%">
        {children}
      </ResponsiveContainer>
    </div>
  </div>
);

/** Theme-aware tooltip style. */
function useTooltipStyle() {
  const ct = useChartTheme();
  return useMemo(
    () => ({
      borderRadius: '12px',
      border: `1px solid ${ct.grid}`,
      background: ct.isDark ? '#18181b' : '#ffffff',
      color: ct.isDark ? '#fafafa' : '#18181b',
      boxShadow: '0 8px 24px -8px rgba(9,9,11,0.2)',
    }),
    [ct]
  );
}

// --- Monthly Revenue & Expenses (Bar) ---
interface MonthlyRevenueProps {
  data: Array<{ month: string; revenue: number; expenses: number }>;
}

export const MonthlyRevenueChart: React.FC<MonthlyRevenueProps> = ({ data }) => {
  const activeCompany = useAppStore((state) => state.activeCompany);
  const { formatCurrency } = useFormatters(activeCompany?.id || '');
  const { t } = useTranslation();
  const ct = useChartTheme();
  const colors = useChartColors();
  const tooltipStyle = useTooltipStyle();
  const chartData = data?.length ? data : [{ month: t('reports.none'), revenue: 0, expenses: 0 }];
  return (
    <ChartCard title={t('reports.charts.monthlySalesAndExpenses')}>
      <BarChart data={chartData}>
        <CartesianGrid strokeDasharray="3 3" stroke={ct.grid} />
        <XAxis dataKey="month" tick={{ fontSize: 11, fill: ct.text }} />
        <YAxis tick={{ fontSize: 11, fill: ct.text }} tickFormatter={(v) => `${(v / 1000).toFixed(0)}K`} />
        <Tooltip
          formatter={(value: unknown) => [formatCurrency(Number(value)), '']}
          contentStyle={tooltipStyle}
        />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        <Bar dataKey="revenue" fill={colors[0]} name={t('reports.revenue')} radius={[6, 6, 0, 0]} />
        <Bar dataKey="expenses" fill={colors[7]} name={t('reports.totalExpenses')} radius={[6, 6, 0, 0]} />
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
  const colors = useChartColors();
  const tooltipStyle = useTooltipStyle();
  const chartData = data?.length ? data : [{ name: t('reports.none'), value: 0 }];
  return (
    <ChartCard title={t('reports.topSellingProducts')}>
      <PieChart>
        <Pie
          data={chartData}
          cx="50%"
          cy="45%"
          innerRadius="52%"
          outerRadius="78%"
          paddingAngle={4}
          dataKey="value"
          nameKey="name"
        >
          {chartData.map((_, index) => (
            <Cell key={`cell-${index}`} fill={colors[index % colors.length]} />
          ))}
        </Pie>
        <Tooltip formatter={(value: unknown) => formatCurrency(Number(value))} contentStyle={tooltipStyle} />
        <Legend wrapperStyle={{ fontSize: 11 }} verticalAlign="bottom" height={36} iconType="circle" />
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
  const ct = useChartTheme();
  const colors = useChartColors();
  const tooltipStyle = useTooltipStyle();
  const chartData = data?.length ? data : [{ range: '0-30', amount: 0 }];
  return (
    <ChartCard title={t('reports.charts.arAging')}>
      <BarChart data={chartData} layout="vertical">
        <CartesianGrid strokeDasharray="3 3" stroke={ct.grid} />
        <XAxis type="number" tick={{ fontSize: 11, fill: ct.text }} tickFormatter={(v: number | string) => `${(Number(v) / 1000).toFixed(0)}K`} />
        <YAxis dataKey="range" type="category" tick={{ fontSize: 11, fill: ct.text }} width={60} />
        <Tooltip formatter={(value: unknown) => formatCurrency(Number(value))} contentStyle={tooltipStyle} />
        <Bar dataKey="amount" fill={colors[6]} radius={[0, 6, 6, 0]} name={t('reports.amount')} />
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
  const ct = useChartTheme();
  const colors = useChartColors();
  const tooltipStyle = useTooltipStyle();
  const chartData = data?.length ? data : [{ month: t('reports.months.jan'), inflow: 0, outflow: 0 }];
  return (
    <ChartCard title={t('reports.charts.cashFlow')}>
      <AreaChart data={chartData}>
        <CartesianGrid strokeDasharray="3 3" stroke={ct.grid} />
        <XAxis dataKey="month" tick={{ fontSize: 11, fill: ct.text }} />
        <YAxis tick={{ fontSize: 11, fill: ct.text }} tickFormatter={(v: number | string) => `${(Number(v) / 1000).toFixed(0)}K`} />
        <Tooltip formatter={(value: unknown) => formatCurrency(Number(value))} contentStyle={tooltipStyle} />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        <Area type="monotone" dataKey="inflow" stroke={colors[5]} fill={colors[5]} fillOpacity={0.15} strokeWidth={2} name={t('reports.cashInflow')} />
        <Area type="monotone" dataKey="outflow" stroke={colors[7]} fill={colors[7]} fillOpacity={0.15} strokeWidth={2} name={t('reports.cashOutflow')} />
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
  const ct = useChartTheme();
  const colors = useChartColors();
  const tooltipStyle = useTooltipStyle();
  const chartData = data?.length ? data : [{ date: '-', sales: 0, purchases: 0 }];
  return (
    <ChartCard title={t('reports.charts.salesAndPurchasesTrend')}>
      <LineChart data={chartData}>
        <CartesianGrid strokeDasharray="3 3" stroke={ct.grid} />
        <XAxis dataKey="date" tick={{ fontSize: 10, fill: ct.text }} angle={-30} textAnchor="end" height={50} />
        <YAxis tick={{ fontSize: 11, fill: ct.text }} tickFormatter={(v: number | string) => `${(Number(v) / 1000).toFixed(0)}K`} />
        <Tooltip formatter={(value: unknown) => formatCurrency(Number(value))} contentStyle={tooltipStyle} />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        <Line type="monotone" dataKey="sales" stroke={colors[0]} strokeWidth={2.5} dot={false} name={t('reports.sales')} />
        <Line type="monotone" dataKey="purchases" stroke={colors[1]} strokeWidth={2.5} dot={false} name={t('reports.purchases')} />
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
  const ct = useChartTheme();
  const colors = useChartColors();
  const tooltipStyle = useTooltipStyle();
  const chartData = data?.length ? data : [{ date: '-', profit: 0 }];
  return (
    <ChartCard title={t('reports.charts.profitTrend')}>
      <AreaChart data={chartData}>
        <CartesianGrid strokeDasharray="3 3" stroke={ct.grid} />
        <XAxis dataKey="date" tick={{ fontSize: 10, fill: ct.text }} angle={-30} textAnchor="end" height={50} />
        <YAxis tick={{ fontSize: 11, fill: ct.text }} tickFormatter={(v: number | string) => `${(Number(v) / 1000).toFixed(0)}K`} />
        <Tooltip formatter={(value: unknown) => formatCurrency(Number(value))} contentStyle={tooltipStyle} />
        <Area type="monotone" dataKey="profit" stroke={colors[5]} fill={colors[5]} fillOpacity={0.15} strokeWidth={2} name={t('reports.profit')} />
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
  const ct = useChartTheme();
  const tooltipStyle = useTooltipStyle();

  const chartData = STAGE_ORDER
    .map((s) => {
      const found = (data || []).find((d) => d.stage === s);
      return { stage: t(stageLabelKey(s)), value: found?.value || 0, count: found?.count || 0, rawStage: s };
    })
    .filter((d) => d.count > 0);

  if (chartData.length === 0) {
    return (
      <ChartCard title={t('reports.pipelineByStage')}>
        <div className="h-full flex items-center justify-center text-zinc-400 text-sm">{t('reports.opportunityPipelineNoData')}</div>
      </ChartCard>
    );
  }

  return (
    <ChartCard title={t('reports.pipelineByStage')}>
      <BarChart data={chartData} layout="vertical" margin={{ top: 5, right: 20, left: 20, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={ct.grid} />
        <XAxis type="number" tick={{ fontSize: 11, fill: ct.text }} tickFormatter={(v: number) => `${(v / 1000).toFixed(0)}K`} />
        <YAxis dataKey="stage" type="category" tick={{ fontSize: 11, fill: ct.text }} width={100} />
        <Tooltip
          formatter={(value: unknown, _name: unknown) => [
            `${t('reports.totalValue')}: ${formatCurrency(Number(value))}`,
            '',
          ]}
          contentStyle={tooltipStyle}
        />
        <Bar dataKey="value" radius={[0, 6, 6, 0]}>
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
  const colors = useChartColors();
  const tooltipStyle = useTooltipStyle();
  const chartData = data?.length ? data : [{ name: t('reports.none'), value: 0 }];
  return (
    <ChartCard title={t('reports.charts.inventoryByCategory')}>
      <PieChart>
        <Pie
          data={chartData}
          cx="50%"
          cy="45%"
          outerRadius="80%"
          paddingAngle={3}
          dataKey="value"
          nameKey="name"
        >
          {chartData.map((_, index) => (
            <Cell key={`cell-${index}`} fill={colors[index % colors.length]} />
          ))}
        </Pie>
        <Tooltip formatter={(value: unknown) => formatCurrency(Number(value))} contentStyle={tooltipStyle} />
        <Legend wrapperStyle={{ fontSize: 11 }} verticalAlign="bottom" height={36} iconType="circle" />
      </PieChart>
    </ChartCard>
  );
};
