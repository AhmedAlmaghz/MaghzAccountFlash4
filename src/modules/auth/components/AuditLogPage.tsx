import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ScrollText, FileSpreadsheet, FileText, Calendar, User, Database, Activity } from 'lucide-react';
import { Card, Button } from '@/core/ui/components';
import { DataTablePro } from '@/core/ui/components/DataTablePro';
import { EmptyState } from '@/core/ui/components/EmptyState';
import { useAuthStore } from '../store';
import { useAuditLogs } from '../hooks/useAuth';
import { useTranslation } from '@/core/i18n/useTranslation';
import { useAppStore } from '@/core/store';
import { exportToExcel, exportToPDF } from '@/core/utils/exportEngine';
import { formatDateTime } from '@/core/utils/locale';
import type { AuditLog } from '../types';
import type { ColumnDef } from '@tanstack/react-table';

const ACTION_COLORS: Record<string, string> = {
  create: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  update: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  delete: 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400',
  post: 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400',
  cancel: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  login: 'bg-primary-100 text-primary-700 dark:bg-primary-900/30 dark:text-primary-400',
  logout: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-400',
  reset_password: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
  toggle_active: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-400',
};

export const AuditLogPage: React.FC = () => {
  const navigate = useNavigate();
  const activeCompany = useAppStore((state) => state.activeCompany);
  const hasPermission = useAuthStore((state) => state.hasPermission);
  const { t } = useTranslation();
  const actionLabels: Record<string, string> = {
    create: t('auth.auditLog.action_create'),
    update: t('auth.auditLog.action_update'),
    delete: t('auth.auditLog.action_delete'),
    post: t('auth.auditLog.action_post'),
    cancel: t('auth.auditLog.action_cancel'),
    login: t('auth.auditLog.action_login'),
    logout: t('auth.auditLog.action_logout'),
    reset_password: t('auth.auditLog.action_resetPassword'),
    toggle_active: t('auth.auditLog.action_toggleActive'),
  };
  const tableLabels: Record<string, string> = {
    users: t('auth.auditLog.table_users'),
    roles: t('auth.auditLog.table_roles'),
    accounts: t('auth.auditLog.table_accounts'),
    transactions: t('auth.auditLog.table_transactions'),
    products: t('auth.auditLog.table_products'),
    contacts: t('auth.auditLog.table_contacts'),
    sales_invoices: t('auth.auditLog.table_sales_invoices'),
    purchase_invoices: t('auth.auditLog.table_purchase_invoices'),
    employees: t('auth.auditLog.table_employees'),
    warehouses: t('auth.auditLog.table_warehouses'),
  };
  const [filters, setFilters] = useState({
    userId: '',
    tableName: '',
    action: '',
    fromDate: '',
    toDate: '',
  });
  const { logs, isLoading } = useAuditLogs(activeCompany?.id || '', {
    userId: filters.userId || undefined,
    tableName: filters.tableName || undefined,
    action: filters.action || undefined,
    fromDate: filters.fromDate || undefined,
    toDate: filters.toDate || undefined,
  });

  // Redirect if no permission
  React.useEffect(() => {
    if (!hasPermission('settings.audit_log')) {
      navigate('/');
    }
  }, [hasPermission, navigate]);

  const handleExportExcel = () => {
    exportToExcel(
      logs.map((l) => ({
        username: l.username,
        action: actionLabels[l.action] || l.action,
        tableName: tableLabels[l.tableName] || l.tableName,
        recordId: l.recordId,
        recordLabel: l.recordLabel || '',
        createdAt: formatDateTime(l.createdAt),
      })),
      [
        { key: 'username', header: t('auth.auditLog.user'), width: 20 },
        { key: 'action', header: t('auth.auditLog.action'), width: 15 },
        { key: 'tableName', header: t('auth.auditLog.table'), width: 20 },
        { key: 'recordId', header: t('auth.auditLog.recordId'), width: 15 },
        { key: 'recordLabel', header: t('auth.auditLog.recordLabel'), width: 25 },
        { key: 'createdAt', header: t('auth.auditLog.date'), width: 20 },
      ],
      `audit_log_${activeCompany?.id || 'export'}_${new Date().toISOString().split('T')[0]}`
    );
  };

  const handleExportPDF = () => {
    exportToPDF(
      logs.map((l) => ({
        username: l.username,
        action: actionLabels[l.action] || l.action,
        tableName: tableLabels[l.tableName] || l.tableName,
        recordId: l.recordId,
        createdAt: formatDateTime(l.createdAt),
      })),
      [
        { key: 'username', header: t('auth.auditLog.user'), width: 20 },
        { key: 'action', header: t('auth.auditLog.action'), width: 15 },
        { key: 'tableName', header: t('auth.auditLog.table'), width: 20 },
        { key: 'recordId', header: t('auth.auditLog.recordId'), width: 15 },
        { key: 'createdAt', header: t('auth.auditLog.date'), width: 20 },
      ],
      `audit_log_${activeCompany?.id || 'export'}_${new Date().toISOString().split('T')[0]}`,
      {
        title: t('auth.auditLog.logTitle'),
        subtitle: activeCompany?.name || '',
        companyName: activeCompany?.name || '',
        rtl: true,
      }
    );
  };

  const columns: ColumnDef<AuditLog>[] = [
    {
      accessorKey: 'username',
      header: t('auth.auditLog.user'),
      cell: ({ row }) => (
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-full bg-primary-100 dark:bg-primary-900/30 text-primary-600 flex items-center justify-center font-bold text-[10px]">
            {row.original.username?.charAt(0)}
          </div>
          <span className="font-medium text-slate-900 dark:text-slate-50">{row.original.username}</span>
        </div>
      ),
    },
    {
      accessorKey: 'action',
      header: t('auth.auditLog.action'),
      cell: ({ row }) => {
        const action = row.original.action;
        return (
          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${ACTION_COLORS[action] || 'bg-slate-100 text-slate-700'}`}>
            {actionLabels[action] || action}
          </span>
        );
      },
    },
    {
      accessorKey: 'tableName',
      header: t('auth.auditLog.table'),
      cell: ({ row }) => (
        <span className="text-sm text-slate-600 dark:text-slate-300">
          {tableLabels[row.original.tableName] || row.original.tableName}
        </span>
      ),
    },
    {
      accessorKey: 'recordId',
      header: t('auth.auditLog.recordId'),
      cell: ({ row }) => (
        <span className="text-xs font-mono text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded">
          {row.original.recordId.slice(0, 8)}...
        </span>
      ),
    },
    {
      accessorKey: 'createdAt',
      header: t('auth.auditLog.date'),
      cell: ({ row }) => (
        <span className="text-sm text-slate-600 dark:text-slate-300 tabular-nums">
          {formatDateTime(row.original.createdAt)}
        </span>
      ),
    },
  ];

  const hasActiveFilters = filters.userId || filters.tableName || filters.action || filters.fromDate || filters.toDate;

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-slate-700 rounded-xl flex items-center justify-center shadow-lg shadow-slate-700/20">
            <ScrollText size={20} className="text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">{t('auth.auditLog.title')}</h1>
            <p className="text-slate-500 dark:text-slate-400 text-sm">{t('auth.auditLog.subtitle')}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="ghost" onClick={handleExportExcel} title={t('auth.auditLog.exportExcel')}>
            <FileSpreadsheet size={16} className="text-emerald-600" />
            <span className="mr-1 text-emerald-600">Excel</span>
          </Button>
          <Button size="sm" variant="ghost" onClick={handleExportPDF} title={t('auth.auditLog.exportPdf')}>
            <FileText size={16} className="text-rose-600" />
            <span className="mr-1 text-rose-600">PDF</span>
          </Button>
        </div>
      </div>

      {/* Filters */}
      <Card className="p-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <div className="relative">
            <User className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <select
              value={filters.userId}
              onChange={(e) => setFilters((prev) => ({ ...prev, userId: e.target.value }))}
              className="form-control pr-9 w-full"
            >
              <option value="">{t('auth.auditLog.allUsers')}</option>
              <option value="user-1">{t('auth.auditLog.user_admin')}</option>
              <option value="user-2">{t('auth.auditLog.user_accountant')}</option>
              <option value="user-3">{t('auth.auditLog.user_sales')}</option>
              <option value="user-4">{t('auth.auditLog.user_manager')}</option>
            </select>
          </div>
          <div className="relative">
            <Database className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <select
              value={filters.tableName}
              onChange={(e) => setFilters((prev) => ({ ...prev, tableName: e.target.value }))}
              className="form-control pr-9 w-full"
            >
              <option value="">{t('auth.auditLog.allTables')}</option>
              <option value="users">{t('auth.auditLog.table_users')}</option>
              <option value="roles">{t('auth.auditLog.table_roles')}</option>
              <option value="accounts">{t('auth.auditLog.table_accounts')}</option>
              <option value="transactions">{t('auth.auditLog.table_transactions')}</option>
              <option value="products">{t('auth.auditLog.table_products')}</option>
              <option value="contacts">{t('auth.auditLog.table_contacts')}</option>
              <option value="sales_invoices">{t('auth.auditLog.table_sales_invoices')}</option>
              <option value="purchase_invoices">{t('auth.auditLog.table_purchase_invoices')}</option>
            </select>
          </div>
          <div className="relative">
            <Activity className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <select
              value={filters.action}
              onChange={(e) => setFilters((prev) => ({ ...prev, action: e.target.value }))}
              className="form-control pr-9 w-full"
            >
              <option value="">{t('auth.auditLog.allActions')}</option>
              <option value="create">{t('auth.auditLog.action_create')}</option>
              <option value="update">{t('auth.auditLog.action_update')}</option>
              <option value="delete">{t('auth.auditLog.action_delete')}</option>
              <option value="post">{t('auth.auditLog.action_post')}</option>
              <option value="login">{t('auth.auditLog.action_login')}</option>
              <option value="logout">{t('auth.auditLog.action_logout')}</option>
            </select>
          </div>
          <div className="relative">
            <Calendar className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="date"
              value={filters.fromDate}
              onChange={(e) => setFilters((prev) => ({ ...prev, fromDate: e.target.value }))}
              className="form-control pr-9 w-full"
              placeholder={t('auth.auditLog.fromDate')}
            />
          </div>
          <div className="relative">
            <Calendar className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="date"
              value={filters.toDate}
              onChange={(e) => setFilters((prev) => ({ ...prev, toDate: e.target.value }))}
              className="form-control pr-9 w-full"
              placeholder={t('auth.auditLog.toDate')}
            />
          </div>
        </div>
        {hasActiveFilters && (
          <div className="flex justify-end mt-3">
            <Button size="sm" variant="ghost" onClick={() => setFilters({ userId: '', tableName: '', action: '', fromDate: '', toDate: '' })}>
              {t('auth.auditLog.resetFilters')}
            </Button>
          </div>
        )}
      </Card>

      {/* Table */}
      <Card className="p-0 overflow-hidden">
        {isLoading ? (
          <div className="p-6 space-y-3">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-12 bg-slate-100 dark:bg-slate-800 rounded-lg animate-pulse-soft" />
            ))}
          </div>
        ) : logs.length === 0 ? (
          <div className="p-8">
            <EmptyState
              icon="search"
              title={t('auth.auditLog.emptyTitle')}
              description={t('auth.auditLog.emptyDesc')}
            />
          </div>
        ) : (
          <DataTablePro<AuditLog>
            data={logs}
            columns={columns}
            keyExtractor={(row) => row.id}
            isLoading={false}
            emptyMessage={t('auth.auditLog.emptyMessage')}
            searchable={false}
            title={t('auth.auditLog.recordsCount', { count: logs.length })}
            onExportExcel={handleExportExcel}
            onExportPdf={handleExportPDF}
          />
        )}
      </Card>
    </div>
  );
};

export default AuditLogPage;
