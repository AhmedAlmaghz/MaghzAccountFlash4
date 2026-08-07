import React from 'react';
import { Outlet, Link, useLocation } from 'react-router-dom';
import { FileText, Users, Tag, Undo2 } from 'lucide-react';
import { cn } from '@/core/utils';
import { useTranslation } from '@/core/i18n/useTranslation';

export const SalesPage: React.FC = () => {
  const { t } = useTranslation();
  const location = useLocation();
  const isRoot = location.pathname === '/sales';

  const salesMenu = [
    { id: 'invoices', label: t('sales.tabs.invoices'), icon: FileText, path: '/sales/invoices' },
    { id: 'customers', label: t('sales.tabs.customers'), icon: Users, path: '/sales/customers' },
    { id: 'quotations', label: t('sales.tabs.quotations'), icon: Tag, path: '/sales/quotations' },
    { id: 'returns', label: t('sales.tabs.returns'), icon: Undo2, path: '/sales/returns' },
  ];

  return (
    <div className="space-y-6 animate-fade-in">
      {isRoot ? (
        <>
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">{t('sales.page.title')}</h1>
            <p className="text-slate-500 dark:text-slate-400 text-sm mt-1">{t('sales.page.subtitle')}</p>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {salesMenu.map(item => {
              const Icon = item.icon;
              return (
                <Link
                  key={item.id}
                  to={item.path}
                  className="card flex items-center gap-4 p-5 hover:border-primary-500 dark:hover:border-primary-400 transition-colors group"
                >
                  <div className="w-12 h-12 bg-primary-100 dark:bg-primary-900/30 rounded-lg flex items-center justify-center shrink-0 group-hover:bg-primary-200 dark:group-hover:bg-primary-800/40 transition-colors">
                    <Icon size={24} className="text-primary-600 dark:text-primary-400" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-slate-900 dark:text-slate-50">{item.label}</h3>
                  </div>
                </Link>
              );
            })}
          </div>
        </>
      ) : (
        <>
          <div className="flex items-center gap-2 border-b border-slate-200 dark:border-slate-800 pb-2 overflow-x-auto">
            {salesMenu.map(item => {
              const Icon = item.icon;
              const isActive = location.pathname === item.path;
              return (
                <Link
                  key={item.id}
                  to={item.path}
                  className={cn(
                    'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap',
                    isActive
                      ? 'bg-primary-600 text-white'
                      : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                  )}
                >
                  <Icon size={16} />
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

export default SalesPage;
