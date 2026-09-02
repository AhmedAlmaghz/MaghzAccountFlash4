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
          'bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl shadow-card transition-all duration-200 hover:shadow-lift',
          className
        )}
        {...props}
      >
        {header && (
          <div className="flex items-center justify-between px-4 sm:px-5 py-4 border-b border-zinc-200/70 dark:border-zinc-800">
            {header}
          </div>
        )}
        <div className={cn(!noPadding && 'p-4 sm:p-5')}>{children}</div>
        {footer && (
          <div className="px-4 sm:px-5 py-4 border-t border-zinc-200/70 dark:border-zinc-800">
            {footer}
          </div>
        )}
      </div>
    );
  }
));

Card.displayName = 'Card';

export const CardTitle: React.FC<React.HTMLAttributes<HTMLHeadingElement>> = memo(({ className, children, ...props }) => (
  <h3 className={cn('text-base font-bold text-zinc-900 dark:text-zinc-50', className)} {...props}>
    {children}
  </h3>
));

export const CardDescription: React.FC<React.HTMLAttributes<HTMLParagraphElement>> = memo(({ className, children, ...props }) => (
  <p className={cn('text-sm text-zinc-500 dark:text-zinc-400 mt-1', className)} {...props}>
    {children}
  </p>
));
