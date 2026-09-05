import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { getCompanyDecimalPlaces } from './locale';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(value: number | string, currency = 'YER', decimalPlaces?: number) {
  const num = typeof value === 'string' ? Number(value) : value;
  if (isNaN(num)) return '-';

  // Company-aware: every report/table using this helper follows the
  // company's decimal setting (0 included) instead of a hardcoded 2.
  const dp = decimalPlaces ?? getCompanyDecimalPlaces();
  return new Intl.NumberFormat('ar-YE', {
    style: 'currency',
    currency,
    minimumFractionDigits: dp,
    maximumFractionDigits: dp,
  }).format(num);
}

export function formatDate(date: Date | string) {
  const d = typeof date === 'string' ? new Date(date) : date;
  return new Intl.DateTimeFormat('ar-YE', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}
