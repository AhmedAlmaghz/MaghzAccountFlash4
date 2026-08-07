import React, { useState, useEffect } from 'react';
import {
  TrendingUp, TrendingDown, DollarSign, FileText, Package, ShoppingCart, Users, AlertTriangle,
  Calendar, ChevronDown, Download, FilePlus, BookOpen, PlusCircle, UserPlus, RotateCcw, Factory,
  Target, XCircle, Award, BarChart2
} from 'lucide-react';
import { useTranslation } from '@/core/i18n/useTranslation';
import { useAppStore } from '@/core/store';
import { usePermission } from '@/modules/auth/hooks/usePermission';
import { useDashboard, type PeriodFilter, type DashboardFilters, type DashboardData } from './useDashboard';
import {
  MonthlyRevenueChart, TopProductsChart, ArAgingChart, CashFlowChart,
  SalesTrendChart, ProfitTrendChart, CategoryShareChart, OpportunityFunnelChart
} from './charts';
import { KpiCardPro } from '../components/KpiCardPro';
import { EmptyState } from '@/core/ui/components/EmptyState';
import { Link, useNavigate } from 'react-router-dom';
import { exportToPDF } from '@/core/utils/exportEngine';
import { cn, formatCurrency, formatDate } from '@/core/utils';
import { manufacturingApi } from '@/modules/manufacturing/api';
import { purchasesApi } from '@/modules/purchases/api';
import { inventoryApi } from '@/modules/inventory/api';
import { hrApi } from '@/modules/hr/api';

const periodOptions: { key: PeriodFilter; labelKey: string }[] = [
  { key: 'today', labelKey: 'reports.today' },
  { key: 'week', labelKey: 'reports.week' },
  { key: 'month', labelKey: 'reports.month' },
  { key: 'year', labelKey: 'reports.year' },
  { key: 'custom', labelKey: 'reports.custom' },
];

const MainDashboard: React.FC = () => {
  const { t } = useTranslation();
  const canView = usePermission('reports.view');
  const canExport = usePermission('reports.export');
  void canExport;
  const navigate = useNavigate();
  const activeCompany = useAppStore((state) => state.activeCompany);
  const [filters, setFilters] = useState<DashboardFilters>({
    period: 'month',
    comparePrevious: false,
  });
  const [showCustomDate, setShowCustomDate] = useState(false);

  const { data, isLoading } = useDashboard(activeCompany?.id || '', filters);

  const handlePeriodChange = (period: PeriodFilter) => {
    setFilters((prev) => ({ ...prev, period }));
    setShowCustomDate(period === 'custom');
  };

  const handleExportDashboardPdf = async () => {
    if (!data) return;
    const rows = [
      { metric: t('reports.totalRevenue'), value: formatCurrency(data.current.totalRevenue) },
      { metric: t('reports.totalExpenses'), value: formatCurrency(data.current.totalExpenses) },
      { metric: t('reports.netProfit'), value: formatCurrency(data.current.netProfit) },
      { metric: t('reports.invoicesCount'), value: data.current.invoicesCount },
      { metric: t('reports.productsCount'), value: data.current.productsCount },
      { metric: t('reports.customersCount'), value: data.current.customersCount },
    ];
    await exportToPDF(rows, [
      { key: 'metric', header: t('reports.kpiMetric'), width: 30 },
      { key: 'value', header: t('reports.kpiValue'), width: 20 },
    ], `Dashboard_${formatDate(new Date())}`, {
      title: t('sidebar.dashboard'),
      subtitle: activeCompany?.name || t('reports.defaultCompany'),
      companyName: activeCompany?.name,
      rtl: true,
    });
  };

  const current = data?.current;
  const previous = data?.previous;

  const computeChange = (curr: number, prev?: number) => {
    if (!prev || prev === 0) return null;
    const pct = Math.round(((curr - prev) / prev) * 100);
    return { value: `${Math.abs(pct)}%`, trend: pct >= 0 ? ('up' as const) : ('down' as const) };
  };

  if (!canView) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center">
          <BarChart2 size={48} className="mx-auto mb-4 text-slate-400" />
          <p className="text-lg font-medium text-slate-700 dark:text-slate-200">{t('reports.noPermission')}</p>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600" />
      </div>
    );
  }

  if (!current) {
    return (
      <EmptyState
        icon="inbox"
        title={t('reports.noData')}
        description={t('reports.dashboard.noDataDesc')}
        action={
          <button
            onClick={() => setFilters({ period: 'month', comparePrevious: false })}
            className="btn btn-primary"
          >
            <RotateCcw size={16} className="ml-2" />
            {t('reports.resetFilters')}
          </button>
        }
      />
    );
  }

  const revenueChange = computeChange(current.totalRevenue, previous?.totalRevenue);
  const expensesChange = computeChange(current.totalExpenses, previous?.totalExpenses);
  const profitChange = computeChange(current.netProfit, previous?.netProfit);

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">{t('sidebar.dashboard')}</h1>
          <p className="text-slate-500 dark:text-slate-400 text-sm mt-1">{t('dashboard.subtitle')}</p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          {/* Period selector */}
          <div className="relative">
            <button
              className="flex items-center gap-2 px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
              onClick={() => setShowCustomDate((s) => !s)}
            >
              <Calendar size={16} />
              <span>{t(`reports.${filters.period}`)}</span>
              <ChevronDown size={14} />
            </button>
            {showCustomDate && filters.period === 'custom' && (
              <div className="absolute z-20 mt-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-lg p-3 w-64 rtl:right-0 ltr:left-0">
                <div className="space-y-2">
                  <label className="text-xs text-slate-500">{t('reports.fromDate')}</label>
                  <input
                    type="date"
                    className="w-full px-2 py-1.5 text-sm border rounded-md dark:bg-slate-900 dark:border-slate-600"
                    value={filters.dateRange?.from || ''}
                    onChange={(e) =>
                      setFilters((p) => ({ ...p, dateRange: { ...p.dateRange, from: e.target.value } }))
                    }
                  />
                  <label className="text-xs text-slate-500">{t('reports.toDate')}</label>
                  <input
                    type="date"
                    className="w-full px-2 py-1.5 text-sm border rounded-md dark:bg-slate-900 dark:border-slate-600"
                    value={filters.dateRange?.to || ''}
                    onChange={(e) =>
                      setFilters((p) => ({ ...p, dateRange: { ...p.dateRange, to: e.target.value } }))
                    }
                  />
                </div>
              </div>
            )}
          </div>

          {/* Period chips */}
          <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 rounded-lg p-1">
            {periodOptions.map((opt) => (
              <button
                key={opt.key}
                onClick={() => handlePeriodChange(opt.key)}
                className={cn(
                  'px-3 py-1.5 text-xs font-medium rounded-md transition-colors',
                  filters.period === opt.key
                    ? 'bg-white dark:bg-slate-700 text-primary-600 dark:text-primary-400 shadow-sm'
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
                )}
              >
                {t(opt.labelKey)}
              </button>
            ))}
          </div>

          {/* Compare toggle */}
          <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300 cursor-pointer select-none">
            <input
              type="checkbox"
              className="w-4 h-4 rounded border-slate-300 text-primary-600 focus:ring-primary-500"
              checked={filters.comparePrevious}
              onChange={(e) => setFilters((p) => ({ ...p, comparePrevious: e.target.checked }))}
            />
            {t('reports.comparePrevious')}
          </label>

          <button
            onClick={handleExportDashboardPdf}
            disabled={!canExport}
            className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            title={t('reports.exportDashboardPdf')}
          >
            <Download size={16} />
            PDF
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCardPro
          title={t('reports.totalRevenue')}
          value={formatCurrency(current.totalRevenue)}
          icon={TrendingUp}
          color="emerald"
          onClick={() => navigate('/sales/invoices')}
          trend={revenueChange?.trend}
          change={revenueChange?.value}
          changeLabel={filters.comparePrevious ? t('reports.previousPeriod') : undefined}
        />
        <KpiCardPro
          title={t('reports.totalExpenses')}
          value={formatCurrency(current.totalExpenses)}
          icon={TrendingDown}
          color="rose"
          onClick={() => navigate('/accounting/profit-loss')}
          trend={expensesChange?.trend}
          change={expensesChange?.value}
          changeLabel={filters.comparePrevious ? t('reports.previousPeriod') : undefined}
        />
        <KpiCardPro
          title={t('reports.netProfit')}
          value={formatCurrency(current.netProfit)}
          icon={DollarSign}
          color="blue"
          onClick={() => navigate('/reports/profit-analysis')}
          trend={profitChange?.trend}
          change={profitChange?.value}
          changeLabel={filters.comparePrevious ? t('reports.previousPeriod') : undefined}
        />
        <KpiCardPro
          title={t('reports.invoicesCount')}
          value={current.invoicesCount}
          icon={FileText}
          color="purple"
          onClick={() => navigate('/sales/invoices')}
        />
        <KpiCardPro
          title={t('reports.productsCount')}
          value={current.productsCount}
          icon={Package}
          color="amber"
          onClick={() => navigate('/inventory/products')}
        />
        <KpiCardPro
          title={t('reports.customersCount')}
          value={current.customersCount}
          icon={Users}
          color="slate"
          onClick={() => navigate('/sales/customers')}
        />
        <KpiCardPro
          title={t('reports.suppliersCount')}
          value={current.suppliersCount}
          icon={ShoppingCart}
          color="slate"
          onClick={() => navigate('/purchases/suppliers')}
        />
        <KpiCardPro
          title={t('reports.employeesCount')}
          value={current.employeesCount}
          icon={Users}
          color="slate"
          onClick={() => navigate('/hr/employees')}
        />
      </div>

      {/* Charts Row 1 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <MonthlyRevenueChart data={current.monthlyRevenue} />
        <TopProductsChart data={current.topProducts} />
      </div>

      {/* Charts Row 2 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ArAgingChart data={current.arAging} />
        <CashFlowChart data={current.cashFlow} />
      </div>

      {/* Charts Row 3 - Advanced */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <SalesTrendChart data={current.salesTrend} />
        <ProfitTrendChart data={current.profitTrend} />
        <CategoryShareChart data={current.categoryShare} />
      </div>

      {/* Manufacturing KPIs */}
      <ManufacturingKpiSection companyId={activeCompany?.id || ''} />

      {/* Purchases KPIs */}
      <PurchasesKpiSection companyId={activeCompany?.id || ''} />

      {/* Inventory KPIs */}
      <InventoryKpiSection companyId={activeCompany?.id || ''} />

      {/* HR KPIs */}
      <HrKpiSection companyId={activeCompany?.id || ''} />

      {/* CRM KPIs */}
      <CrmKpiSection data={current} />

      {/* CRM Pipeline Funnel Chart */}
      <div className="grid grid-cols-1 gap-4">
        <OpportunityFunnelChart data={current.pipelineByStage} />
      </div>

      {/* Alerts & Quick Actions */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4 shadow-sm">
          <div className="flex items-center gap-2 mb-4">
            <AlertTriangle size={18} className="text-amber-500" />
            <h3 className="font-semibold text-slate-900 dark:text-slate-50">{t('reports.alerts')}</h3>
          </div>
          <div className="space-y-2">
            <AlertItem
              icon={Package}
              color="amber"
              text={t('reports.lowStock')}
              count={current.lowStockCount}
              link="/inventory/products"
            />
            <AlertItem
              icon={FileText}
              color="blue"
              text={t('reports.overdueInvoices')}
              count={current.overdueInvoicesCount}
              link="/sales/invoices"
            />
            <AlertItem
              icon={AlertTriangle}
              color="rose"
              text={t('reports.overdueDebts')}
              count={current.arAging[3]?.amount ? Math.floor(current.arAging[3].amount / 100000) : 0}
              link="/reports/customer-statement"
            />
            <AlertItem
              icon={Users}
              color="purple"
              text={t('reports.employeesCount')}
              count={current.employeesCount}
              link="/hr/employees"
            />
          </div>
        </div>

        <div className="lg:col-span-2 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4 shadow-sm">
          <div className="flex items-center gap-2 mb-4">
            <PlusCircle size={18} className="text-primary-600" />
            <h3 className="font-semibold text-slate-900 dark:text-slate-50">{t('reports.quickActions')}</h3>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <QuickActionButton
              label={t('reports.newInvoice')}
              icon={FilePlus}
              color="bg-blue-500 hover:bg-blue-600"
              link="/sales/invoices"
            />
            <QuickActionButton
              label={t('reports.newJournalEntry')}
              icon={BookOpen}
              color="bg-emerald-500 hover:bg-emerald-600"
              link="/accounting/journal"
            />
            <QuickActionButton
              label={t('reports.newProduct')}
              icon={PlusCircle}
              color="bg-amber-500 hover:bg-amber-600"
              link="/inventory/products"
            />
            <QuickActionButton
              label={t('reports.newCustomer')}
              icon={UserPlus}
              color="bg-purple-500 hover:bg-purple-600"
              link="/sales/customers"
            />
          </div>
        </div>
      </div>
    </div>
  );
};

function ManufacturingKpiSection({ companyId }: { companyId: string }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [kpis, setKpis] = useState<{ totalWorkOrders: number; activeOrders: number; completedOrders: number; totalProductionCost: number } | null>(null);

  useEffect(() => {
    if (!companyId) return;
    let cancelled = false;
    manufacturingApi.getManufacturingKpis(companyId).then((res) => {
      if (!cancelled && res.success && res.data) setKpis(res.data);
    });
    return () => { cancelled = true; };
  }, [companyId]);

  if (!kpis) return null;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Factory size={18} className="text-primary-600" />
        <h2 className="font-semibold text-slate-900 dark:text-slate-50">{t('manufacturing.production')}</h2>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCardPro title={t('manufacturing.workOrders')} value={kpis.totalWorkOrders} icon={Factory} color="blue" onClick={() => navigate('/manufacturing/work-orders')} />
        <KpiCardPro title={t('manufacturing.planned')} value={kpis.activeOrders} icon={Factory} color="purple" onClick={() => navigate('/manufacturing/work-orders')} />
        <KpiCardPro title={t('manufacturing.completed')} value={kpis.completedOrders} icon={TrendingUp} color="emerald" onClick={() => navigate('/manufacturing/work-orders')} />
        <KpiCardPro title={t('manufacturing.costs')} value={formatCurrency(kpis.totalProductionCost)} icon={DollarSign} color="amber" onClick={() => navigate('/manufacturing/cost-report')} />
      </div>
    </div>
  );
}

function PurchasesKpiSection({ companyId }: { companyId: string }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [kpis, setKpis] = useState<{ totalOrders: number; pendingOrders: number; totalInvoicesValue: number; apOutstanding: number } | null>(null);

  useEffect(() => {
    if (!companyId) return;
    let cancelled = false;
    purchasesApi.getPurchasesKpis(companyId).then((res) => {
      if (!cancelled && res.success && res.data) setKpis(res.data);
    });
    return () => { cancelled = true; };
  }, [companyId]);

  if (!kpis) return null;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <ShoppingCart size={18} className="text-primary-600" />
        <h2 className="font-semibold text-slate-900 dark:text-slate-50">{t('purchases.tabs.invoices')}</h2>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCardPro title={t('purchases.ordersCount')} value={kpis.totalOrders} icon={ShoppingCart} color="blue" onClick={() => navigate('/purchases/orders')} />
        <KpiCardPro title={t('purchases.pendingOrders')} value={kpis.pendingOrders} icon={ShoppingCart} color="amber" onClick={() => navigate('/purchases/orders')} />
        <KpiCardPro title={t('purchases.totalPurchasesValue')} value={formatCurrency(kpis.totalInvoicesValue)} icon={DollarSign} color="emerald" onClick={() => navigate('/purchases/invoices')} />
        <KpiCardPro title={t('purchases.apOutstanding')} value={formatCurrency(kpis.apOutstanding)} icon={TrendingUp} color="rose" onClick={() => navigate('/purchases/invoices')} />
      </div>
    </div>
  );
}

function InventoryKpiSection({ companyId }: { companyId: string }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [kpis, setKpis] = useState<{ stockValue: number; lowStockItems: number; warehouseCount: number; stockMovementsCount: number } | null>(null);

  useEffect(() => {
    if (!companyId) return;
    let cancelled = false;
    inventoryApi.getInventoryKpis(companyId).then((res) => {
      if (!cancelled && res.success && res.data) setKpis(res.data);
    });
    return () => { cancelled = true; };
  }, [companyId]);

  if (!kpis) return null;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Package size={18} className="text-primary-600" />
        <h2 className="font-semibold text-slate-900 dark:text-slate-50">{t('inventory.stock')}</h2>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCardPro title={t('inventory.stockValue')} value={formatCurrency(kpis.stockValue)} icon={Package} color="blue" onClick={() => navigate('/inventory/products')} />
        <KpiCardPro title={t('inventory.lowStock')} value={kpis.lowStockItems} icon={AlertTriangle} color="rose" onClick={() => navigate('/inventory/products')} />
        <KpiCardPro title={t('inventory.warehouseCount')} value={kpis.warehouseCount} icon={Package} color="amber" onClick={() => navigate('/inventory/warehouses')} />
        <KpiCardPro title={t('inventory.stockMovementsCount')} value={kpis.stockMovementsCount} icon={Package} color="purple" onClick={() => navigate('/inventory/transactions')} />
      </div>
    </div>
  );
}

function HrKpiSection({ companyId }: { companyId: string }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [kpis, setKpis] = useState<{ totalEmployees: number; activeEmployees: number; pendingLeaves: number; totalPayrollAmount: number } | null>(null);

  useEffect(() => {
    if (!companyId) return;
    let cancelled = false;
    hrApi.getHrKpis(companyId).then((res) => {
      if (!cancelled && res.success && res.data) setKpis(res.data);
    });
    return () => { cancelled = true; };
  }, [companyId]);

  if (!kpis) return null;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Users size={18} className="text-primary-600" />
        <h2 className="font-semibold text-slate-900 dark:text-slate-50">{t('hr.employees')}</h2>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCardPro title={t('hr.employees')} value={kpis.totalEmployees} icon={Users} color="blue" onClick={() => navigate('/hr/employees')} />
        <KpiCardPro title={t('hr.activeEmployees')} value={kpis.activeEmployees} icon={Users} color="emerald" onClick={() => navigate('/hr/employees')} />
        <KpiCardPro title={t('hr.pendingLeaves')} value={kpis.pendingLeaves} icon={Calendar} color="amber" onClick={() => navigate('/hr/leaves')} />
        <KpiCardPro title={t('hr.totalPayroll')} value={formatCurrency(kpis.totalPayrollAmount)} icon={DollarSign} color="purple" onClick={() => navigate('/hr/payroll')} />
      </div>
    </div>
  );
}

function CrmKpiSection({ data }: { data: DashboardData }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  if (!data) return null;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Target size={18} className="text-primary-600" />
        <h2 className="font-semibold text-slate-900 dark:text-slate-50">{t('crm.title')}</h2>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCardPro title={t('reports.totalLeads')} value={data.crmLeadsCount} icon={Users} color="blue" onClick={() => navigate('/crm/leads')} />
        <KpiCardPro title={t('reports.pipelineValue')} value={formatCurrency(data.crmPipelineValue)} icon={TrendingUp} color="emerald" onClick={() => navigate('/crm/opportunities')} />
        <KpiCardPro title={t('reports.conversionRate')} value={`${data.crmConversionRate}%`} icon={Target} color="purple" onClick={() => navigate('/reports/lead-conversion')} />
        <KpiCardPro title={t('reports.wonDeals')} value={data.crmWonDealsCount} icon={Award} color="emerald" onClick={() => navigate('/crm/opportunities')} />
        <KpiCardPro title={t('reports.lostDeals')} value={data.crmLostDealsCount} icon={XCircle} color="rose" onClick={() => navigate('/crm/opportunities')} />
        <KpiCardPro title={t('reports.avgDealValue')} value={formatCurrency(data.crmAvgDealValue)} icon={DollarSign} color="amber" onClick={() => navigate('/crm/opportunities')} />
        <KpiCardPro title={t('reports.totalOpportunities')} value={data.crmOpportunitiesCount} icon={Target} color="purple" onClick={() => navigate('/crm/opportunities')} />
      </div>
    </div>
  );
}

function AlertItem({
  icon: Icon,
  color,
  text,
  count,
  link,
}: {
  icon: React.ComponentType<{ className?: string; size?: number }>;
  color: string;
  text: string;
  count: number;
  link: string;
}) {
  const colorClasses: Record<string, string> = {
    amber: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
    blue: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
    purple: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
    rose: 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400',
  };

  return (
    <Link
      to={link}
      className="flex items-center gap-3 p-2.5 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors"
    >
      <div className={`w-8 h-8 rounded-full flex items-center justify-center ${colorClasses[color]}`}>
        <Icon size={14} />
      </div>
      <div className="flex-1">
        <p className="text-sm font-medium text-slate-700 dark:text-slate-200">{text}</p>
      </div>
      <span className="text-sm font-bold text-slate-900 dark:text-slate-50 tabular-nums">{count}</span>
    </Link>
  );
}

function QuickActionButton({
  label,
  icon: Icon,
  color,
  link,
}: {
  label: string;
  icon: React.ComponentType<{ className?: string; size?: number }>;
  color: string;
  link: string;
}) {
  return (
    <Link
      to={link}
      className={`${color} text-white py-3 px-4 rounded-lg text-sm font-medium transition-colors flex flex-col items-center gap-2`}
    >
      <Icon size={20} />
      <span>{label}</span>
    </Link>
  );
}

export default MainDashboard;
