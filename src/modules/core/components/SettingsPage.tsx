import React from 'react';
import { Outlet, Link, useLocation } from 'react-router-dom';
import {
  Building2,
  Coins,
  Receipt,
  GitBranch,
  Hash,
  Users,
  Shield,
  DatabaseBackup,
  ChevronLeft,
  Settings,
  RefreshCcw,
  Layers,
  Tag,
  Ruler,
  BookOpen,
  Vault,
  Landmark,
  Target,
  Database as DatabaseIcon,
} from 'lucide-react';
import { cn } from '@/core/utils';
import { useTranslation } from '@/core/i18n/useTranslation';

interface SettingsMenuItem {
  id: string;
  labelKey: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  path: string;
}

const menuItems: SettingsMenuItem[] = [
  { id: 'company', labelKey: 'settings.menu.company', icon: Building2, path: '/settings/company' },
  { id: 'currencies', labelKey: 'settings.menu.currencies', icon: Coins, path: '/settings/currencies' },
  { id: 'vat', labelKey: 'settings.menu.vat', icon: Receipt, path: '/settings/vat' },
  { id: 'branches', labelKey: 'settings.menu.branches', icon: GitBranch, path: '/settings/branches' },
  { id: 'document-sequences', labelKey: 'settings.menu.documentSequences', icon: Hash, path: '/settings/document-sequences' },
  { id: 'default-accounts', labelKey: 'settings.menu.defaultAccounts', icon: BookOpen, path: '/settings/default-accounts' },
  { id: 'product-types', labelKey: 'settings.menu.productTypes', icon: Layers, path: '/settings/product-types' },
  { id: 'product-categories', labelKey: 'settings.menu.productCategories', icon: Tag, path: '/settings/product-categories' },
  { id: 'units', labelKey: 'settings.menu.units', icon: Ruler, path: '/settings/units' },
  { id: 'cash-boxes', labelKey: 'settings.menu.cashBoxes', icon: Vault, path: '/settings/cash-boxes' },
  { id: 'banks', labelKey: 'settings.menu.banks', icon: Landmark, path: '/settings/banks' },
  { id: 'cost-centers', labelKey: 'settings.menu.costCenters', icon: Target, path: '/settings/cost-centers' },
  { id: 'users', labelKey: 'settings.menu.users', icon: Users, path: '/settings/users' },
  { id: 'roles', labelKey: 'settings.menu.roles', icon: Shield, path: '/roles' },
  { id: 'database', labelKey: 'settings.menu.database', icon: DatabaseIcon, path: '/settings/database' },
  { id: 'backup', labelKey: 'settings.menu.backup', icon: DatabaseBackup, path: '/settings/backup' },
  { id: 'reset', labelKey: 'settings.menu.reset', icon: RefreshCcw, path: '/settings/reset' },
];

export const SettingsPage: React.FC = () => {
  const location = useLocation();
  const { t } = useTranslation();

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="page-header">
        <div className="flex items-center gap-3">
          <Settings size={28} className="text-primary-600 dark:text-primary-400" />
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">{t('settings.pageTitle')}</h1>
            <p className="text-slate-500 dark:text-slate-400 text-sm">{t('settings.pageSubtitle')}</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Sidebar Menu */}
        <div className="lg:col-span-1 space-y-2">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-3 space-y-1">
            {menuItems.map((item) => {
              const Icon = item.icon;
              const isActive = location.pathname === item.path;
              return (
                <Link
                  key={item.id}
                  to={item.path}
                  className={cn(
                    'flex items-center gap-3 px-4 py-3 rounded-lg transition-all duration-150',
                    isActive
                      ? 'bg-primary-50 dark:bg-primary-900/20 text-primary-700 dark:text-primary-400 font-medium'
                      : 'text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800'
                  )}
                >
                  <Icon size={18} />
                  <span className="text-sm">{t(item.labelKey)}</span>
                  {isActive && <ChevronLeft size={16} className="mr-auto" />}
                </Link>
              );
            })}
          </div>
        </div>

        {/* Content Area */}
        <div className="lg:col-span-3">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6">
            <Outlet />
          </div>
        </div>
      </div>
    </div>
  );
};

export default SettingsPage;
