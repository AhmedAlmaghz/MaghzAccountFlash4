import React, { useMemo } from 'react';
import { Outlet, Link, useLocation } from 'react-router-dom';
import { FileText, ClipboardList, Store, Undo2, ShoppingCart, Sparkles } from 'lucide-react';
import { cn } from '@/core/utils';
import { useTranslation } from '@/core/i18n/useTranslation';
import { Card } from '@/core/ui/components';
import { useAppStore } from '@/core/store';
import { usePurchaseInvoicesPaginated, useSuppliersPaginated, usePurchaseOrdersPaginated, usePurchaseReturnsPaginated } from '../hooks/usePurchases';

export const PurchasesPage: React.FC = () => {
  const { t } = useTranslation();
  const location = useLocation();
  const isRoot = location.pathname === '/purchases';
  const activeCompany = useAppStore((s) => s.activeCompany);
  const companyId = activeCompany?.id || '';

  const { total: invoicesTotal } = usePurchaseInvoicesPaginated(companyId, {});
  const { total: suppliersTotal } = useSuppliersPaginated(companyId, {});
  const { total: ordersTotal } = usePurchaseOrdersPaginated(companyId, {});
  const { total: returnsTotal } = usePurchaseReturnsPaginated(companyId, {});

  const stats = useMemo(() => ({
    invoices: invoicesTotal,
    suppliers: suppliersTotal,
    orders: ordersTotal,
    returns: returnsTotal,
  }), [invoicesTotal, suppliersTotal, ordersTotal, returnsTotal]);

  const purchasesMenu: Array<{ id: string; label: string; desc: string; icon: React.ElementType; path: string; color: string; bg: string; count: number | null }> = [
    { id: 'invoices', label: t('purchases.tabs.invoices'), desc: 'فواتير الموردين والضريبة والمدفوعات', icon: FileText, path: '/purchases/invoices', color: 'from-indigo-600 to-indigo-700', bg: 'bg-indigo-50 dark:bg-indigo-900/20', count: stats.invoices },
    { id: 'orders', label: t('purchases.tabs.orders'), desc: 'أوامر الشراء والتحويل إلى فواتير', icon: ClipboardList, path: '/purchases/orders', color: 'from-blue-600 to-blue-700', bg: 'bg-blue-50 dark:bg-blue-900/20', count: stats.orders },
    { id: 'suppliers', label: t('purchases.tabs.suppliers'), desc: 'بيانات الموردين وكشوف الحسابات والذمم', icon: Store, path: '/purchases/suppliers', color: 'from-emerald-600 to-emerald-700', bg: 'bg-emerald-50 dark:bg-emerald-900/20', count: stats.suppliers },
    { id: 'returns', label: t('purchases.tabs.returns'), desc: 'مردودات المشتريات والأثر المخزني والمحاسبي', icon: Undo2, path: '/purchases/returns', color: 'from-amber-600 to-orange-600', bg: 'bg-amber-50 dark:bg-amber-900/20', count: stats.returns },
  ];

  return (
    <div className="space-y-5 animate-fade-in">
      {isRoot ? (
        <>
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-indigo-600 to-indigo-700 flex items-center justify-center shadow-sm">
              <ShoppingCart size={22} className="text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50 tracking-tight">{t('purchases.page.title')}</h1>
              <p className="text-sm text-slate-500 dark:text-slate-400">{t('purchases.page.subtitle')}</p>
            </div>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Card className="p-4 flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold tracking-wider uppercase text-slate-500">{t('purchases.tabs.invoices')}</p>
                <p className="text-2xl font-bold text-slate-900 dark:text-slate-50 tabular-nums">{stats.invoices}</p>
                <p className="text-xs text-slate-500">إجمالي فواتير المشتريات</p>
              </div>
              <div className="w-10 h-10 rounded-xl bg-indigo-50 dark:bg-indigo-900/20 flex items-center justify-center">
                <FileText size={18} className="text-indigo-600" />
              </div>
            </Card>
            <Card className="p-4 flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold tracking-wider uppercase text-slate-500">{t('purchases.tabs.orders')}</p>
                <p className="text-2xl font-bold text-blue-600 tabular-nums">{stats.orders}</p>
                <p className="text-xs text-slate-500">أوامر شراء نشطة</p>
              </div>
              <div className="w-10 h-10 rounded-xl bg-blue-50 dark:bg-blue-900/20 flex items-center justify-center">
                <ClipboardList size={18} className="text-blue-600" />
              </div>
            </Card>
            <Card className="p-4 flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold tracking-wider uppercase text-slate-500">{t('purchases.tabs.suppliers')}</p>
                <p className="text-2xl font-bold text-emerald-600 tabular-nums">{stats.suppliers}</p>
                <p className="text-xs text-slate-500">قاعدة الموردين</p>
              </div>
              <div className="w-10 h-10 rounded-xl bg-emerald-50 dark:bg-emerald-900/20 flex items-center justify-center">
                <Store size={18} className="text-emerald-600" />
              </div>
            </Card>
            <Card className="p-4 flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold tracking-wider uppercase text-slate-500">{t('purchases.tabs.returns')}</p>
                <p className="text-2xl font-bold text-amber-600 tabular-nums">{stats.returns}</p>
                <p className="text-xs text-slate-500">مردودات مسجلة</p>
              </div>
              <div className="w-10 h-10 rounded-xl bg-amber-50 dark:bg-amber-900/20 flex items-center justify-center">
                <Undo2 size={18} className="text-amber-600" />
              </div>
            </Card>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {purchasesMenu.map((item) => {
              const Icon = item.icon;
              return (
                <Link
                  key={item.id}
                  to={item.path}
                  className="group relative overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5 hover:shadow-lg hover:border-indigo-200 dark:hover:border-indigo-800 transition-all"
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
                  <div className="mt-4 flex items-center gap-1 text-xs font-medium text-indigo-600 dark:text-indigo-400 group-hover:gap-2 transition-all">
                    فتح <span aria-hidden>←</span>
                  </div>
                </Link>
              );
            })}
          </div>

          <Card className="p-4 bg-gradient-to-r from-indigo-600 to-indigo-700 text-white border-0">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-white/15 flex items-center justify-center">
                <Sparkles size={18} className="text-white" />
              </div>
              <div>
                <p className="font-semibold">نصائح المشتريات</p>
                <p className="text-sm text-white/80">أنشئ أمر الشراء أولاً ثم حوّله إلى فاتورة عند الاستلام، وراقب فواتير المسودة ورحّلها لتوليد القيود تلقائياً، وتابع مردودات المشتريات وأثرها على المخزون وذمم الموردين.</p>
              </div>
            </div>
          </Card>
        </>
      ) : (
        <>
          <div className="flex items-center gap-1.5 border-b border-slate-200 dark:border-slate-800 pb-2 overflow-x-auto -mx-1 px-1">
            {purchasesMenu.map((item) => {
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

export default PurchasesPage;
