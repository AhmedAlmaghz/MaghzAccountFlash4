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
          <label htmlFor={inputId} className="text-xs font-semibold text-zinc-500 dark:text-zinc-400">
            {label}
            {props.required && <span className="text-danger-500 ms-1">*</span>}
          </label>
        )}
        <div className="relative">
          {leftIcon && (
            <div className="absolute inset-y-0 start-0 ps-3 flex items-center pointer-events-none text-zinc-400">
              {leftIcon}
            </div>
          )}
          <input
            ref={ref}
            id={inputId}
            className={cn(
              'w-full bg-white dark:bg-zinc-900 border text-zinc-900 dark:text-zinc-50',
              'rounded-xl outline-none transition-all duration-150',
              'focus:ring-2 focus:ring-primary-500/20 dark:focus:ring-primary-400/20',
              'text-base sm:text-sm', // prevent iOS zoom on focus
              size === 'sm' && 'px-2.5 py-1.5 text-xs min-h-8',
              size === 'md' && 'px-3.5 py-2.5 min-h-11',
              size === 'lg' && 'px-4 py-3 min-h-12',
              leftIcon && size === 'sm' && 'ps-8',
              leftIcon && size === 'md' && 'ps-10',
              leftIcon && size === 'lg' && 'ps-12',
              rightIcon && size === 'sm' && 'pe-8',
              rightIcon && size === 'md' && 'pe-10',
              rightIcon && size === 'lg' && 'pe-12',
              error
                ? 'border-danger-500 focus:border-danger-500 focus:ring-danger-500/20'
                : 'border-zinc-200 dark:border-zinc-700 focus:border-primary-500 dark:focus:border-primary-400'
            )}
            {...props}
          />
          {rightIcon && (
            <div className="absolute inset-y-0 end-0 pe-3 flex items-center pointer-events-none text-zinc-400">
              {rightIcon}
            </div>
          )}
        </div>
        {error && <p className="text-xs text-danger-500">{error}</p>}
        {helperText && !error && <p className="text-xs text-zinc-400">{helperText}</p>}
      </div>
    );
  }
));

Input.displayName = 'Input';
