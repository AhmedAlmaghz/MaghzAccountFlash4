import React, { memo } from 'react';
import { cn } from '@/core/utils';

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  header?: React.ReactNode;
  footer?: React.ReactNode;
  noPadding?: boolean;
}

export const Card = memo(React.forwardRef<HTMLDivElement, CardProps>(
  ({ className, header, footer, noPadding, children, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn(
          'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg shadow-sm transition-all duration-200 hover:shadow-md',
          className
        )}
        {...props}
      >
        {header && (
          <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-slate-800">
            {header}
          </div>
        )}
        <div className={cn(!noPadding && 'p-5')}>{children}</div>
        {footer && (
          <div className="px-5 py-4 border-t border-slate-200 dark:border-slate-800">
            {footer}
          </div>
        )}
      </div>
    );
  }
));

Card.displayName = 'Card';

export const CardTitle: React.FC<React.HTMLAttributes<HTMLHeadingElement>> = memo(({ className, children, ...props }) => (
  <h3 className={cn('text-base font-semibold text-slate-900 dark:text-slate-50', className)} {...props}>
    {children}
  </h3>
));

export const CardDescription: React.FC<React.HTMLAttributes<HTMLParagraphElement>> = memo(({ className, children, ...props }) => (
  <p className={cn('text-sm text-slate-500 dark:text-slate-400 mt-1', className)} {...props}>
    {children}
  </p>
));
