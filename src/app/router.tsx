import React, { useEffect } from 'react';
import { BrowserRouter, HashRouter, Routes, Route, useNavigate, useLocation, Outlet, Navigate } from 'react-router-dom';
import { isElectron } from '@/core/database/adapters';
import { PageLoader } from '@/core/ui/components/PageLoader';
import { AppLayout } from './layout';
import { useAuthStore } from '@/modules/auth/store';
import { useCanAccessModule } from '@/modules/auth/hooks/usePermission';
import type { Permission } from '@/modules/auth/types';

// Lazy load modules for better performance
const DashboardPage = React.lazy(() => import('@/modules/reports/dashboards/MainDashboard'));
const AccountingPage = React.lazy(() => import('@/modules/accounting/components/AccountingPage'));
const InventoryPage = React.lazy(() => import('@/modules/inventory/components/InventoryPage'));
const SalesPage = React.lazy(() => import('@/modules/sales/components/SalesPage'));
const PurchasesPage = React.lazy(() => import('@/modules/purchases/components/PurchasesPage'));
const ManufacturingPage = React.lazy(() => import('@/modules/manufacturing/components/ManufacturingPage'));
const HrPage = React.lazy(() => import('@/modules/hr/components/HrPage'));
const CrmPage = React.lazy(() => import('@/modules/crm/components/CrmPage'));
const ReportsPage = React.lazy(() => import('@/modules/reports/ReportsHubPage'));

// Analytical reports
const SalesAnalysisReport = React.lazy(() => import('@/modules/reports/SalesAnalysisReport'));
const InventoryAnalysisReport = React.lazy(() => import('@/modules/reports/InventoryAnalysisReport'));
const LowStockAlertReport = React.lazy(() => import('@/modules/reports/LowStockAlertReport'));
const StockMovementReport = React.lazy(() => import('@/modules/reports/StockMovementReport'));
const StockValuationReport = React.lazy(() => import('@/modules/reports/StockValuationReport'));
const CustomerStatementReport = React.lazy(() => import('@/modules/reports/CustomerStatementReport'));
const SupplierStatementReport = React.lazy(() => import('@/modules/reports/SupplierStatementReport'));
const ProfitAnalysisReport = React.lazy(() => import('@/modules/reports/ProfitAnalysisReport'));
const CustomReportBuilder = React.lazy(() => import('@/modules/reports/components/CustomReportBuilder'));
const LeadConversionReport = React.lazy(() => import('@/modules/reports/LeadConversionReport'));
const OpportunityPipelineReport = React.lazy(() => import('@/modules/reports/OpportunityPipelineReport'));

// Auth pages
const LoginPage = React.lazy(() => import('@/modules/auth/components/LoginPage'));
const UsersPage = React.lazy(() => import('@/modules/auth/components/UsersPage'));
const RolesPage = React.lazy(() => import('@/modules/auth/components/RolesPage'));
const AuditLogPage = React.lazy(() => import('@/modules/auth/components/AuditLogPage'));

// Accounting sub-pages
const ChartOfAccounts = React.lazy(() => import('@/modules/accounting/components/ChartOfAccounts'));
const JournalEntriesPage = React.lazy(() => import('@/modules/accounting/components/JournalEntriesPage'));
const TrialBalancePage = React.lazy(() => import('@/modules/accounting/components/TrialBalancePage'));
const BalanceSheetPage = React.lazy(() => import('@/modules/accounting/components/BalanceSheetPage'));
const ProfitLossPage = React.lazy(() => import('@/modules/accounting/components/ProfitLossPage'));
const CashFlowPage = React.lazy(() => import('@/modules/accounting/components/CashFlowPage'));
const ReceiptVouchersPage = React.lazy(() => import('@/modules/accounting/components/ReceiptVouchersPage'));
const PaymentVouchersPage = React.lazy(() => import('@/modules/accounting/components/PaymentVouchersPage'));
const AccountLedgerPage = React.lazy(() => import('@/modules/accounting/components/AccountLedgerPage'));

// Inventory sub-pages
const ProductsPage = React.lazy(() => import('@/modules/inventory/components/ProductsPage'));
const WarehousesPage = React.lazy(() => import('@/modules/inventory/components/WarehousesPage'));
  const InventoryTransactionsPage = React.lazy(() => import('@/modules/inventory/components/InventoryTransactionsPage'));
  const StockAdjustmentPage = React.lazy(() => import('@/modules/inventory/components/StockAdjustmentPage'));
  const StockPage = React.lazy(() => import('@/modules/inventory/components/StockPage'));

  // Sales sub-pages
const InvoicesPage = React.lazy(() => import('@/modules/sales/components/InvoicesPage'));
const CustomersPage = React.lazy(() => import('@/modules/sales/components/CustomersPage'));
const QuotationsPage = React.lazy(() => import('@/modules/sales/components/QuotationsPage'));
const SalesReturnsPage = React.lazy(() => import('@/modules/sales/components/SalesReturnsPage'));

// Purchases sub-pages
const PurchaseInvoicesPage = React.lazy(() => import('@/modules/purchases/components/PurchaseInvoicesPage'));
const PurchaseOrdersPage = React.lazy(() => import('@/modules/purchases/components/PurchaseOrdersPage'));
const SuppliersPage = React.lazy(() => import('@/modules/purchases/components/SuppliersPage'));
const PurchaseReturnsPage = React.lazy(() => import('@/modules/purchases/components/PurchaseReturnsPage'));

// Manufacturing sub-pages
const WorkOrdersPage = React.lazy(() => import('@/modules/manufacturing/components/WorkOrdersPage'));
const BomPage = React.lazy(() => import('@/modules/manufacturing/components/BomPage'));
const ProductionCostReport = React.lazy(() => import('@/modules/manufacturing/components/ProductionCostReport'));
const VarianceAnalysisReport = React.lazy(() => import('@/modules/manufacturing/components/VarianceAnalysisReport'));

// HR sub-pages
const EmployeesPage = React.lazy(() => import('@/modules/hr/components/EmployeesPage'));
const AttendancePage = React.lazy(() => import('@/modules/hr/components/AttendancePage'));
const PayrollPage = React.lazy(() => import('@/modules/hr/components/PayrollPage'));
const LeavesPage = React.lazy(() => import('@/modules/hr/components/LeavesPage'));
const EndOfServicePage = React.lazy(() => import('@/modules/hr/components/EndOfServicePage'));

// CRM sub-pages
const LeadsPage = React.lazy(() => import('@/modules/crm/components/LeadsPage'));
const OpportunitiesPage = React.lazy(() => import('@/modules/crm/components/OpportunitiesPage'));
const TasksPage = React.lazy(() => import('@/modules/crm/components/TasksPage'));
const ActivitiesPage = React.lazy(() => import('@/modules/crm/components/ActivitiesPage'));

// AI pages
const AiChatPage = React.lazy(() => import('@/modules/ai/components/AiChatPage'));
const AiSettingsPage = React.lazy(() => import('@/modules/ai/components/AiSettingsPage'));

// Settings with nested routes
const SettingsLayout = React.lazy(() => import('@/modules/core/components/SettingsPage'));
const CompanySetup = React.lazy(() => import('@/modules/settings/components/CompanySetupPage'));
const CurrenciesPage = React.lazy(() => import('@/modules/settings/components/CurrenciesPage'));
const VatSettingsPage = React.lazy(() => import('@/modules/settings/components/VatSettingsPage'));
const BranchesPage = React.lazy(() => import('@/modules/settings/components/BranchesPage'));
const BackupPage = React.lazy(() => import('@/modules/core/components/BackupPage'));
const UsersSettingsPage = React.lazy(() => import('@/modules/settings/components/UsersPage'));
const ResetOnboardingPage = React.lazy(() => import('@/modules/settings/components/ResetOnboardingPage'));

// New admin screens
const DocumentSequencesPage = React.lazy(() => import('@/modules/settings/components/DocumentSequencesPage'));
const ProductTypesPage = React.lazy(() => import('@/modules/settings/components/ProductTypesPage'));
const ProductCategoriesPage = React.lazy(() => import('@/modules/settings/components/ProductCategoriesPage'));
const DefaultAccountsPage = React.lazy(() => import('@/modules/settings/components/DefaultAccountsPage'));
const UnitsPage = React.lazy(() => import('@/modules/settings/components/UnitsPage'));
const CashBoxesPage = React.lazy(() => import('@/modules/settings/components/CashBoxesPage'));
const BanksPage = React.lazy(() => import('@/modules/settings/components/BanksPage'));
const CostCentersPage = React.lazy(() => import('@/modules/settings/components/CostCentersPage'));
const DatabaseSettingsPage = React.lazy(() => import('@/modules/settings/components/DatabaseSettingsPage'));

const withSuspense = (Component: React.ComponentType) => (
  <React.Suspense fallback={<PageLoader />}>
    <Component />
  </React.Suspense>
);

// Protected Route wrapper
const ProtectedRoute = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const isLoading = useAuthStore((state) => state.isLoading);

  useEffect(() => {
    if (!isLoading && !isAuthenticated && location.pathname !== '/login') {
      navigate('/login');
    }
  }, [isAuthenticated, isLoading, navigate, location]);

  if (isLoading) return <PageLoader />;
  if (!isAuthenticated) return null;

  return <Outlet />;
};

type Module = 'core' | 'accounting' | 'inventory' | 'sales' | 'purchases' | 'manufacturing' | 'hr' | 'crm' | 'reports' | 'settings' | 'ai';

// Route-level RBAC guard. Hiding a menu item is not protection — the URL is
// still reachable directly. Each module's pages are wrapped so a user without
// module access lands back on the dashboard. Mirrors the sidebar logic:
// `module` = view/own/create access; an explicit `permission` covers one-offs.
const PermissionRoute: React.FC<{ module?: Module; permission?: Permission }> = ({ module, permission }) => {
  const user = useAuthStore((s) => s.user);
  useAuthStore((s) => s.permissions);
  const moduleAccess = useCanAccessModule(module ?? 'core');

  if (user) {
    const allowed = module !== undefined
      ? moduleAccess
      : permission ? useAuthStore.getState().hasPermission(permission) : true;
    if (!allowed) return <Navigate to="/" replace />;
  }
  return <Outlet />;
};

const Router = isElectron() ? HashRouter : BrowserRouter;

export const AppRouter: React.FC = () => {
  return (
    <Router>
      <Routes>
        {/* Public route */}
        <Route path="/login" element={withSuspense(LoginPage)} />
        
        {/* Protected layout route */}
        <Route element={<ProtectedRoute />}>
          {/* App layout route — renders Outlet inside AppLayout shell */}
          <Route element={<AppLayout />}>
            <Route path="/" element={withSuspense(DashboardPage)} />

            {/* Accounting with nested routes */}
            <Route element={<PermissionRoute module="accounting" />}>
              <Route path="/accounting" element={withSuspense(AccountingPage)}>
                <Route path="chart" element={withSuspense(ChartOfAccounts)} />
                <Route path="journal" element={withSuspense(JournalEntriesPage)} />
                <Route path="trial" element={withSuspense(TrialBalancePage)} />
                <Route path="balance" element={withSuspense(BalanceSheetPage)} />
                <Route path="profit" element={withSuspense(ProfitLossPage)} />
                <Route path="cashflow" element={withSuspense(CashFlowPage)} />
                <Route path="receipt-vouchers" element={withSuspense(ReceiptVouchersPage)} />
                <Route path="payment-vouchers" element={withSuspense(PaymentVouchersPage)} />
                <Route path="ledger" element={withSuspense(AccountLedgerPage)} />
              </Route>
            </Route>

            {/* Inventory with nested routes */}
            <Route element={<PermissionRoute module="inventory" />}>
              <Route path="/inventory" element={withSuspense(InventoryPage)}>
                <Route path="products" element={withSuspense(ProductsPage)} />
                <Route path="warehouses" element={withSuspense(WarehousesPage)} />
                <Route path="stock" element={withSuspense(StockPage)} />
                <Route path="transactions" element={withSuspense(InventoryTransactionsPage)} />
                <Route path="adjustments" element={withSuspense(StockAdjustmentPage)} />
              </Route>
            </Route>

            {/* Sales with nested routes */}
            <Route element={<PermissionRoute module="sales" />}>
              <Route path="/sales" element={withSuspense(SalesPage)}>
                <Route path="invoices" element={withSuspense(InvoicesPage)} />
                <Route path="customers" element={withSuspense(CustomersPage)} />
                <Route path="quotations" element={withSuspense(QuotationsPage)} />
                <Route path="returns" element={withSuspense(SalesReturnsPage)} />
              </Route>
            </Route>

            {/* Purchases with nested routes */}
            <Route element={<PermissionRoute module="purchases" />}>
              <Route path="/purchases" element={withSuspense(PurchasesPage)}>
                <Route path="invoices" element={withSuspense(PurchaseInvoicesPage)} />
                <Route path="orders" element={withSuspense(PurchaseOrdersPage)} />
                <Route path="suppliers" element={withSuspense(SuppliersPage)} />
                <Route path="returns" element={withSuspense(PurchaseReturnsPage)} />
              </Route>
            </Route>

            {/* Manufacturing with nested routes */}
            <Route element={<PermissionRoute module="manufacturing" />}>
              <Route path="/manufacturing" element={withSuspense(ManufacturingPage)}>
                <Route path="work-orders" element={withSuspense(WorkOrdersPage)} />
                <Route path="bom" element={withSuspense(BomPage)} />
                <Route path="cost-report" element={withSuspense(ProductionCostReport)} />
                <Route path="variance-report" element={withSuspense(VarianceAnalysisReport)} />
              </Route>
            </Route>

            {/* HR with nested routes */}
            <Route element={<PermissionRoute module="hr" />}>
              <Route path="/hr" element={withSuspense(HrPage)}>
                <Route path="employees" element={withSuspense(EmployeesPage)} />
                <Route path="attendance" element={withSuspense(AttendancePage)} />
                <Route path="payroll" element={withSuspense(PayrollPage)} />
                <Route path="leaves" element={withSuspense(LeavesPage)} />
                <Route path="end-of-service" element={withSuspense(EndOfServicePage)} />
              </Route>
            </Route>

            {/* CRM with nested routes */}
            <Route element={<PermissionRoute module="crm" />}>
              <Route path="/crm" element={withSuspense(CrmPage)}>
                <Route path="leads" element={withSuspense(LeadsPage)} />
                <Route path="opportunities" element={withSuspense(OpportunitiesPage)} />
                <Route path="tasks" element={withSuspense(TasksPage)} />
                <Route path="activities" element={withSuspense(ActivitiesPage)} />
              </Route>
            </Route>

            {/* Reports hub & analytical reports */}
            <Route element={<PermissionRoute module="reports" />}>
              <Route path="/reports" element={withSuspense(ReportsPage)} />
              <Route path="/reports/sales-analysis" element={withSuspense(SalesAnalysisReport)} />
              <Route path="/reports/inventory-analysis" element={withSuspense(InventoryAnalysisReport)} />
              <Route path="/reports/low-stock-alert" element={withSuspense(LowStockAlertReport)} />
              <Route path="/reports/stock-movement" element={withSuspense(StockMovementReport)} />
              <Route path="/reports/stock-valuation" element={withSuspense(StockValuationReport)} />
              <Route path="/reports/customer-statement" element={withSuspense(CustomerStatementReport)} />
              <Route path="/reports/supplier-statement" element={withSuspense(SupplierStatementReport)} />
              <Route path="/reports/profit-analysis" element={withSuspense(ProfitAnalysisReport)} />
              <Route path="/reports/custom-builder" element={withSuspense(CustomReportBuilder)} />
              <Route path="/reports/lead-conversion" element={withSuspense(LeadConversionReport)} />
              <Route path="/reports/opportunity-pipeline" element={withSuspense(OpportunityPipelineReport)} />
            </Route>

            <Route element={<PermissionRoute permission="settings.view" />}>
              <Route path="/users" element={withSuspense(UsersPage)} />
              <Route path="/roles" element={withSuspense(RolesPage)} />
              <Route path="/audit-logs" element={withSuspense(AuditLogPage)} />
            </Route>

            {/* Settings with nested routes */}
            <Route element={<PermissionRoute module="settings" />}>
              <Route path="/settings" element={withSuspense(SettingsLayout)}>
                <Route path="company" element={withSuspense(CompanySetup)} />
                <Route path="currencies" element={withSuspense(CurrenciesPage)} />
                <Route path="vat" element={withSuspense(VatSettingsPage)} />
                <Route path="branches" element={withSuspense(BranchesPage)} />
                <Route path="backup" element={withSuspense(BackupPage)} />
                <Route path="document-sequences" element={withSuspense(DocumentSequencesPage)} />
                <Route path="product-types" element={withSuspense(ProductTypesPage)} />
                <Route path="product-categories" element={withSuspense(ProductCategoriesPage)} />
                <Route path="default-accounts" element={withSuspense(DefaultAccountsPage)} />
                <Route path="units" element={withSuspense(UnitsPage)} />
                <Route path="cash-boxes" element={withSuspense(CashBoxesPage)} />
                <Route path="banks" element={withSuspense(BanksPage)} />
                <Route path="cost-centers" element={withSuspense(CostCentersPage)} />
                <Route path="database" element={withSuspense(DatabaseSettingsPage)} />
                <Route path="users" element={withSuspense(UsersSettingsPage)} />
                <Route path="reset" element={withSuspense(ResetOnboardingPage)} />
                <Route path="ai" element={withSuspense(AiSettingsPage)} />
              </Route>
            </Route>

            {/* AI Chat */}
            <Route element={<PermissionRoute module="ai" />}>
              <Route path="/ai" element={withSuspense(AiChatPage)} />
            </Route>
          </Route>
        </Route>
      </Routes>
    </Router>
  );
};
