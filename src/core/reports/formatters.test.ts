import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/core/store', () => ({
  useAppStore: {
    getState: vi.fn(() => ({ activeCompany: { id: 'c-1', decimalPlaces: 2 } })),
  },
}));

import { useAppStore } from '@/core/store';
import {
  clampDecimals,
  formatHumanNumber,
  formatReportCell,
  formatReportDate,
  formatReportMoney,
  formatReportQuantity,
} from './formatters';

const mockStore = useAppStore as unknown as { getState: ReturnType<typeof vi.fn> };

function setDecimals(n: number | null | undefined) {
  mockStore.getState.mockReturnValue({ activeCompany: n === null || n === undefined ? null : { id: 'c-1', decimalPlaces: n } });
}

beforeEach(() => {
  setDecimals(2);
});

describe('report formatters', () => {
  it('clamps decimals to 0-6 and falls back to company setting', () => {
    expect(clampDecimals(0)).toBe(0);
    expect(clampDecimals(9)).toBe(6);
    expect(clampDecimals(-1)).toBe(0);
    expect(clampDecimals(undefined)).toBe(2);
    setDecimals(0);
    expect(clampDecimals(undefined)).toBe(0);
  });

  it('formats money with Latin digits and company decimals', () => {
    expect(formatReportMoney(1234.5)).toBe('1,234.50');
    expect(formatReportMoney(1234.5, 0)).toBe('1,235');
    expect(formatReportMoney(100, 2, 'USD')).toBe('100.00 USD');
    expect(formatReportMoney(null)).toBe('');
    expect(formatReportMoney('abc')).toBe('abc');
  });

  it('formats quantities trimmed to 4 decimals', () => {
    expect(formatReportQuantity(2.5)).toBe('2.5');
    expect(formatReportQuantity(1.234567)).toBe('1.2346');
    expect(formatReportQuantity(0)).toBe('0');
  });

  it('formats dates as YYYY-MM-DD', () => {
    expect(formatReportDate('2026-09-05T10:00:00.000Z')).toBe('2026-09-05');
    expect(formatReportDate('2026-09-05')).toBe('2026-09-05');
    expect(formatReportDate('not-a-date')).toBe('not-a-date');
    expect(formatReportDate(null)).toBe('');
  });

  it('dispatches cells by column format', () => {
    expect(formatReportCell(10, { format: 'money' })).toBe('10.00');
    expect(formatReportCell(10.456, { format: 'number', decimals: 1 })).toBe('10.5');
    expect(formatReportCell('2026-01-02', { format: 'date' })).toBe('2026-01-02');
    expect(formatReportCell(12.5, { format: 'percent' })).toBe('12.5%');
    expect(formatReportCell('<b>', { format: 'text' })).toBe('<b>');
  });

  it('custom render wins over format', () => {
    expect(formatReportCell(10, { format: 'money', render: (v) => `X${v}` })).toBe('X10');
  });

  it('renders human numbers in Arabic-Indic digits with company decimals', () => {
    setDecimals(0);
    expect(formatHumanNumber(1234.56)).toBe('١٬٢٣٥');
  });
});
