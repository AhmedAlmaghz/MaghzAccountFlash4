import React, { useMemo } from 'react';
import { Outlet, Link, useLocation } from 'react-router-dom';
import { GitBranch, Wrench, BarChart3, TrendingDown, Factory, Sparkles } from 'lucide-react';
import { cn } from '@/core/utils';
import { useTranslation } from '@/core/i18n/useTranslation';
import { Card } from '@/core/ui/components';
import { useAppStore } from '@/core/store';
import { useBomsPaginated, useWorkOrdersPaginated } from '../hooks/useManufacturing';

export const ManufacturingPage: React.FC = () => {
  const { t } = useTranslation();
  const location = useLocation();
  const isRoot = location.pathname === '/manufacturing';
  const activeCompany = useAppStore((s) => s.activeCompany);
  const companyId = activeCompany?.id || '';

  const { total: workOrdersTotal } = useWorkOrdersPaginated(companyId, {});
  const { total: bomsTotal, items: bomItems } = useBomsPaginated(companyId);
  const activeBoms = useMemo(() => bomItems.filter((b) => b.isActive).length, [bomItems]);

  const mfgMenu: Array<{ id: string; label: string; desc: string; icon: React.ElementType; path: string; color: string; bg: string; count: number | null }> = [
    { id: 'work-orders', label: t('manufacturing.tabs.workOrders'), desc: 'أوامر التشغيل ومتابعة مراحل الإنتاج والتكاليف', icon: Wrench, path: '/manufacturing/work-orders', color: 'from-teal-600 to-teal-700', bg: 'bg-teal-50 dark:bg-teal-900/20', count: workOrdersTotal },
    { id: 'bom', label: t('manufacturing.tabs.boms'), desc: 'فاتير المواد ومكونات المنتجات وتكاليفها', icon: GitBranch, path: '/manufacturing/bom', color: 'from-cyan-600 to-cyan-700', bg: 'bg-cyan-50 dark:bg-cyan-900/20', count: bomsTotal },
    { id: 'cost-report', label: t('manufacturing.tabs.costReport'), desc: 'تحليل تكاليف الإنتاج الفعلية مقابل المخططة', icon: BarChart3, path: '/manufacturing/cost-report', color: 'from-blue-600 to-blue-700', bg: 'bg-blue-50 dark:bg-blue-900/20', count: null },
    { id: 'variance-report', label: t('manufacturing.tabs.varianceReport'), desc: 'انحرافات الكمية والتكلفة وأسبابها الجذرية', icon: TrendingDown, path: '/manufacturing/variance-report', color: 'from-amber-600 to-orange-600', bg: 'bg-amber-50 dark:bg-amber-900/20', count: null },
  ];

  return (
    <div className="space-y-5 animate-fade-in">
      {isRoot ? (
        <>
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-teal-600 to-teal-700 flex items-center justify-center shadow-sm">
              <Factory size={22} className="text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50 tracking-tight">{t('manufacturing.page.title')}</h1>
              <p className="text-sm text-slate-500 dark:text-slate-400">{t('manufacturing.page.subtitle')}</p>
            </div>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Card className="p-4 flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold tracking-wider uppercase text-slate-500">{t('manufacturing.tabs.workOrders')}</p>
                <p className="text-2xl font-bold text-slate-900 dark:text-slate-50 tabular-nums">{workOrdersTotal}</p>
                <p className="text-xs text-slate-500">إجمالي أوامر التشغيل</p>
              </div>
              <div className="w-10 h-10 rounded-xl bg-teal-50 dark:bg-teal-900/20 flex items-center justify-center">
                <Wrench size={18} className="text-teal-600" />
              </div>
            </Card>
            <Card className="p-4 flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold tracking-wider uppercase text-slate-500">{t('manufacturing.tabs.boms')}</p>
                <p className="text-2xl font-bold text-cyan-600 tabular-nums">{bomsTotal}</p>
                <p className="text-xs text-slate-500">فاتير مواد مسجلة</p>
              </div>
              <div className="w-10 h-10 rounded-xl bg-cyan-50 dark:bg-cyan-900/20 flex items-center justify-center">
                <GitBranch size={18} className="text-cyan-600" />
              </div>
            </Card>
            <Card className="p-4 flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold tracking-wider uppercase text-slate-500">فاتير نشطة</p>
                <p className="text-2xl font-bold text-emerald-600 tabular-nums">{activeBoms}</p>
                <p className="text-xs text-slate-500">جاهزة للتنفيذ (بالصفحة الحالية)</p>
              </div>
              <div className="w-10 h-10 rounded-xl bg-emerald-50 dark:bg-emerald-900/20 flex items-center justify-center">
                <GitBranch size={18} className="text-emerald-600" />
              </div>
            </Card>
            <Card className="p-4 flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold tracking-wider uppercase text-slate-500">التقارير</p>
                <p className="text-2xl font-bold text-blue-600 tabular-nums">2</p>
                <p className="text-xs text-slate-500">تكاليف وانحرافات</p>
              </div>
              <div className="w-10 h-10 rounded-xl bg-blue-50 dark:bg-blue-900/20 flex items-center justify-center">
                <BarChart3 size={18} className="text-blue-600" />
              </div>
            </Card>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {mfgMenu.map((item) => {
              const Icon = item.icon;
              return (
                <Link
                  key={item.id}
                  to={item.path}
                  className="group relative overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5 hover:shadow-lg hover:border-teal-200 dark:hover:border-teal-800 transition-all"
                >
                  <div className={`absolute top-0 right-0 w-24 h-24 bg-gradient-to-br ${item.color} opacity-[0.06] group-hover:opacity-[0.1] rounded-bl-full transition`} />
                  <div className="flex items-start justify-between">
                    <div className={`w-11 h-11 rounded-xl ${item.bg} border border-slate-200 dark:border-slate-700 flex items-center justify-center group-hover:scale-105 transition`}>
                      <Icon size={20} className="text-slate-700 dark:text-slate-300" />
                    </div>
                    {item.count !== null && (
                      <span className="text-xs font-bold tabular-nums bg-slate-900 dark:bg-slate-800 text-white px-2.5 py-1 rounded-full">
                        {item.count}
                      </span>
                    )}
                  </div>
                  <h3 className="mt-4 font-bold text-slate-900 dark:text-slate-50">{item.label}</h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">{item.desc}</p>
                  <div className="mt-4 flex items-center gap-1 text-xs font-medium text-teal-600 dark:text-teal-400 group-hover:gap-2 transition-all">
                    فتح <span aria-hidden>←</span>
                  </div>
                </Link>
              );
            })}
          </div>

          <Card className="p-4 bg-gradient-to-r from-teal-600 to-teal-700 text-white border-0">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-white/15 flex items-center justify-center">
                <Sparkles size={18} className="text-white" />
              </div>
              <div>
                <p className="font-semibold">نصائح التصنيع</p>
                <p className="text-sm text-white/80">عرّف فاتير المواد (BOM) لكل منتج أولاً، ثم أنشئ أوامر التشغيل منها لترحيل المواد تلقائياً. راقب الانحرافات بين الكميات المخططة والفعلية لتقليل الهدر، وحلّل تكاليف الإنتاج دورياً.</p>
              </div>
            </div>
          </Card>
        </>
      ) : (
        <>
          <div className="flex items-center gap-1.5 border-b border-slate-200 dark:border-slate-800 pb-2 overflow-x-auto -mx-1 px-1">
            {mfgMenu.map((item) => {
              const Icon = item.icon;
              const isActive = location.pathname === item.path;
              return (
                <Link
                  key={item.id}
                  to={item.path}
                  className={cn(
                    'flex items-center gap-2 px-3.5 py-2 rounded-full text-sm font-medium transition whitespace-nowrap border',
                    isActive
                      ? 'bg-slate-900 dark:bg-white text-white dark:text-slate-900 border-slate-900 dark:border-white shadow-sm'
                      : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800',
                  )}
                >
                  <Icon size={14} />
                  {item.label}
                </Link>
              );
            })}
          </div>
          <Outlet />
        </>
      )}
    </div>
  );
};

export default ManufacturingPage;
