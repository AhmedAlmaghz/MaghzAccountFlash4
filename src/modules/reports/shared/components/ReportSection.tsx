import React from 'react';

export interface ReportSectionProps {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
  collapsible?: boolean;
  badge?: React.ReactNode;
}

export function ReportSection({ title, subtitle, actions, children, badge }: ReportSectionProps) {
  return (
    <section className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-base font-bold text-slate-800 dark:text-slate-100 truncate">{title}</h3>
          {subtitle && <p className="text-xs text-slate-400 mt-0.5 truncate">{subtitle}</p>}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {badge}
          {actions}
        </div>
      </div>
      <div className="p-4 md:p-5">{children}</div>
    </section>
  );
}
