import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Link, useLocation, useNavigate, Outlet } from 'react-router-dom';
import {
  LayoutDashboard,
  Calculator,
  Package,
  ShoppingCart,
  Store,
  Factory,
  Users,
  HeartHandshake,
  BarChart3,
  Settings,
  Bot,
  ChevronRight,
  ChevronLeft,
  ChevronDown,
  Building2,
  LogOut,
  User,
  Moon,
  Sun,
  Globe,
  Search,
  UserPlus,
  Target,
} from 'lucide-react';
import { CommandPalette, type EntitySource } from '@/core/ui/components/command/CommandPalette';
import { salesApi } from '@/modules/sales/api';
import { purchasesApi } from '@/modules/purchases/api';
import { inventoryApi } from '@/modules/inventory/api';
import { hrApi } from '@/modules/hr/api';
import { crmApi } from '@/modules/crm/api';
import { ChatWidget } from '@/modules/ai/components/ChatWidget';
import { useAppStore } from '@/core/store';
import { ToastContainer } from '@/core/ui/components/Toast';
import { useAuthStore } from '@/modules/auth/store';
import { useCanAccessModule } from '@/modules/auth/hooks/usePermission';
import { useTranslation } from '@/core/i18n/useTranslation';
import { cn } from '@/core/utils';
import type { Permission } from '@/modules/auth/types';

interface MenuItem {
  id: string;
  labelKey: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  path: string;
  module: 'core' | 'accounting' | 'inventory' | 'sales' | 'purchases' | 'manufacturing' | 'hr' | 'crm' | 'reports' | 'settings' | 'ai';
  children?: { labelKey: string; path: string; permission?: Permission }[];
}

const menuItems: MenuItem[] = [
  { id: 'dashboard', labelKey: 'sidebar.dashboard', icon: LayoutDashboard, path: '/', module: 'core' },
  {
    id: 'accounting',
    labelKey: 'sidebar.accounting.title',
    icon: Calculator,
    path: '/accounting',
    module: 'accounting',
    children: [
      { labelKey: 'sidebar.accounting.chartOfAccounts', path: '/accounting/chart' },
      { labelKey: 'sidebar.accounting.journalEntries', path: '/accounting/journal' },
      { labelKey: 'sidebar.accounting.trialBalance', path: '/accounting/trial' },
      { labelKey: 'sidebar.accounting.balanceSheet', path: '/accounting/balance' },
      { labelKey: 'sidebar.accounting.profitLoss', path: '/accounting/profit' },
      { labelKey: 'sidebar.accounting.cashFlow', path: '/accounting/cashflow' },
      { labelKey: 'sidebar.accounting.ledger', path: '/accounting/ledger' },
      { labelKey: 'sidebar.accounting.receiptVouchers', path: '/accounting/receipt-vouchers' },
      { labelKey: 'sidebar.accounting.paymentVouchers', path: '/accounting/payment-vouchers' },
    ],
  },
  {
    id: 'inventory',
    labelKey: 'sidebar.inventory.title',
    icon: Package,
    path: '/inventory',
    module: 'inventory',
    children: [
      { labelKey: 'sidebar.inventory.products', path: '/inventory/products' },
      { labelKey: 'sidebar.inventory.warehouses', path: '/inventory/warehouses' },
      { labelKey: 'sidebar.inventory.stock', path: '/inventory/stock' },
      { labelKey: 'sidebar.inventory.transactions', path: '/inventory/transactions' },
      { labelKey: 'sidebar.inventory.adjustments', path: '/inventory/adjustments' },
      { labelKey: 'sidebar.inventory.lowStockAlert', path: '/reports/low-stock-alert' },
      { labelKey: 'sidebar.inventory.stockMovement', path: '/reports/stock-movement' },
      { labelKey: 'sidebar.inventory.stockValuation', path: '/reports/stock-valuation' },
    ],
  },
  {
    id: 'sales',
    labelKey: 'sidebar.sales.title',
    icon: ShoppingCart,
    path: '/sales',
    module: 'sales',
    children: [
      { labelKey: 'sidebar.sales.invoices', path: '/sales/invoices' },
      { labelKey: 'sidebar.sales.customers', path: '/sales/customers' },
      { labelKey: 'sidebar.sales.quotations', path: '/sales/quotations' },
      { labelKey: 'sidebar.sales.returns', path: '/sales/returns' },
    ],
  },
  {
    id: 'purchases',
    labelKey: 'sidebar.purchases.title',
    icon: Store,
    path: '/purchases',
    module: 'purchases',
    children: [
      { labelKey: 'sidebar.purchases.invoices', path: '/purchases/invoices' },
      { labelKey: 'sidebar.purchases.suppliers', path: '/purchases/suppliers' },
      { labelKey: 'sidebar.purchases.orders', path: '/purchases/orders' },
      { labelKey: 'sidebar.purchases.returns', path: '/purchases/returns' },
    ],
  },
  {
    id: 'manufacturing',
    labelKey: 'sidebar.manufacturing.title',
    icon: Factory,
    path: '/manufacturing',
    module: 'manufacturing',
    children: [
      { labelKey: 'sidebar.manufacturing.boms', path: '/manufacturing/bom' },
      { labelKey: 'sidebar.manufacturing.workOrders', path: '/manufacturing/work-orders' },
      { labelKey: 'sidebar.manufacturing.costReport', path: '/manufacturing/cost-report' },
      { labelKey: 'sidebar.manufacturing.varianceReport', path: '/manufacturing/variance-report' },
    ],
  },
  {
    id: 'hr',
    labelKey: 'sidebar.hr.title',
    icon: Users,
    path: '/hr',
    module: 'hr',
    children: [
      { labelKey: 'sidebar.hr.employees', path: '/hr/employees' },
      { labelKey: 'sidebar.hr.attendance', path: '/hr/attendance' },
      { labelKey: 'sidebar.hr.payroll', path: '/hr/payroll' },
      { labelKey: 'sidebar.hr.leaves', path: '/hr/leaves' },
      { labelKey: 'sidebar.hr.endOfService', path: '/hr/end-of-service' },
    ],
  },
  {
    id: 'crm',
    labelKey: 'sidebar.crm.title',
    icon: HeartHandshake,
    path: '/crm',
    module: 'crm',
    children: [
      { labelKey: 'sidebar.crm.leads', path: '/crm/leads' },
      { labelKey: 'sidebar.crm.opportunities', path: '/crm/opportunities' },
      { labelKey: 'sidebar.crm.tasks', path: '/crm/tasks' },
      { labelKey: 'sidebar.crm.activities', path: '/crm/activities' },
    ],
  },
  {
    id: 'reports',
    labelKey: 'sidebar.reports.title',
    icon: BarChart3,
    path: '/reports',
    module: 'reports',
    children: [
      { labelKey: 'sidebar.reports.hub', path: '/reports' },
      { labelKey: 'sidebar.reports.salesAnalysis', path: '/reports/sales-analysis' },
      { labelKey: 'sidebar.reports.inventoryAnalysis', path: '/reports/inventory-analysis' },
      { labelKey: 'sidebar.reports.lowStockAlert', path: '/reports/low-stock-alert' },
      { labelKey: 'sidebar.reports.stockMovement', path: '/reports/stock-movement' },
      { labelKey: 'sidebar.reports.stockValuation', path: '/reports/stock-valuation' },
      { labelKey: 'sidebar.reports.customerStatement', path: '/reports/customer-statement' },
      { labelKey: 'sidebar.reports.supplierStatement', path: '/reports/supplier-statement' },
      { labelKey: 'sidebar.reports.profitAnalysis', path: '/reports/profit-analysis' },
      { labelKey: 'sidebar.reports.customBuilder', path: '/reports/custom-builder' },
      { labelKey: 'sidebar.reports.leadConversion', path: '/reports/lead-conversion' },
      { labelKey: 'sidebar.reports.opportunityPipeline', path: '/reports/opportunity-pipeline' },
    ],
  },
  {
    id: 'ai',
    labelKey: 'sidebar.ai',
    icon: Bot,
    path: '/ai',
    module: 'ai',
  },
  {
    id: 'settings',
    labelKey: 'sidebar.settings.title',
    icon: Settings,
    path: '/settings',
    module: 'settings',
    children: [
      { labelKey: 'sidebar.settings.company', path: '/settings/company' },
      { labelKey: 'sidebar.settings.currencies', path: '/settings/currencies' },
      { labelKey: 'sidebar.settings.vat', path: '/settings/vat' },
      { labelKey: 'sidebar.settings.branches', path: '/settings/branches' },
      { labelKey: 'sidebar.settings.documentSequences', path: '/settings/document-sequences' },
      { labelKey: 'sidebar.settings.defaultAccounts', path: '/settings/default-accounts' },
      { labelKey: 'sidebar.settings.productTypes', path: '/settings/product-types' },
      { labelKey: 'sidebar.settings.productCategories', path: '/settings/product-categories' },
      { labelKey: 'sidebar.settings.units', path: '/settings/units' },
      { labelKey: 'sidebar.settings.cashBoxes', path: '/settings/cash-boxes' },
      { labelKey: 'sidebar.settings.banks', path: '/settings/banks' },
      { labelKey: 'sidebar.settings.costCenters', path: '/settings/cost-centers' },
      { labelKey: 'sidebar.settings.users', path: '/settings/users' },
      { labelKey: 'sidebar.settings.roles', path: '/roles' },
      { labelKey: 'sidebar.settings.auditLogs', path: '/audit-logs' },
      { labelKey: 'sidebar.settings.backup', path: '/settings/backup' },
      { labelKey: 'sidebar.settings.reset', path: '/settings/reset' },
      { labelKey: 'sidebar.settings.ai', path: '/settings/ai', permission: 'ai.settings' as Permission },
    ],
  },
];

function SidebarItem({ item, sidebarOpen }: { item: MenuItem; sidebarOpen: boolean }) {
  const { t } = useTranslation();
  const location = useLocation();
  const canView = useCanAccessModule(item.module);
  const aiCanUse = useAuthStore((s) => s.hasPermission('ai.use' as Permission));
  const user = useAuthStore((state) => state.user);
  const visibleChildren = React.useMemo(
    () =>
      (item.children ?? []).filter((c) => !c.permission || useAuthStore.getState().hasPermission(c.permission)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [item.children, user]
  );
  const hasChildren = visibleChildren.length > 0;
  const isActive = location.pathname === item.path || location.pathname.startsWith(item.path + '/');
  const [isExpanded, setIsExpanded] = useState(isActive);

  // Special case: AI module uses ai.use instead of ai.view
  if (item.module === 'ai' && !aiCanUse) return null;
  if (item.module !== 'ai' && !canView) return null;

  return (
    <div className="space-y-0.5">
      <Link
        to={item.path}
        onClick={(e) => {
          if (hasChildren) {
            e.preventDefault();
            setIsExpanded(!isExpanded);
          }
        }}
        className={cn(
          'flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-150',
          isActive
            ? 'bg-primary-600/20 text-primary-400'
            : 'text-slate-400 hover:bg-slate-800 hover:text-slate-100'
        )}
        title={!sidebarOpen ? t(item.labelKey) : undefined}
      >
        <item.icon size={20} className="shrink-0" />
        {sidebarOpen && (
          <>
            <span className="text-sm font-medium flex-1">{t(item.labelKey)}</span>
            {hasChildren && (
              <ChevronDown
                size={14}
                className={cn('transition-transform duration-200', isExpanded && 'rotate-180')}
              />
            )}
          </>
        )}
      </Link>

      {hasChildren && sidebarOpen && isExpanded && (
        <div className="mr-6 space-y-0.5 border-r border-slate-800 pr-2">
          {visibleChildren.map((child) => {
            const childActive = location.pathname === child.path;
            return (
              <Link
                key={child.path}
                to={child.path}
                className={cn(
                  'flex items-center px-3 py-2 rounded-lg text-sm transition-colors',
                  childActive
                    ? 'bg-primary-600/10 text-primary-400'
                    : 'text-slate-400 hover:bg-slate-800 hover:text-slate-100'
                )}
              >
                {t(child.labelKey)}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

export const Sidebar: React.FC = () => {
  const { t } = useTranslation();
  const sidebarOpen = useAppStore((state) => state.sidebarOpen);
  const toggleSidebar = useAppStore((state) => state.toggleSidebar);

  return (
    <aside
      className={cn(
        'h-screen bg-slate-900 text-slate-100 flex flex-col transition-all duration-300 ease-in-out shrink-0',
        sidebarOpen ? 'w-72' : 'w-16'
      )}
    >
      {/* Logo */}
      <div className="h-16 flex items-center px-4 border-b border-slate-800">
        {sidebarOpen ? (
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-primary-600 rounded-lg flex items-center justify-center">
              <Building2 size={18} className="text-white" />
            </div>
            <span className="font-bold text-lg">{t('appSubtitle')}</span>
          </div>
        ) : (
          <div className="w-8 h-8 bg-primary-600 rounded-lg flex items-center justify-center mx-auto">
            <Building2 size={18} className="text-white" />
          </div>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 py-4 px-2 space-y-1 overflow-y-auto">
        {menuItems.map((item) => (
          <SidebarItem key={item.id} item={item} sidebarOpen={sidebarOpen} />
        ))}
      </nav>

      {/* Toggle */}
      <div className="p-2 border-t border-slate-800">
        <button
          onClick={toggleSidebar}
          className="w-full flex items-center justify-center p-2 rounded-lg text-slate-400 hover:bg-slate-800 hover:text-slate-100 transition-colors"
          title={sidebarOpen ? t('header.collapseSidebar') : t('header.expandSidebar')}
          aria-label={sidebarOpen ? t('header.collapseSidebar') : t('header.expandSidebar')}
        >
          {sidebarOpen ? <ChevronLeft size={20} /> : <ChevronRight size={20} />}
        </button>
      </div>
    </aside>
  );
};

export const Header: React.FC<{ onOpenSearch?: () => void }> = ({ onOpenSearch }) => {
  const { t } = useTranslation();
  const theme = useAppStore((state) => state.theme);
  const toggleTheme = useAppStore((state) => state.toggleTheme);
  const language = useAppStore((state) => state.language);
  const setLanguage = useAppStore((state) => state.setLanguage);
  const activeCompany = useAppStore((state) => state.activeCompany);
  const user = useAuthStore((state) => state.user);
  const logout = useAuthStore((state) => state.logout);
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <header className="h-16 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between px-6 shrink-0">
      <div className="flex items-center gap-4">
        {onOpenSearch && (
          <button
            onClick={onOpenSearch}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-sm text-slate-400 hover:border-primary-500 hover:text-primary-500 transition-colors"
            title={t('palette.openTitle')}
            aria-label={t('palette.openTitle')}
          >
            <Search size={16} />
            <span className="hidden lg:inline">{t('palette.searchPlaceholder')}</span>
            <kbd className="hidden md:inline-block px-1 py-0.5 text-[10px] font-mono text-slate-400 bg-slate-100 dark:bg-slate-800 rounded border border-slate-200 dark:border-slate-700">
              Ctrl K
            </kbd>
          </button>
        )}
        {activeCompany && (
          <div className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
            <Building2 size={16} />
            <span className="font-medium">{activeCompany.name}</span>
          </div>
        )}
      </div>

      <div className="flex items-center gap-2">
        {user && (
          <div className="flex items-center gap-3 pl-2">
            <div className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
              <User size={16} />
              <span className="font-medium">{user.username}</span>
              <span className="text-xs text-slate-400">({user.role})</span>
            </div>
            <button
              onClick={handleLogout}
              className="p-2 rounded-lg text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-900/20 transition-colors"
              title={t('header.logout')}
            >
              <LogOut size={18} />
            </button>
          </div>
        )}

        <div className="h-6 w-px bg-slate-200 dark:bg-slate-700" />

        <button
          onClick={() => setLanguage(language === 'ar' ? 'en' : 'ar')}
          className="p-2 rounded-lg text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800 transition-colors"
          title={language === 'ar' ? t('header.switchToEnglish') : t('header.switchToArabic')}
          aria-label={language === 'ar' ? t('header.switchToEnglish') : t('header.switchToArabic')}
        >
          <Globe size={18} />
        </button>
        <button
          onClick={toggleTheme}
          className="p-2 rounded-lg text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800 transition-colors"
          title={theme === 'dark' ? t('header.lightMode') : t('header.darkMode')}
          aria-label={theme === 'dark' ? t('header.lightMode') : t('header.darkMode')}
        >
          {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
        </button>
      </div>
    </header>
  );
};

export const AppLayout = () => {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const recordActivity = useAuthStore((state) => state.recordActivity);
  const checkSession = useAuthStore((state) => state.checkSession);
  const navigate = useNavigate();
  const [paletteOpen, setPaletteOpen] = useState(false);

  const entitySources = useMemo<EntitySource[]>(
    () => [
      {
        key: 'customers',
        groupKey: 'sidebar.sales.customers',
        path: '/sales/customers',
        icon: User,
        fetch: async (companyId, q) => {
          const res = await salesApi.getCustomersPaginated(companyId, 1, 5, { search: q });
          return res.success && res.data
            ? res.data.items.map((i) => ({ key: i.id, label: i.name, subtitle: i.phone }))
            : [];
        },
      },
      {
        key: 'suppliers',
        groupKey: 'sidebar.purchases.suppliers',
        path: '/purchases/suppliers',
        icon: Store,
        fetch: async (companyId, q) => {
          const res = await purchasesApi.getSuppliersPaginated(companyId, 1, 5, { search: q });
          return res.success && res.data
            ? res.data.items.map((i) => ({ key: i.id, label: i.name, subtitle: i.phone }))
            : [];
        },
      },
      {
        key: 'products',
        groupKey: 'sidebar.inventory.products',
        path: '/inventory/products',
        icon: Package,
        fetch: async (companyId, q) => {
          const res = await inventoryApi.getProductsPaginated(companyId, 1, 5, { search: q });
          return res.success && res.data
            ? res.data.items.map((i) => ({
                key: i.id,
                label: i.nameAr || i.nameEn || i.code,
                subtitle: i.code,
              }))
            : [];
        },
      },
      {
        key: 'employees',
        groupKey: 'sidebar.hr.employees',
        path: '/hr/employees',
        icon: Users,
        fetch: async (companyId, q) => {
          const res = await hrApi.getEmployeesPaginated(companyId, 1, 5, { search: q });
          return res.success && res.data
            ? res.data.items.map((i) => ({
                key: i.id,
                label: i.fullName,
                subtitle: i.employeeNumber,
              }))
            : [];
        },
      },
      {
        key: 'leads',
        groupKey: 'sidebar.crm.leads',
        path: '/crm/leads',
        icon: UserPlus,
        fetch: async (companyId, q) => {
          const res = await crmApi.getLeadsPaginated(companyId, 1, 5, { search: q });
          return res.success && res.data
            ? res.data.items.map((i) => ({ key: i.id, label: i.name }))
            : [];
        },
      },
      {
        key: 'opportunities',
        groupKey: 'sidebar.crm.opportunities',
        path: '/crm/opportunities',
        icon: Target,
        fetch: async (companyId, q) => {
          const res = await crmApi.getOpportunitiesPaginated(companyId, 1, 5, { search: q });
          return res.success && res.data
            ? res.data.items.map((i) => ({ key: i.id, label: i.name }))
            : [];
        },
      },
    ],
    [],
  );

  const handleActivity = useCallback(() => {
    if (isAuthenticated) {
      recordActivity();
    }
  }, [isAuthenticated, recordActivity]);

  useEffect(() => {
    if (!isAuthenticated) return;

    const events = ['mousedown', 'keydown', 'scroll', 'touchstart'];
    events.forEach((event) => window.addEventListener(event, handleActivity, { passive: true }));

    const interval = setInterval(() => {
      if (!checkSession()) {
        navigate('/login');
      }
    }, 60000);

    return () => {
      events.forEach((event) => window.removeEventListener(event, handleActivity));
      clearInterval(interval);
    };
  }, [isAuthenticated, handleActivity, checkSession, navigate]);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-slate-50 dark:bg-slate-950">
      <Sidebar />
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        <Header onOpenSearch={() => setPaletteOpen(true)} />
        <main className="flex-1 overflow-y-auto p-6">
          <Outlet />
        </main>
      </div>
      <CommandPalette
        open={paletteOpen}
        onOpen={() => setPaletteOpen(true)}
        onClose={() => setPaletteOpen(false)}
        entitySources={entitySources}
      />
      <ToastContainer />
      <ChatWidget />
    </div>
  );
};

export default Sidebar;
