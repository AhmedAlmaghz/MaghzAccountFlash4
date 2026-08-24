import React from 'react';
import { BarChart2, PieChart, TrendingUp, Package, Users, Truck, Settings, AlertTriangle, ArrowRightLeft, Coins, Filter, Funnel } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useTranslation } from '@/core/i18n/useTranslation';
import { usePermission } from '@/modules/auth/hooks/usePermission';

const reportModules = [
  {
    id: 'sales-analysis',
    titleKey: 'reports.salesAnalysis',
    descriptionKey: 'reports.hub.salesAnalysis.desc',
    icon: TrendingUp,
    color: 'from-blue-600 to-blue-700',
    bg: 'bg-blue-50 dark:bg-blue-900/20',
    path: '/reports/sales-analysis',
  },
  {
    id: 'inventory-analysis',
    titleKey: 'reports.inventoryAnalysis',
    descriptionKey: 'reports.hub.inventoryAnalysis.desc',
    icon: Package,
    color: 'from-amber-600 to-amber-700',
    bg: 'bg-amber-50 dark:bg-amber-900/20',
    path: '/reports/inventory-analysis',
  },
  {
    id: 'low-stock-alert',
    titleKey: 'reports.lowStockAlert',
    descriptionKey: 'reports.hub.lowStockAlert.desc',
    icon: AlertTriangle,
    color: 'from-orange-600 to-orange-700',
    bg: 'bg-orange-50 dark:bg-orange-900/20',
    path: '/reports/low-stock-alert',
  },
  {
    id: 'stock-movement',
    titleKey: 'reports.stockMovement',
    descriptionKey: 'reports.hub.stockMovement.desc',
    icon: ArrowRightLeft,
    color: 'from-teal-600 to-teal-700',
    bg: 'bg-teal-50 dark:bg-teal-900/20',
    path: '/reports/stock-movement',
  },
  {
    id: 'stock-valuation',
    titleKey: 'reports.stockValuation',
    descriptionKey: 'reports.hub.stockValuation.desc',
    icon: Coins,
    color: 'from-cyan-600 to-cyan-700',
    bg: 'bg-cyan-50 dark:bg-cyan-900/20',
    path: '/reports/stock-valuation',
  },
  {
    id: 'customer-statement',
    titleKey: 'reports.customerStatement',
    descriptionKey: 'reports.hub.customerStatement.desc',
    icon: Users,
    color: 'from-emerald-600 to-emerald-700',
    bg: 'bg-emerald-50 dark:bg-emerald-900/20',
    path: '/reports/customer-statement',
  },
  {
    id: 'supplier-statement',
    titleKey: 'reports.supplierStatement',
    descriptionKey: 'reports.hub.supplierStatement.desc',
    icon: Truck,
    color: 'from-purple-600 to-purple-700',
    bg: 'bg-purple-50 dark:bg-purple-900/20',
    path: '/reports/supplier-statement',
  },
  {
    id: 'profit-analysis',
    titleKey: 'reports.profitAnalysis',
    descriptionKey: 'reports.hub.profitAnalysis.desc',
    icon: PieChart,
    color: 'from-rose-600 to-rose-700',
    bg: 'bg-rose-50 dark:bg-rose-900/20',
    path: '/reports/profit-analysis',
  },
  {
    id: 'custom-builder',
    titleKey: 'reports.customReportBuilder',
    descriptionKey: 'reports.hub.customReportBuilder.desc',
    icon: Settings,
    color: 'from-slate-600 to-slate-700',
    bg: 'bg-slate-100 dark:bg-slate-800',
    path: '/reports/custom-builder',
  },
  {
    id: 'lead-conversion',
    titleKey: 'reports.leadConversion',
    descriptionKey: 'reports.hub.leadConversion.desc',
    icon: Filter,
    color: 'from-violet-600 to-violet-700',
    bg: 'bg-violet-50 dark:bg-violet-900/20',
    path: '/reports/lead-conversion',
  },
  {
    id: 'opportunity-pipeline',
    titleKey: 'reports.opportunityPipeline',
    descriptionKey: 'reports.hub.opportunityPipeline.desc',
    icon: Funnel,
    color: 'from-pink-600 to-pink-700',
    bg: 'bg-pink-50 dark:bg-pink-900/20',
    path: '/reports/opportunity-pipeline',
  },
  {
    id: 'financial-overview',
    titleKey: 'accounting.balanceSheet.title',
    descriptionKey: 'reports.hub.financialOverview.desc',
    icon: BarChart2,
    color: 'from-indigo-600 to-indigo-700',
    bg: 'bg-indigo-50 dark:bg-indigo-900/20',
    path: '/accounting/balance',
  },
];

export const ReportsHubPage: React.FC = () => {
  const { t } = useTranslation();
  const canView = usePermission('reports.view');
  const canCustom = usePermission('reports.custom');

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

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Gradient Header */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-blue-700 via-blue-600 to-indigo-600 shadow-xl shadow-blue-900/10 dark:shadow-blue-900/20">
        <div className="absolute top-0 right-0 w-48 h-48 opacity-15 bg-white rounded-full -translate-y-1/3 translate-x-1/4" />
        <div className="absolute bottom-0 left-0 w-24 h-24 opacity-10 bg-white rounded-full translate-y-1/3 -translate-x-1/4" />
        <div className="relative px-6 py-10 sm:px-8 sm:py-12 text-white">
          <div className="flex items-center gap-3 mb-3">
            <span className="inline-flex items-center gap-1.5 text-xs font-medium tracking-wide text-blue-100 bg-white/10 px-2.5 py-1 rounded-full backdrop-blur-sm border border-white/10">
              <BarChart2 size={12} /> {t('sidebar.reports')}
            </span>
            <span className="inline-flex items-center gap-1 text-xs font-medium tracking-wide text-blue-100/60">{reportModules.length} تقارير متاحة</span>
          </div>
          <h2 className="text-3xl font-extrabold tracking-tight mb-2">{t('sidebar.reports')}</h2>
          <p className="text-blue-100/80 text-base max-w-lg">{t('reports.hub.subtitle')}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {reportModules.map((module) => {
          // Hide the custom builder if user lacks reports.custom permission
          if (module.id === 'custom-builder' && !canCustom) return null;
          const Icon = module.icon;
          return (
            <Link key={module.id} to={module.path} className="group block">
              <div className="relative overflow-hidden h-full rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5 hover:shadow-lg hover:border-blue-200 dark:hover:border-blue-800 transition-all cursor-pointer">
                <div className={`absolute top-0 right-0 w-24 h-24 bg-gradient-to-br ${module.color} opacity-[0.06] group-hover:opacity-[0.12] rounded-bl-full transition`} />
                <div className="flex items-start gap-4">
                  <div className={`w-12 h-12 shrink-0 rounded-xl ${module.bg} border border-slate-200 dark:border-slate-700 flex items-center justify-center group-hover:scale-105 transition`}>
                    <Icon size={22} className="text-slate-700 dark:text-slate-300" />
                  </div>
                  <div className="min-w-0">
                    <h3 className="font-bold text-slate-900 dark:text-slate-50 truncate">{t(module.titleKey)}</h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 leading-relaxed line-clamp-2">{t(module.descriptionKey)}</p>
                  </div>
                </div>
                <div className="mt-4 flex items-center gap-1 text-xs font-medium text-blue-600 dark:text-blue-400 group-hover:gap-2 transition-all">
                  فتح التقرير <span aria-hidden>←</span>
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
};

export default ReportsHubPage;
