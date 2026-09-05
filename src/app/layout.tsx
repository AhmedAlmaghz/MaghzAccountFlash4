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
  User,
  House,
  Search,
  UserPlus,
  Target,
  Menu,
  MoreHorizontal,
  PieChart,
  X,
} from 'lucide-react';
import { CommandPalette, type EntitySource } from '@/core/ui/components/command/CommandPalette';
import { AppBrand } from '@/core/ui/components/AppBrand';
import { UserMenu } from '@/modules/auth/components/UserMenu';
import { salesApi } from '@/modules/sales/api';
import { purchasesApi } from '@/modules/purchases/api';
import { inventoryApi } from '@/modules/inventory/api';
import { hrApi } from '@/modules/hr/api';
import { crmApi } from '@/modules/crm/api';
import { useAppStore } from '@/core/store';
import { ToastContainer } from '@/core/ui/components/Toast';
import { useAuthStore } from '@/modules/auth/store';
import { useCanAccessModule } from '@/modules/auth/hooks/usePermission';
import { useTranslation } from '@/core/i18n/useTranslation';
import { useIsMobile, useBodyScrollLock, useEscapeKey } from '@/core/hooks/useResponsive';
import { cn } from '@/core/utils';
import type { Permission } from '@/modules/auth/types';

const ChatWidget = React.lazy(() =>
  import('@/modules/ai/components/ChatWidget').then((m) => ({ default: m.ChatWidget }))
);

type ModuleId =
  | 'core'
  | 'accounting'
  | 'inventory'
  | 'sales'
  | 'purchases'
  | 'manufacturing'
  | 'hr'
  | 'crm'
  | 'reports'
  | 'settings'
  | 'ai';

interface MenuItem {
  id: string;
  labelKey: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  path: string;
  module: ModuleId;
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
      { labelKey: 'sidebar.hr.departments', path: '/hr/departments' },
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
      { labelKey: 'settings.menu.themes', path: '/settings/themes' },
      { labelKey: 'sidebar.settings.currencies', path: '/settings/currencies' },
      { labelKey: 'sidebar.settings.vat', path: '/settings/vat' },
      { labelKey: 'sidebar.hrPolicy', path: '/settings/hr-policies' },
      { labelKey: 'sidebar.settings.payrollComponents', path: '/settings/payroll-components' },
      { labelKey: 'sidebar.settings.branches', path: '/settings/branches' },
      { labelKey: 'sidebar.settings.documentSequences', path: '/settings/document-sequences' },
      { labelKey: 'sidebar.settings.defaultAccounts', path: '/settings/default-accounts' },
      { labelKey: 'sidebar.settings.productTypes', path: '/settings/product-types' },
      { labelKey: 'sidebar.settings.productCategories', path: '/settings/product-categories' },
      { labelKey: 'sidebar.settings.units', path: '/settings/units' },
      { labelKey: 'sidebar.settings.cashBoxes', path: '/settings/cash-boxes' },
      { labelKey: 'sidebar.settings.costCenters', path: '/settings/cost-centers' },
      { labelKey: 'sidebar.settings.database', path: '/settings/database' },
      { labelKey: 'sidebar.settings.users', path: '/settings/users' },
      { labelKey: 'sidebar.settings.roles', path: '/roles' },
      { labelKey: 'sidebar.settings.auditLogs', path: '/audit-logs' },
      { labelKey: 'sidebar.settings.backup', path: '/settings/backup' },
      { labelKey: 'sidebar.settings.reset', path: '/settings/reset' },
      { labelKey: 'sidebar.settings.ai', path: '/settings/ai', permission: 'ai.settings' as Permission },
    ],
  },
];

/** Bottom-tab candidates in priority order; first 4 accessible ones render as tabs. */
const bottomTabCandidates: { id: string; labelKey: string; icon: React.ComponentType<{ size?: number; className?: string }>; path: string; module: ModuleId }[] = [
  { id: 'dashboard', labelKey: 'sidebar.dashboard', icon: LayoutDashboard, path: '/', module: 'core' },
  { id: 'sales', labelKey: 'sidebar.sales.title', icon: ShoppingCart, path: '/sales', module: 'sales' },
  { id: 'purchases', labelKey: 'sidebar.purchases.title', icon: Store, path: '/purchases', module: 'purchases' },
  { id: 'inventory', labelKey: 'sidebar.inventory.title', icon: Package, path: '/inventory', module: 'inventory' },
  { id: 'manufacturing', labelKey: 'sidebar.manufacturing.title', icon: Factory, path: '/manufacturing', module: 'manufacturing' },
  { id: 'accounting', labelKey: 'sidebar.accounting.title', icon: Calculator, path: '/accounting', module: 'accounting' },
  { id: 'hr', labelKey: 'sidebar.hr.title', icon: Users, path: '/hr', module: 'hr' },
  { id: 'crm', labelKey: 'sidebar.crm.title', icon: HeartHandshake, path: '/crm', module: 'crm' },
  { labelKey: 'sidebar.reports.title', id: 'reports', icon: PieChart, path: '/reports', module: 'reports' },
];

function useModuleAccess(): (m: ModuleId) => boolean {
  const user = useAuthStore((s) => s.user);
  const canSales = useCanAccessModule('sales');
  const canPurchases = useCanAccessModule('purchases');
  const canInventory = useCanAccessModule('inventory');
  const canManufacturing = useCanAccessModule('manufacturing');
  const canAccounting = useCanAccessModule('accounting');
  const canHr = useCanAccessModule('hr');
  const canCrm = useCanAccessModule('crm');
  const canReports = useCanAccessModule('reports');
  const canSettings = useCanAccessModule('settings');
  const canCore = useCanAccessModule('core');
  const aiCanUse = useAuthStore((s) => s.hasPermission('ai.use' as Permission));
  return useCallback(
    (m: ModuleId) => {
      if (m === 'ai') return aiCanUse;
      if (m === 'sales') return canSales;
      if (m === 'purchases') return canPurchases;
      if (m === 'inventory') return canInventory;
      if (m === 'manufacturing') return canManufacturing;
      if (m === 'accounting') return canAccounting;
      if (m === 'hr') return canHr;
      if (m === 'crm') return canCrm;
      if (m === 'reports') return canReports;
      if (m === 'settings') return canSettings;
      return canCore;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [user, aiCanUse, canSales, canPurchases, canInventory, canManufacturing, canAccounting, canHr, canCrm, canReports, canSettings, canCore]
  );
}

function SidebarItem({ item, sidebarOpen, onNavigate }: { item: MenuItem; sidebarOpen: boolean; onNavigate?: () => void }) {
  const { t } = useTranslation();
  const location = useLocation();
  const hasModuleAccess = useModuleAccess();
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

  if (!hasModuleAccess(item.module)) return null;

  return (
    <div className="space-y-0.5">
      <Link
        to={item.path}
        onClick={() => {
          // Section titles are real links to the section landing page;
          // visiting a section also expands its children.
          if (hasChildren) setIsExpanded(true);
          onNavigate?.();
        }}
        className={cn(
          'group relative flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-150',
          isActive ? 'nav-link-active' : 'nav-link'
        )}
        title={!sidebarOpen ? t(item.labelKey) : undefined}
      >
        {isActive && (
          <span className="absolute inset-y-2 start-0 w-1 rounded-full bg-gradient-to-b from-primary-500 to-primary-400" />
        )}
        <item.icon size={20} className="nav-icon shrink-0 transition-colors" />
        {sidebarOpen && (
          <>
            <span className="text-sm flex-1">{t(item.labelKey)}</span>
            {hasChildren && (
              <button
                type="button"
                aria-label={t('sidebar.toggleSection')}
                title={t('sidebar.toggleSection')}
                onClick={(e) => {
                  // Toggle only — do not follow the section link.
                  e.preventDefault();
                  e.stopPropagation();
                  setIsExpanded(!isExpanded);
                }}
                className="rounded-md p-1 text-current opacity-70 transition-opacity hover:opacity-100 focus-visible:outline-2 focus-visible:outline-primary-500"
              >
                <ChevronDown
                  size={14}
                  className={cn('transition-transform duration-200', isExpanded && 'rotate-180')}
                />
              </button>
            )}
          </>
        )}
      </Link>

      {hasChildren && sidebarOpen && isExpanded && (
        <div className="ms-6 space-y-0.5 border-s border-zinc-200 dark:border-zinc-800 ps-2">
          {visibleChildren.map((child) => {
            const childActive = location.pathname === child.path;
            return (
              <Link
                key={child.path}
                to={child.path}
                onClick={onNavigate}
                className={cn(
                  'flex items-center px-3 py-2 rounded-lg text-sm min-h-11 lg:min-h-9 transition-colors',
                  childActive ? 'nav-link-active font-medium' : 'nav-link'
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

const SidebarContent: React.FC<{ sidebarOpen: boolean; onNavigate?: () => void }> = ({ sidebarOpen, onNavigate }) => {
  const hasModuleAccess = useModuleAccess();
  const groups = useMemo(
    () => [
      { ids: ['dashboard', 'ai'] },
      { ids: ['sales', 'purchases', 'inventory', 'manufacturing'] },
      { ids: ['accounting', 'hr', 'crm'] },
      { ids: ['reports'] },
      { ids: ['settings'] },
    ],
    []
  );
  const byId = useMemo(() => new Map(menuItems.map((m) => [m.id, m])), []);

  return (
    <>
      {/* Logo — unified brand (icon + name + dynamic version) */}
      <div className="h-16 flex items-center px-4 border-b border-zinc-200/60 dark:border-zinc-800 shrink-0">
        {sidebarOpen ? <AppBrand variant="full" /> : <AppBrand variant="compact" />}
      </div>

      {/* Navigation */}
      <nav className="flex-1 py-4 px-2 space-y-4 overflow-y-auto">
        {groups.map((group, gi) => {
          const items = group.ids.map((id) => byId.get(id)!).filter(Boolean);
          const visible = items.filter((i) => hasModuleAccess(i.module));
          if (visible.length === 0) return null;
          return (
            <div key={gi} className="space-y-0.5">
              {visible.map((item) => (
                <SidebarItem key={item.id} item={item} sidebarOpen={sidebarOpen} onNavigate={onNavigate} />
              ))}
            </div>
          );
        })}
      </nav>
    </>
  );
};

export const Sidebar: React.FC = () => {
  const { t } = useTranslation();
  const sidebarOpen = useAppStore((state) => state.sidebarOpen);
  const toggleSidebar = useAppStore((state) => state.toggleSidebar);

  return (
    <aside
      className={cn(
        'hidden lg:flex h-full surface-sidebar flex-col transition-all duration-300 ease-spring shrink-0 border-e border-zinc-200/60 dark:border-zinc-800',
        sidebarOpen ? 'w-72' : 'w-[4.5rem]'
      )}
    >
      <SidebarContent sidebarOpen={sidebarOpen} />

      {/* Toggle */}
      <div className="p-2 border-t border-zinc-200/60 dark:border-zinc-800">
        <button
          onClick={toggleSidebar}
          className="w-full flex items-center justify-center p-2.5 rounded-xl text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors"
          title={sidebarOpen ? t('header.collapseSidebar') : t('header.expandSidebar')}
          aria-label={sidebarOpen ? t('header.collapseSidebar') : t('header.expandSidebar')}
        >
          {sidebarOpen ? <ChevronLeft size={20} /> : <ChevronRight size={20} />}
        </button>
      </div>
    </aside>
  );
};

/** Mobile slide-in drawer with overlay. */
const MobileDrawer: React.FC<{ open: boolean; onClose: () => void }> = ({ open, onClose }) => {
  const { t } = useTranslation();
  useBodyScrollLock(open);
  useEscapeKey(open, onClose);

  return (
    <div
      className={cn(
        'fixed inset-0 z-50 lg:hidden',
        !open && 'pointer-events-none'
      )}
      aria-hidden={!open}
    >
      {/* Overlay */}
      <div
        onClick={onClose}
        className={cn(
          'absolute inset-0 bg-zinc-950/50 backdrop-blur-sm transition-opacity duration-300',
          open ? 'opacity-100' : 'opacity-0'
        )}
      />
      {/* Panel */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('nav.menu')}
        className={cn(
          'absolute inset-y-0 start-0 w-[17.5rem] max-w-[85vw] surface-sidebar shadow-float flex flex-col transition-transform duration-300 ease-spring',
          open ? 'translate-x-0' : '-translate-x-full rtl:translate-x-full'
        )}
      >
        <div className="h-16 flex items-center justify-between px-4 border-b border-zinc-200/60 dark:border-zinc-800 shrink-0">
          <AppBrand variant="full" />
          <button
            onClick={onClose}
            className="p-2.5 -me-2 rounded-xl text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-700 dark:hover:text-zinc-200 transition-colors"
            aria-label={t('common.close')}
          >
            <X size={20} />
          </button>
        </div>
        <nav className="flex-1 py-4 px-2 overflow-y-auto">
          <MobileDrawerNav onNavigate={onClose} />
        </nav>
      </div>
    </div>
  );
};

const MobileDrawerNav: React.FC<{ onNavigate: () => void }> = ({ onNavigate }) => {
  const hasModuleAccess = useModuleAccess();
  const groups = useMemo(
    () => [
      { ids: ['dashboard', 'ai'] },
      { ids: ['sales', 'purchases', 'inventory', 'manufacturing'] },
      { ids: ['accounting', 'hr', 'crm'] },
      { ids: ['reports'] },
      { ids: ['settings'] },
    ],
    []
  );
  const byId = useMemo(() => new Map(menuItems.map((m) => [m.id, m])), []);
  return (
    <>
      {groups.map((group, gi) => {
        const visible = group.ids.map((id) => byId.get(id)!).filter((i) => i && hasModuleAccess(i.module));
        if (visible.length === 0) return null;
        return (
          <div key={gi} className="mb-4">
            {visible.map((item) => (
              <SidebarItem key={item.id} item={item} sidebarOpen onNavigate={onNavigate} />
            ))}
          </div>
        );
      })}
    </>
  );
};

/** Mobile bottom tab bar — first 4 accessible modules + More. */
const BottomTabs: React.FC<{ onOpenMore: () => void }> = ({ onOpenMore }) => {
  const { t } = useTranslation();
  const location = useLocation();
  const hasModuleAccess = useModuleAccess();

  const tabs = useMemo(() => bottomTabCandidates.filter((c) => hasModuleAccess(c.module)).slice(0, 4), [hasModuleAccess]);

  const isActive = (path: string) =>
    path === '/' ? location.pathname === '/' : location.pathname.startsWith(path);

  return (
    <nav
      className="lg:hidden fixed bottom-0 inset-x-0 z-40 glass-bar border-t border-zinc-200/70 dark:border-zinc-800"
      style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 0.375rem)' }}
      aria-label={t('nav.menu')}
    >
      <div className="flex items-stretch justify-around px-1 pt-1.5">
        {tabs.map((tab) => {
          const active = isActive(tab.path);
          return (
            <Link
              key={tab.id}
              to={tab.path}
              className={cn(
                'relative flex flex-col items-center justify-center gap-0.5 flex-1 min-w-0 py-1.5 rounded-xl transition-colors',
                active ? 'text-primary-600 dark:text-primary-400' : 'text-zinc-400 dark:text-zinc-500'
              )}
              aria-current={active ? 'page' : undefined}
            >
              {active && (
                <span className="absolute top-0 h-1 w-8 rounded-full bg-gradient-to-r from-primary-500 to-primary-400" />
              )}
              <tab.icon size={22} className={active ? 'scale-105' : ''} />
              <span className={cn('text-[10px] font-medium truncate max-w-full px-1', active && 'font-semibold')}>
                {t(tab.labelKey)}
              </span>
            </Link>
          );
        })}
        <button
          onClick={onOpenMore}
          className="flex flex-col items-center justify-center gap-0.5 flex-1 min-w-0 py-1.5 rounded-xl text-zinc-400 dark:text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-200 transition-colors"
          aria-label={t('nav.more')}
          aria-expanded="false"
        >
          <MoreHorizontal size={22} />
          <span className="text-[10px] font-medium">{t('nav.more')}</span>
        </button>
      </div>
    </nav>
  );
};

/**
 * Company identity chip — logo (or fallback mark) + name.
 * Hidden on small screens to keep the header compact.
 */
const CompanyChip: React.FC = () => {
  const { t } = useTranslation();
  const activeCompany = useAppStore((state) => state.activeCompany);
  const [logoBroken, setLogoBroken] = useState(false);

  useEffect(() => {
    setLogoBroken(false);
  }, [activeCompany?.logoUrl]);

  if (!activeCompany) return null;
  const logo = !logoBroken && activeCompany.logoUrl ? activeCompany.logoUrl : null;

  // Always visible on every screen and device: compact on phones (logo +
  // short name), roomier from sm up. The header itself renders on all
  // protected routes, so this chip is the single company identity spot.
  return (
    <div className="flex items-center gap-1.5 sm:gap-2 min-w-0 max-w-28 sm:max-w-44 md:max-w-55 text-sm text-zinc-600 dark:text-zinc-300">
      {logo ? (
        <img
          src={logo}
          alt={t('header.companyLogo')}
          onError={() => setLogoBroken(true)}
          className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg object-cover shrink-0 ring-1 ring-zinc-200 dark:ring-zinc-700"
        />
      ) : (
        <span className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg bg-gold-100 dark:bg-gold-900/30 flex items-center justify-center shrink-0">
          <Building2 size={15} className="text-gold-600 dark:text-gold-400" aria-hidden />
        </span>
      )}
      <span className="font-medium truncate">{activeCompany.name}</span>
    </div>
  );
};

const headerIconClass =
  'p-2.5 rounded-xl nav-link nav-icon transition-colors';

export const Header: React.FC<{ onOpenSearch?: () => void; onOpenMenu?: () => void }> = ({
  onOpenSearch,
  onOpenMenu,
}) => {
  const { t } = useTranslation();
  const aiCanUse = useAuthStore((state) => state.hasPermission('ai.use' as Permission));

  return (
    <header className="h-14 sm:h-16 surface-header backdrop-blur-xl border-b border-zinc-200/70 dark:border-zinc-800 flex items-center justify-between px-3 sm:px-6 gap-2 shrink-0">
      {/* Start: menu + company (app brand lives only atop the sidebar) */}
      <div className="flex items-center gap-2 sm:gap-4 min-w-0">
        {onOpenMenu && (
          <button
            onClick={onOpenMenu}
            className={cn('lg:hidden -ms-1', headerIconClass)}
            title={t('nav.menu')}
            aria-label={t('nav.menu')}
          >
            <Menu size={22} />
          </button>
        )}
        <CompanyChip />
      </div>

      {/* End: search + home + AI + user menu */}
      <div className="flex items-center gap-1 sm:gap-2">
        {onOpenSearch && (
          <button
            onClick={onOpenSearch}
            className="flex items-center gap-2 px-3 py-2 sm:py-1.5 rounded-xl border border-zinc-200 dark:border-zinc-700 text-sm text-zinc-400 hover:border-primary-400 hover:text-primary-600 transition-colors min-h-11 lg:min-h-0"
            title={t('palette.openTitle')}
            aria-label={t('palette.openTitle')}
          >
            <Search size={16} />
            <span className="hidden lg:inline">{t('palette.searchPlaceholder')}</span>
            <kbd className="hidden md:inline-block px-1 py-0.5 text-[10px] font-mono text-zinc-400 bg-zinc-100 dark:bg-zinc-800 rounded border border-zinc-200 dark:border-zinc-700">
              Ctrl K
            </kbd>
          </button>
        )}
        <Link
          to="/"
          className={headerIconClass}
          title={t('header.home')}
          aria-label={t('header.home')}
        >
          <House size={18} />
        </Link>
        {aiCanUse && (
          <Link
            to="/ai"
            className={headerIconClass}
            title={t('header.aiAssistant')}
            aria-label={t('header.aiAssistant')}
          >
            <Bot size={18} />
          </Link>
        )}
        <UserMenu />
      </div>
    </header>
  );
};

export const AppLayout = () => {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const recordActivity = useAuthStore((state) => state.recordActivity);
  const checkSession = useAuthStore((state) => state.checkSession);
  const navigate = useNavigate();
  const location = useLocation();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const isMobile = useIsMobile();
  // The AI chat page renders as a full-screen app (its own bottom nav in
  // mobile) — strip the main padding and hide the global bottom tabs there.
  const isAiChatRoute = location.pathname === '/ai';

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
          return res.success && res.data ? res.data.items.map((i) => ({ key: i.id, label: i.name })) : [];
        },
      },
      {
        key: 'opportunities',
        groupKey: 'sidebar.crm.opportunities',
        path: '/crm/opportunities',
        icon: Target,
        fetch: async (companyId, q) => {
          const res = await crmApi.getOpportunitiesPaginated(companyId, 1, 5, { search: q });
          return res.success && res.data ? res.data.items.map((i) => ({ key: i.id, label: i.name })) : [];
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

  // Close drawer when resizing up to desktop
  useEffect(() => {
    if (!isMobile && drawerOpen) setDrawerOpen(false);
  }, [isMobile, drawerOpen]);

  // Silent daily auto-backup (OPFS) — fire-and-forget, never blocks UI.
  const activeCompanyId = useAppStore((s) => s.activeCompany?.id);
  const activeCompanyName = useAppStore((s) => s.activeCompany?.name);
  useEffect(() => {
    if (!isAuthenticated || !activeCompanyId) return;
    void import('@/core/backup/backupService').then(({ maybeAutoBackup }) =>
      maybeAutoBackup(activeCompanyId, activeCompanyName || 'company'),
    );
  }, [isAuthenticated, activeCompanyId, activeCompanyName]);

  return (
    <div className="flex h-dvh w-screen overflow-hidden bg-zinc-50 dark:bg-zinc-950">
      <Sidebar />
      <MobileDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} />
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        <Header onOpenSearch={() => setPaletteOpen(true)} onOpenMenu={() => setDrawerOpen(true)} />
        <main
          className={
            isAiChatRoute
              ? 'flex-1 overflow-hidden p-0!'
              : 'flex-1 overflow-y-auto p-3 sm:p-4 lg:p-6 pb-24 lg:pb-6'
          }
        >
          <Outlet />
        </main>
      </div>
      {!isAiChatRoute && <BottomTabs onOpenMore={() => setDrawerOpen(true)} />}
      <CommandPalette
        open={paletteOpen}
        onOpen={() => setPaletteOpen(true)}
        onClose={() => setPaletteOpen(false)}
        entitySources={entitySources}
      />
      <ToastContainer />
      <React.Suspense fallback={null}>
        <ChatWidget />
      </React.Suspense>
    </div>
  );
};

export default Sidebar;
