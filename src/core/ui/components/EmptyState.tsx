import React from 'react';
import { Inbox, Search, FileX } from 'lucide-react';
import { cn } from '@/core/utils';

interface EmptyStateProps {
  icon?: 'inbox' | 'search' | 'file';
  title?: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  icon = 'inbox',
  title = 'لا توجد بيانات',
  description = 'لم يتم العثور على أي سجلات في الوقت الحالي',
  action,
  className,
}) => {
  const icons = {
    inbox: Inbox,
    search: Search,
    file: FileX,
  };

  const Icon = icons[icon];

  return (
    <div className={cn('empty-state', className)}>
      <div className="w-16 h-16 bg-slate-100 dark:bg-slate-800 rounded-full flex items-center justify-center mb-4">
        <Icon className="w-8 h-8 text-slate-400" />
      </div>
      <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-1">
        {title}
      </h3>
      <p className="text-sm text-slate-500 dark:text-slate-400 max-w-md text-center mb-4">
        {description}
      </p>
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
};

export default EmptyState;
