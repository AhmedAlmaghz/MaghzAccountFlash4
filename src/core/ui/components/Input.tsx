import React, { memo, useId } from 'react';
import { cn } from '@/core/utils';

export interface InputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'> {
  label?: string;
  error?: string;
  helperText?: string;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  size?: 'sm' | 'md' | 'lg';
}

export const Input = memo(React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, label, error, helperText, leftIcon, rightIcon, size = 'md', id, ...props }, ref) => {
    const generatedId = useId();
    const inputId = id ?? (label ? generatedId : undefined);
    return (
      <div className={cn('flex flex-col gap-1.5', className)}>
        {label && (
          <label htmlFor={inputId} className="text-xs font-semibold text-slate-500 dark:text-slate-400">
            {label}
            {props.required && <span className="text-danger-500 ml-1">*</span>}
          </label>
        )}
        <div className="relative">
          {leftIcon && (
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
              {leftIcon}
            </div>
          )}
          <input
            ref={ref}
            id={inputId}
            className={cn(
              'w-full bg-white dark:bg-slate-900 border text-slate-900 dark:text-slate-50',
              'rounded-lg outline-none transition-all duration-150',
              'focus:ring-2 focus:ring-primary-500/20 dark:focus:ring-primary-400/20',
              size === 'sm' && 'px-2.5 py-1.5 text-xs',
              size === 'md' && 'px-3.5 py-2.5 text-sm',
              size === 'lg' && 'px-4 py-3 text-base',
              leftIcon && size === 'sm' && 'pl-8',
              leftIcon && size === 'md' && 'pl-10',
              leftIcon && size === 'lg' && 'pl-12',
              rightIcon && size === 'sm' && 'pr-8',
              rightIcon && size === 'md' && 'pr-10',
              rightIcon && size === 'lg' && 'pr-12',
              error
                ? 'border-danger-500 focus:border-danger-500 focus:ring-danger-500/20'
                : 'border-slate-200 dark:border-slate-700 focus:border-primary-500 dark:focus:border-primary-400'
            )}
            {...props}
          />
          {rightIcon && (
            <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none text-slate-400">
              {rightIcon}
            </div>
          )}
        </div>
        {error && <p className="text-xs text-danger-500">{error}</p>}
        {helperText && !error && <p className="text-xs text-slate-400">{helperText}</p>}
      </div>
    );
  }
));

Input.displayName = 'Input';
