import React, { memo } from 'react';
import { cn } from '@/core/utils';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost' | 'outline' | 'success';
  size?: 'sm' | 'md' | 'lg' | 'touch';
  isLoading?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  block?: boolean;
}

export const Button = memo(React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'primary', size = 'md', isLoading, leftIcon, rightIcon, block, children, disabled, ...props }, ref) => {
    const variants = {
      primary:
        'bg-primary-600 text-white hover:bg-primary-700 dark:hover:bg-primary-500 shadow-lift focus:ring-primary-500/30',
      secondary:
        'bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-200 hover:bg-zinc-200 dark:hover:bg-zinc-700 focus:ring-zinc-500/20',
      danger:
        'bg-danger-600 text-white hover:bg-danger-700 focus:ring-danger-500/30',
      success:
        'bg-success-600 text-white hover:bg-success-700 focus:ring-success-500/30',
      ghost:
        'bg-transparent text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 focus:ring-zinc-500/20',
      outline:
        'bg-transparent border border-zinc-300 dark:border-zinc-700 text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-800/60 focus:ring-zinc-500/20',
    };

    const sizes = {
      sm: 'px-3 py-1.5 text-xs min-h-8',
      md: 'px-5 py-2.5 text-sm min-h-11',
      lg: 'px-6 py-3 text-base min-h-12',
      touch: 'px-6 py-3.5 text-base min-h-13',
    };

    return (
      <button
        ref={ref}
        className={cn(
          'inline-flex items-center justify-center gap-2 font-semibold rounded-full transition-all duration-150 active:scale-95',
          'focus:outline-none focus:ring-2 focus:ring-offset-1 dark:focus:ring-offset-zinc-900',
          'disabled:opacity-50 disabled:pointer-events-none',
          variants[variant],
          sizes[size],
          block && 'w-full',
          className
        )}
        disabled={disabled || isLoading}
        {...props}
      >
        {isLoading && (
          <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
        )}
        {!isLoading && leftIcon}
        {children}
        {!isLoading && rightIcon}
      </button>
    );
  }
));

Button.displayName = 'Button';
