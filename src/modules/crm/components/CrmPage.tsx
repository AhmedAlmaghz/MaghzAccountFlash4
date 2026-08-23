import React from 'react';
import { Outlet, Link, useLocation } from 'react-router-dom';
import { Target, Activity, ListTodo, Handshake, Sparkles } from 'lucide-react';
import { cn } from '@/core/utils';
import { useTranslation } from '@/core/i18n/useTranslation';
import { Card } from '@/core/ui/components';
import { useAppStore } from '@/core/store';
import { useLeadsPaginated, useOpportunitiesPaginated, useTasksPaginated } from '../hooks/useCrm';

export const CrmPage: React.FC = () => {
  const { t } = useTranslation();
  const location = useLocation();
  const isRoot = location.pathname === '/crm';
  const activeCompany = useAppStore((s) => s.activeCompany);
  const companyId = activeCompany?.id || '';

  const { total: leadsTotal } = useLeadsPaginated(companyId, {});
  const { total: opportunitiesTotal } = useOpportunitiesPaginated(companyId, {});
  const { total: tasksTotal } = useTasksPaginated(companyId, {});

  const crmMenu: Array<{ id: string; label: string; desc: string; icon: React.ElementType; path: string; color: string; bg: string; count: number | null }> = [
    { id: 'leads', label: t('crm.tabs.leads'), desc: 'العملاء المحتملون والتقييم والتحويل إلى عملاء', icon: Target, path: '/crm/leads', color: 'from-rose-600 to-rose-700', bg: 'bg-rose-50 dark:bg-rose-900/20', count: leadsTotal },
    { id: 'opportunities', label: t('crm.tabs.opportunities'), desc: 'الفرص البيعية ومراحل التفاوض والإغلاق', icon: Handshake, path: '/crm/opportunities', color: 'from-fuchsia-600 to-fuchsia-700', bg: 'bg-fuchsia-50 dark:bg-fuchsia-900/20', count: opportunitiesTotal },
    { id: 'tasks', label: t('crm.tabs.tasks'), desc: 'مهام المتابعة والأولويات وتواريخ الاستحقاق', icon: ListTodo, path: '/crm/tasks', color: 'from-sky-600 to-sky-700', bg: 'bg-sky-50 dark:bg-sky-900/20', count: tasksTotal },
    { id: 'activities', label: t('crm.tabs.activities'), desc: 'سجل المكالمات والاجتماعات والزيارات', icon: Activity, path: '/crm/activities', color: 'from-teal-600 to-teal-700', bg: 'bg-teal-50 dark:bg-teal-900/20', count: null },
  ];

  return (
    <div className="space-y-5 animate-fade-in">
      {isRoot ? (
        <>
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-rose-600 to-fuchsia-700 flex items-center justify-center shadow-sm">
              <Handshake size={22} className="text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50 tracking-tight">{t('crm.title')}</h1>
              <p className="text-sm text-slate-500 dark:text-slate-400">{t('crm.description')}</p>
            </div>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Card className="p-4 flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold tracking-wider uppercase text-slate-500">{t('crm.tabs.leads')}</p>
                <p className="text-2xl font-bold text-slate-900 dark:text-slate-50 tabular-nums">{leadsTotal}</p>
                <p className="text-xs text-slate-500">عملاء محتملون</p>
              </div>
              <div className="w-10 h-10 rounded-xl bg-rose-50 dark:bg-rose-900/20 flex items-center justify-center">
                <Target size={18} className="text-rose-600" />
              </div>
            </Card>
            <Card className="p-4 flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold tracking-wider uppercase text-slate-500">{t('crm.tabs.opportunities')}</p>
                <p className="text-2xl font-bold text-fuchsia-600 tabular-nums">{opportunitiesTotal}</p>
                <p className="text-xs text-slate-500">فرص بيعية نشطة</p>
              </div>
              <div className="w-10 h-10 rounded-xl bg-fuchsia-50 dark:bg-fuchsia-900/20 flex items-center justify-center">
                <Handshake size={18} className="text-fuchsia-600" />
              </div>
            </Card>
            <Card className="p-4 flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold tracking-wider uppercase text-slate-500">{t('crm.tabs.tasks')}</p>
                <p className="text-2xl font-bold text-sky-600 tabular-nums">{tasksTotal}</p>
                <p className="text-xs text-slate-500">مهام متابعة</p>
              </div>
              <div className="w-10 h-10 rounded-xl bg-sky-50 dark:bg-sky-900/20 flex items-center justify-center">
                <ListTodo size={18} className="text-sky-600" />
              </div>
            </Card>
            <Card className="p-4 flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold tracking-wider uppercase text-slate-500">{t('crm.tabs.activities')}</p>
                <p className="text-2xl font-bold text-teal-600 tabular-nums">—</p>
                <p className="text-xs text-slate-500">سجل التواصل مع العملاء</p>
              </div>
              <div className="w-10 h-10 rounded-xl bg-teal-50 dark:bg-teal-900/20 flex items-center justify-center">
                <Activity size={18} className="text-teal-600" />
              </div>
            </Card>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {crmMenu.map((item) => {
              const Icon = item.icon;
              return (
                <Link
                  key={item.id}
                  to={item.path}
                  className="group relative overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5 hover:shadow-lg hover:border-rose-200 dark:hover:border-rose-800 transition-all"
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
                  <div className="mt-4 flex items-center gap-1 text-xs font-medium text-rose-600 dark:text-rose-400 group-hover:gap-2 transition-all">
                    فتح <span aria-hidden>←</span>
                  </div>
                </Link>
              );
            })}
          </div>

          <Card className="p-4 bg-gradient-to-r from-rose-600 to-fuchsia-700 text-white border-0">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-white/15 flex items-center justify-center">
                <Sparkles size={18} className="text-white" />
              </div>
              <div>
                <p className="font-semibold">نصائح إدارة العلاقات</p>
                <p className="text-sm text-white/80">صنّف العملاء المحتملين (ساخن/دافئ/بارد) وتابع الساخنين أولاً، وحرّك الفرص في لوحة المراحل بالسحب والإفلات، وسجّل كل مكالمة أو زيارة في النشاطات، وأنجز مهام المتابعة قبل تاريخ الاستحقاق.</p>
              </div>
            </div>
          </Card>
        </>
      ) : (
        <>
          <div className="flex items-center gap-1.5 border-b border-slate-200 dark:border-slate-800 pb-2 overflow-x-auto -mx-1 px-1">
            {crmMenu.map((item) => {
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

export default CrmPage;
