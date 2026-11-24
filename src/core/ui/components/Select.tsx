import React from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/core/utils';

export interface SelectProps {
  value?: string;
  onChange?: (value: string) => void;
  children: React.ReactNode;
  className?: string;
  disabled?: boolean;
  placeholder?: string;
}

export function Select({ value, onChange, children, className, disabled, placeholder }: SelectProps) {
  return (
    <div className={cn('relative', className)}>
      <select
        value={value ?? ''}
        onChange={(e) => onChange?.(e.target.value)}
        disabled={disabled}
        className="h-9 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 text-sm px-3 pr-8 outline-none focus:ring-2 focus:ring-rose-400/40 disabled:opacity-50 cursor-pointer"
      >
        {placeholder && value === '' && <option value="">{placeholder}</option>}
        {children}
      </select>
      <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
    </div>
  );
}
