import React, { useMemo } from 'react';
import { Outlet, Link, useLocation } from 'react-router-dom';
import { Package, Warehouse, Boxes, ArrowRightLeft, Scale, AlertTriangle, ArrowUpDown, Coins, TrendingUp, Layers, Sparkles } from 'lucide-react';
import { cn } from '@/core/utils';
import { useTranslation } from '@/core/i18n/useTranslation';
import { Card } from '@/core/ui/components';
import { useAppStore } from '@/core/store';
import { useStockDetailed, useProductCategories } from '../hooks/useInventory';
import { useWarehouses } from '../hooks/useInventory';
import { useProductsPaginated } from '../hooks/useInventory';
import { useFormatters } from '@/core/utils/useFormatters';

export const InventoryPage: React.FC = () => {
  const { t } = useTranslation();
  const location = useLocation();
  const isRoot = location.pathname === '/inventory';
  const activeCompany = useAppStore((s) => s.activeCompany);
  const companyId = activeCompany?.id || '';
  const { formatCurrency } = useFormatters(companyId);

  const { stock } = useStockDetailed(companyId);
  const { warehouses } = useWarehouses(companyId);
  const { total: totalProducts } = useProductsPaginated(companyId, {});
  const { categories } = useProductCategories(companyId);

  const stats = useMemo(() => {
    const totalStockItems = stock.length;
    const totalQty = stock.reduce((s, it) => s + Number(it.quantity || 0), 0);
    const totalValue = stock.reduce((s, it) => s + Number(it.quantity || 0) * Number(it.costPrice || 0), 0);
    const lowCount = stock.filter((it) => it.minStockAlert !== undefined && it.minStockAlert !== null && Number(it.quantity) < Number(it.minStockAlert)).length;
    return { totalStockItems, totalQty, totalValue, lowCount, totalProducts, warehouses: warehouses.length, categories: categories.length };
  }, [stock, totalProducts, warehouses, categories]);

  const inventoryMenu: Array<{ id: string; label: string; desc: string; icon: React.ElementType; path: string; color: string; bg: string; count: number | null }> = [
    { id: 'products', label: t('inventory.products'), desc: 'إدارة المنتجات والتصنيفات والأسعار', icon: Package, path: '/inventory/products', color: 'from-primary-600 to-primary-700', bg: 'bg-primary-50 dark:bg-primary-900/20', count: stats.totalProducts },
    { id: 'warehouses', label: t('inventory.warehouses'), desc: 'المستودعات والفروع', icon: Warehouse, path: '/inventory/warehouses', color: 'from-blue-600 to-blue-700', bg: 'bg-blue-50 dark:bg-blue-900/20', count: stats.warehouses },
    { id: 'stock', label: t('inventory.stock'), desc: 'أرصدة المخزون والتحويلات', icon: Boxes, path: '/inventory/stock', color: 'from-emerald-600 to-emerald-700', bg: 'bg-emerald-50 dark:bg-emerald-900/20', count: stats.totalStockItems },
    { id: 'transactions', label: t('inventory.transactions'), desc: 'حركات وارد/صادر/تسوية', icon: ArrowRightLeft, path: '/inventory/transactions', color: 'from-amber-500 to-orange-600', bg: 'bg-amber-50 dark:bg-amber-900/20', count: stats.totalQty },
    { id: 'adjustments', label: t('inventory.adjustments'), desc: 'تسويات الجرد والفروقات', icon: Scale, path: '/inventory/adjustments', color: 'from-orange-600 to-orange-700', bg: 'bg-orange-50 dark:bg-orange-900/20', count: null },
    { id: 'low-stock', label: t('inventory.lowStockAlert'), desc: 'تنبيهات الحد الأدنى', icon: AlertTriangle, path: '/reports/low-stock-alert', color: 'from-rose-600 to-rose-700', bg: 'bg-rose-50 dark:bg-rose-900/20', count: stats.lowCount },
    { id: 'stock-movement', label: t('inventory.stockMovement'), desc: 'حركة الأصناف خلال فترة', icon: ArrowUpDown, path: '/reports/stock-movement', color: 'from-teal-600 to-teal-700', bg: 'bg-teal-50 dark:bg-teal-900/20', count: null },
    { id: 'stock-valuation', label: t('inventory.stockValuation'), desc: 'تقييم المخزون بالقيمة', icon: Coins, path: '/reports/stock-valuation', color: 'from-violet-600 to-violet-700', bg: 'bg-violet-50 dark:bg-violet-900/20', count: stats.totalValue },
  ];

  return (
    <div className="space-y-5 animate-fade-in">
      {isRoot ? (
        <>
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-primary-600 to-primary-700 flex items-center justify-center shadow-sm">
              <Boxes size={22} className="text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50 tracking-tight">{t('inventory.page.title')}</h1>
              <p className="text-sm text-slate-500 dark:text-slate-400">{t('inventory.page.subtitle')}</p>
            </div>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Card className="p-4 flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold tracking-wider uppercase text-slate-500">المنتجات</p>
                <p className="text-2xl font-bold text-slate-900 dark:text-slate-50 tabular-nums">{stats.totalProducts}</p>
                <p className="text-xs text-slate-500">{stats.categories} تصنيف</p>
              </div>
              <div className="w-10 h-10 rounded-xl bg-primary-50 dark:bg-primary-900/20 flex items-center justify-center">
                <Package size={18} className="text-primary-600" />
              </div>
            </Card>
            <Card className="p-4 flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold tracking-wider uppercase text-slate-500">المستودعات</p>
                <p className="text-2xl font-bold text-blue-600 tabular-nums">{stats.warehouses}</p>
              </div>
              <div className="w-10 h-10 rounded-xl bg-blue-50 dark:bg-blue-900/20 flex items-center justify-center">
                <Warehouse size={18} className="text-blue-600" />
              </div>
            </Card>
            <Card className="p-4 flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold tracking-wider uppercase text-slate-500">بنود المخزون</p>
                <p className="text-2xl font-bold text-emerald-600 tabular-nums">{stats.totalStockItems}</p>
                <p className="text-xs text-slate-500">{stats.totalQty} وحدة</p>
              </div>
              <div className="w-10 h-10 rounded-xl bg-emerald-50 dark:bg-emerald-900/20 flex items-center justify-center">
                <Layers size={18} className="text-emerald-600" />
              </div>
            </Card>
            <Card className={`p-4 flex items-center justify-between border ${stats.lowCount ? 'bg-amber-50/50 dark:bg-amber-900/10 border-amber-200 dark:border-amber-800' : ''}`}>
              <div>
                <p className="text-xs font-semibold tracking-wider uppercase text-slate-500">قيمة المخزون</p>
                <p className="text-lg font-bold text-slate-900 dark:text-slate-50 tabular-nums">{formatCurrency(stats.totalValue)}</p>
                <p className={`text-xs ${stats.lowCount ? 'text-amber-600 font-medium' : 'text-slate-500'}`}>{stats.lowCount ? `${stats.lowCount} منخفض` : 'لا يوجد منخفض'}</p>
              </div>
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${stats.lowCount ? 'bg-amber-100 dark:bg-amber-900/30' : 'bg-slate-100 dark:bg-slate-800'}`}>
                <TrendingUp size={18} className={stats.lowCount ? 'text-amber-600' : 'text-slate-500'} />
              </div>
            </Card>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {inventoryMenu.map((item) => {
              const Icon = item.icon;
              return (
                <Link
                  key={item.id}
                  to={item.path}
                  className="group relative overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5 hover:shadow-lg hover:border-primary-200 dark:hover:border-primary-800 transition-all"
                >
                  <div className={`absolute top-0 right-0 w-24 h-24 bg-gradient-to-br ${item.color} opacity-[0.06] group-hover:opacity-[0.1] rounded-bl-full transition`} />
                  <div className="flex items-start justify-between">
                    <div className={`w-11 h-11 rounded-xl ${item.bg} border border-slate-200 dark:border-slate-700 flex items-center justify-center group-hover:scale-105 transition`}>
                      <Icon size={20} className="text-slate-700 dark:text-slate-300" />
                    </div>
                    {item.count !== null && (
                      <span className="text-xs font-bold tabular-nums bg-slate-900 dark:bg-slate-800 text-white px-2.5 py-1 rounded-full">
                        {item.id === 'stock-valuation' ? formatCurrency(Number(item.count)) : typeof item.count === 'number' && item.count > 1000 ? `${(Number(item.count) / 1000).toFixed(1)}k` : String(item.count)}
                      </span>
                    )}
                  </div>
                  <h3 className="mt-4 font-bold text-slate-900 dark:text-slate-50">{item.label}</h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">{item.desc}</p>
                  <div className="mt-4 flex items-center gap-1 text-xs font-medium text-primary-600 dark:text-primary-400 group-hover:gap-2 transition-all">
                    فتح <span aria-hidden>←</span>
                  </div>
                </Link>
              );
            })}
          </div>

          <Card className="p-4 bg-gradient-to-r from-primary-600 to-primary-700 text-white border-0">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-white/15 flex items-center justify-center">
                <Sparkles size={18} className="text-white" />
              </div>
              <div>
                <p className="font-semibold">نصائح إدارة المخازن</p>
                <p className="text-sm text-white/80">راجع تنبيه المخزون يومياً، واستخدم التسويات لمعالجة فروقات الجرد، والتحويلات لنقل البضاعة بين المستودعات مع تتبع كامل.</p>
              </div>
            </div>
          </Card>
        </>
      ) : (
        <>
          <div className="flex items-center gap-1.5 border-b border-slate-200 dark:border-slate-800 pb-2 overflow-x-auto -mx-1 px-1">
            {inventoryMenu.map((item) => {
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

export default InventoryPage;
