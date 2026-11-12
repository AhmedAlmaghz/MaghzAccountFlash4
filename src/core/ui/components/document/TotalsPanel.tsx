import React from 'react';
import { Card } from '../Card';
import { useTranslation } from '@/core/i18n/useTranslation';

export interface TotalsData {
  subtotal: number;
  discountAmount: number;
  vatAmount: number;
  totalAmount: number;
  itemsCount?: number;
}

export const TotalsPanel: React.FC<{ totals: TotalsData; formatCurrency: (v: number) => string; vatRate?: number }> = ({
  totals,
  formatCurrency,
  vatRate,
}) => {
  const { t } = useTranslation();
  return (
    <Card className="p-4 space-y-2">
      <h3 className="font-bold text-sm text-zinc-700 dark:text-zinc-200">{t('sales.invoice.total')}</h3>
      <div className="space-y-1.5 text-sm">
        <div className="flex justify-between text-zinc-500">
          <span>{t('common.subtotal')}</span>
          <span className="tabular-nums">{formatCurrency(totals.subtotal)}</span>
        </div>
        {totals.discountAmount > 0 && (
          <div className="flex justify-between text-rose-500">
            <span>{t('sales.discount')}</span>
            <span className="tabular-nums">-{formatCurrency(totals.discountAmount)}</span>
          </div>
        )}
        {vatRate !== undefined && (
          <div className="flex justify-between text-zinc-500">
            <span>{t('pos.vat')} ({vatRate}%)</span>
            <span className="tabular-nums">{formatCurrency(totals.vatAmount)}</span>
          </div>
        )}
        <div className="pt-2 border-t border-dashed border-zinc-300 dark:border-zinc-700 flex justify-between items-center">
          <span className="font-bold">{t('common.grandTotal')}</span>
          <span className="font-bold text-lg text-primary-700 dark:text-primary-400 tabular-nums">{formatCurrency(totals.totalAmount)}</span>
        </div>
      </div>
    </Card>
  );
};
