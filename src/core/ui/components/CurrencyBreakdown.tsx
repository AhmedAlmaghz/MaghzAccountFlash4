import React from 'react';
import { Coins } from 'lucide-react';
import { Card } from '@/core/ui/components';
import { EmptyState } from '@/core/ui/components/EmptyState';
import { useCurrencyDisplay } from '@/core/utils/useCurrencyDisplay';
import { useTranslation } from '@/core/i18n/useTranslation';
import type { CurrencyBreakdownResult } from '@/core/utils/currencyBreakdown';

interface Props {
  result: CurrencyBreakdownResult;
  title?: string;
  emptyText?: string;
  showBaseEquivalent?: boolean;
}

export const CurrencyBreakdown: React.FC<Props> = ({ result, title, emptyText, showBaseEquivalent = true }) => {
  const { currencies, formatWithCurrency, isLoading } = useCurrencyDisplay();
  const { t } = useTranslation();

  if (result.items.length === 0) {
    return (
      <Card>
        <div className="p-4">
          {title && <h3 className="font-semibold text-slate-900 dark:text-slate-50 mb-4">{title}</h3>}
          <EmptyState icon="inbox" title={emptyText || t('common.noData')} description="" />
        </div>
      </Card>
    );
  }

  return (
    <Card>
      <div className="p-4">
        {title && (
          <div className="flex items-center gap-2 mb-4">
            <Coins size={18} className="text-primary-600 dark:text-primary-400" />
            <h3 className="font-semibold text-slate-900 dark:text-slate-50">{title}</h3>
            {result.hasMultipleCurrencies && (
                <span className="text-xs bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 px-2 py-0.5 rounded">
                {t('common.multiCurrency')}
              </span>
            )}
          </div>
        )}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-700">
                <th className="text-right py-2 px-2">{t('common.currency')}</th>
                <th className="text-right py-2 px-2">{t('common.amount')}</th>
                {showBaseEquivalent && result.hasMultipleCurrencies && (
                  <>
                    <th className="text-right py-2 px-2">{t('common.baseEquivalent')}</th>
                    <th className="text-right py-2 px-2">{t('common.percentage')}</th>
                  </>
                )}
                {showBaseEquivalent && !result.hasMultipleCurrencies && (
                  <th className="text-right py-2 px-2">{t('common.percentage')}</th>
                )}
              </tr>
            </thead>
            <tbody>
              {result.items.map((item) => {
                const c = currencies.find((x) => x.code === item.code);
                return (
                  <tr key={item.code} className="border-b border-slate-100 dark:border-slate-800">
                    <td className="py-2 px-2 font-medium text-slate-700 dark:text-slate-200">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded">
                          {item.code}
                        </span>
                        {c && <span className="text-xs text-slate-500">{c.symbol}</span>}
                      </div>
                    </td>
                    <td className="py-2 px-2 text-slate-700 dark:text-slate-200">
                      {formatWithCurrency(item.amount, item.code)}
                    </td>
                    {showBaseEquivalent && result.hasMultipleCurrencies && (
                      <td className="py-2 px-2 text-slate-500 dark:text-slate-400">
                        {formatWithCurrency(item.baseEquivalent)}
                      </td>
                    )}
                    <td className="py-2 px-2">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 bg-slate-200 dark:bg-slate-700 rounded-full h-1.5 overflow-hidden">
                          <div
                            className="bg-primary-500 h-full rounded-full"
                            style={{ width: `${item.percent}%` }}
                          />
                        </div>
                        <span className="text-xs text-slate-600 dark:text-slate-300 w-10 text-left">
                          {item.percent}%
                        </span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            {showBaseEquivalent && result.hasMultipleCurrencies && result.items.length > 1 && (
              <tfoot>
                <tr className="border-t-2 border-slate-200 dark:border-slate-700 font-semibold">
                  <td className="py-2 px-2 text-slate-700 dark:text-slate-200">{t('common.totalInBase')}</td>
                  <td className="py-2 px-2"></td>
                  <td className="py-2 px-2 text-slate-700 dark:text-slate-200">
                    {isLoading ? '...' : formatWithCurrency(result.totalInBase)}
                  </td>
                  <td className="py-2 px-2"></td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </Card>
  );
};

export default CurrencyBreakdown;
