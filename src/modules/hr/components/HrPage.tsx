import React, { useMemo } from 'react';
import { Outlet, Link, useLocation } from 'react-router-dom';
import { Users, UserCheck, Banknote, Calendar, LogOut, HeartHandshake, Sparkles, Sliders } from 'lucide-react';
import { cn } from '@/core/utils';
import { useTranslation } from '@/core/i18n/useTranslation';
import { Card } from '@/core/ui/components';
import { useAppStore } from '@/core/store';
import { useEmployeesPaginated, useLeavesPaginated, usePayrollRunsPaginated, useEndOfServicesPaginated } from '../hooks/useHr';

export const HrPage: React.FC = () => {
  const location = useLocation();
  const { t } = useTranslation();
  const isRoot = location.pathname === '/hr';
  const activeCompany = useAppStore((s) => s.activeCompany);
  const companyId = activeCompany?.id || '';

  const { employees: employeeItems, total: employeesTotal } = useEmployeesPaginated(companyId, {});
  const { total: pendingLeavesTotal } = useLeavesPaginated(companyId, useMemo(() => ({ status: 'pending' }), []));
  const { total: payrollTotal } = usePayrollRunsPaginated(companyId, {});
  const { total: eosTotal } = useEndOfServicesPaginated(companyId, {});
  const activeEmployees = useMemo(() => employeeItems.filter((e) => e.isActive).length, [employeeItems]);

  const hrMenu: Array<{ id: string; labelKey: string; desc: string; icon: React.ElementType; path: string; color: string; bg: string; count: number | null }> = [
    { id: 'employees', labelKey: 'hr.page.menu.employees', desc: 'ملفات الموظفين والرواتب الأساسية والأقسام', icon: Users, path: '/hr/employees', color: 'from-indigo-600 to-indigo-700', bg: 'bg-indigo-50 dark:bg-indigo-900/20', count: employeesTotal },
    { id: 'attendance', labelKey: 'hr.page.menu.attendance', desc: 'تسجيل الحضور اليومي والساعات الإضافية', icon: UserCheck, path: '/hr/attendance', color: 'from-emerald-600 to-emerald-700', bg: 'bg-emerald-50 dark:bg-emerald-900/20', count: null },
    { id: 'payroll', labelKey: 'hr.page.menu.payroll', desc: 'مسيرات الرواتب الشهرية والترحيل المحاسبي', icon: Banknote, path: '/hr/payroll', color: 'from-violet-600 to-violet-700', bg: 'bg-violet-50 dark:bg-violet-900/20', count: payrollTotal },
    { id: 'leaves', labelKey: 'hr.page.menu.leaves', desc: 'طلبات الإجازات والموافقات والأرصدة', icon: Calendar, path: '/hr/leaves', color: 'from-blue-600 to-blue-700', bg: 'bg-blue-50 dark:bg-blue-900/20', count: pendingLeavesTotal },
    { id: 'end-of-service', labelKey: 'hr.page.menu.endOfService', desc: 'حسابات نهاية الخدمة والمكافآت', icon: LogOut, path: '/hr/end-of-service', color: 'from-amber-600 to-orange-600', bg: 'bg-amber-50 dark:bg-amber-900/20', count: eosTotal },
    { id: 'hr-policies', labelKey: 'hr.policy.title', desc: 'أرصدة الإجازات وساعات العمل ومعاملات نهاية الخدمة', icon: Sliders, path: '/settings/hr-policies', color: 'from-slate-600 to-slate-700', bg: 'bg-slate-100 dark:bg-slate-800', count: null },
  ];

  return (
    <div className="space-y-5 animate-fade-in">
      {isRoot ? (
        <>
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-violet-600 to-violet-700 flex items-center justify-center shadow-sm">
              <HeartHandshake size={22} className="text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50 tracking-tight">{t('hr.page.title')}</h1>
              <p className="text-sm text-slate-500 dark:text-slate-400">{t('hr.page.subtitle')}</p>
            </div>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Card className="p-4 flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold tracking-wider uppercase text-slate-500">{t('hr.employeesPage.title')}</p>
                <p className="text-2xl font-bold text-slate-900 dark:text-slate-50 tabular-nums">{employeesTotal}</p>
                <p className="text-xs text-slate-500">إجمالي الموظفين</p>
              </div>
              <div className="w-10 h-10 rounded-xl bg-indigo-50 dark:bg-indigo-900/20 flex items-center justify-center">
                <Users size={18} className="text-indigo-600" />
              </div>
            </Card>
            <Card className="p-4 flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold tracking-wider uppercase text-slate-500">{t('settings.common.active')}</p>
                <p className="text-2xl font-bold text-emerald-600 tabular-nums">{activeEmployees}</p>
                <p className="text-xs text-slate-500">على رأس العمل (بالصفحة الحالية)</p>
              </div>
              <div className="w-10 h-10 rounded-xl bg-emerald-50 dark:bg-emerald-900/20 flex items-center justify-center">
                <UserCheck size={18} className="text-emerald-600" />
              </div>
            </Card>
            <Card className="p-4 flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold tracking-wider uppercase text-slate-500">{t('hr.leaves.pending')}</p>
                <p className="text-2xl font-bold text-amber-600 tabular-nums">{pendingLeavesTotal}</p>
                <p className="text-xs text-slate-500">بانتظار الموافقة</p>
              </div>
              <div className="w-10 h-10 rounded-xl bg-amber-50 dark:bg-amber-900/20 flex items-center justify-center">
                <Calendar size={18} className="text-amber-600" />
              </div>
            </Card>
            <Card className="p-4 flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold tracking-wider uppercase text-slate-500">{t('hr.payroll.title')}</p>
                <p className="text-2xl font-bold text-violet-600 tabular-nums">{payrollTotal}</p>
                <p className="text-xs text-slate-500">مسيرات مسجلة</p>
              </div>
              <div className="w-10 h-10 rounded-xl bg-violet-50 dark:bg-violet-900/20 flex items-center justify-center">
                <Banknote size={18} className="text-violet-600" />
              </div>
            </Card>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {hrMenu.map((item) => {
              const Icon = item.icon;
              return (
                <Link
                  key={item.id}
                  to={item.path}
                  className="group relative overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5 hover:shadow-lg hover:border-violet-200 dark:hover:border-violet-800 transition-all"
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
                  <h3 className="mt-4 font-bold text-slate-900 dark:text-slate-50">{t(item.labelKey)}</h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">{item.desc}</p>
                  <div className="mt-4 flex items-center gap-1 text-xs font-medium text-violet-600 dark:text-violet-400 group-hover:gap-2 transition-all">
                    فتح <span aria-hidden>←</span>
                  </div>
                </Link>
              );
            })}
          </div>

          <Card className="p-4 bg-gradient-to-r from-violet-600 to-violet-700 text-white border-0">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-white/15 flex items-center justify-center">
                <Sparkles size={18} className="text-white" />
              </div>
              <div>
                <p className="font-semibold">نصائح الموارد البشرية</p>
                <p className="text-sm text-white/80">سجّل الحضور يومياً لتغذية مسير الرواتب تلقائياً، وراجع طلبات الإجازات المعلقة أولاً، وعند إنشاء مسير رواتب راجعه ثم رحّله لإنشاء القيد المحاسبي، واحسب نهاية الخدمة قبل اعتماد أي إخلاء طرف.</p>
              </div>
            </div>
          </Card>
        </>
      ) : (
        <>
          <div className="flex items-center gap-1.5 border-b border-slate-200 dark:border-slate-800 pb-2 overflow-x-auto -mx-1 px-1">
            {hrMenu.map((item) => {
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
                  {t(item.labelKey)}
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

export default HrPage;
