import { useCallback, useMemo } from 'react';
import { useSettings } from './useSettings';
import { useAppStore } from '@/core/store';

const DEFAULT_DECIMAL_PLACES = 2;
const DEFAULT_DATE_FORMAT = 'yyyy-MM-dd';
const DEFAULT_CALENDAR: 'gregorian' | 'hijri' = 'gregorian';
const DEFAULT_CURRENCY = 'YER';

const HIJRI_LOCALE = 'ar-SA-u-ca-islamic-umalqura';
const GREGORIAN_LOCALE = 'ar-YE';

function getCalendarLocale(calendar: 'gregorian' | 'hijri'): string {
  return calendar === 'hijri' ? HIJRI_LOCALE : GREGORIAN_LOCALE;
}

function normalizeDateFormat(format: string): string {
  switch (format) {
    case 'dd/MM/yyyy':
    case 'yyyy/MM/dd':
    case 'yyyy-MM-dd':
    case 'yyyy':
    case 'dd-MM-yyyy':
      return format;
    default:
      return 'yyyy-MM-dd';
  }
}

interface Formatters {
  formatCurrency: (value: number | string, currencyCode?: string) => string;
  formatDate: (date: Date | string) => string;
  formatDateTime: (date: Date | string) => string;
  formatNumber: (value: number | string) => string;
  decimalPlaces: number;
  dateFormat: string;
  calendar: 'gregorian' | 'hijri';
  defaultCurrency: string;
  locale: string;
}

export function useFormatters(companyId?: string): Formatters {
  const activeCompany = useAppStore((state) => state.activeCompany);
  const resolvedCompanyId = companyId ?? activeCompany?.id ?? '';
  const { settings } = useSettings(resolvedCompanyId);

  const decimalPlaces = settings?.decimalPlaces ?? DEFAULT_DECIMAL_PLACES;
  const dateFormat = settings?.dateFormat ?? DEFAULT_DATE_FORMAT;
  const calendar = settings?.calendar ?? DEFAULT_CALENDAR;
  const defaultCurrency = settings?.defaultCurrency ?? DEFAULT_CURRENCY;

  const locale = useMemo(() => getCalendarLocale(calendar), [calendar]);
  const normalizedFormat = useMemo(() => normalizeDateFormat(dateFormat), [dateFormat]);

  const formatCurrency = useCallback((value: number | string, currencyCode?: string) => {
    const num = typeof value === 'string' ? Number(value) : value;
    if (isNaN(num)) return '-';
    const code = currencyCode ?? defaultCurrency;
    try {
      return new Intl.NumberFormat(locale, {
        style: 'currency',
        currency: code,
        minimumFractionDigits: decimalPlaces,
        maximumFractionDigits: decimalPlaces,
      }).format(num);
    } catch {
      return new Intl.NumberFormat(locale, {
        style: 'decimal',
        minimumFractionDigits: decimalPlaces,
        maximumFractionDigits: decimalPlaces,
      }).format(num);
    }
  }, [decimalPlaces, defaultCurrency, locale]);

  const formatNumber = useCallback((value: number | string) => {
    const num = typeof value === 'string' ? Number(value) : value;
    if (isNaN(num)) return '-';
    return new Intl.NumberFormat(locale, {
      minimumFractionDigits: decimalPlaces,
      maximumFractionDigits: decimalPlaces,
    }).format(num);
  }, [decimalPlaces, locale]);

  const formatParts = useCallback((date: Date, includeTime: boolean) => {
    const calendarConfig = calendar === 'hijri'
      ? { calendar: 'islamic' as const }
      : {};
    return new Intl.DateTimeFormat(locale, {
      ...calendarConfig,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      ...(includeTime ? { hour: '2-digit', minute: '2-digit' } : {}),
    }).formatToParts(date);
  }, [calendar, locale]);

  const formatByPattern = useCallback((parts: Intl.DateTimeFormatPart[], pattern: string) => {
    const lookup = (type: string) => parts.find(p => p.type === type)?.value ?? '';
    return pattern
      .replace(/yyyy/g, lookup('year'))
      .replace(/MM/g, lookup('month'))
      .replace(/dd/g, lookup('day'));
  }, []);

  const formatDate = useCallback((date: Date | string) => {
    const d = typeof date === 'string' ? new Date(date) : date;
    if (isNaN(d.getTime())) return '-';
    try {
      const parts = formatParts(d, false);
      const formatted = formatByPattern(parts, normalizedFormat);
      return calendar === 'hijri' ? `${formatted} هـ` : formatted;
    } catch {
      return '-';
    }
  }, [normalizedFormat, calendar, formatParts, formatByPattern]);

  const formatDateTime = useCallback((date: Date | string) => {
    const d = typeof date === 'string' ? new Date(date) : date;
    if (isNaN(d.getTime())) return '-';
    try {
      const parts = formatParts(d, true);
      const lookup = (type: string) => parts.find(p => p.type === type)?.value ?? '';
      const dateStr = formatByPattern(parts, normalizedFormat);
      const timeStr = `${lookup('hour')}:${lookup('minute')}`;
      return calendar === 'hijri' ? `${dateStr} ${timeStr} هـ` : `${dateStr} ${timeStr}`;
    } catch {
      return '-';
    }
  }, [normalizedFormat, calendar, formatParts, formatByPattern]);

  return {
    formatCurrency,
    formatDate,
    formatDateTime,
    formatNumber,
    decimalPlaces,
    dateFormat,
    calendar,
    defaultCurrency,
    locale,
  };
}

export default useFormatters;
