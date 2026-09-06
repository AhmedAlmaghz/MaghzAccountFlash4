import React, { useMemo } from 'react';
import { SmartSelect, type SmartSelectItem } from '../SmartSelect';
import { useCurrencies } from '@/modules/core/hooks/useCore';
import { useTranslation } from '@/core/i18n/useTranslation';

interface CurrencySelectProps {
  companyId: string;
  value?: string;
  onChange: (value: string | null) => void;
  placeholder?: string;
  disabled?: boolean;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export const CurrencySelect: React.FC<CurrencySelectProps> = ({
  companyId, value, onChange, placeholder, disabled, size, className,
}) => {
  const { t } = useTranslation();
  const resolvedPlaceholder = placeholder ?? t('select.currency.placeholder');
  const { currencies, isLoading } = useCurrencies(companyId);

  const options = useMemo(() => {
    // SmartSelect matches/selects by `id`, while every parent works with
    // currency CODES — so the code (unique natural key) is the option id.
    // Using the row uuid here left the trigger permanently empty and made
    // picks resolve to an unknown code downstream.
    return currencies.map(c => ({
      ...c,
      id: c.code,
      label: `${c.name} (${c.code})`,
      sublabel: c.isDefault ? t('select.currency.default') : `${t('select.currency.exchangeRate')}: ${c.exchangeRate}`,
      disabled: !c.isActive,
    })) as SmartSelectItem[];
  }, [currencies, t]);

  return (
    <SmartSelect
      value={value}
      onChange={(v) => onChange(typeof v === 'string' ? v : null)}
      options={options}
      isLoading={isLoading}
      placeholder={resolvedPlaceholder}
      searchPlaceholder={t('select.currency.search')}
      emptyMessage={t('select.currency.empty')}
      disabled={disabled}
      size={size}
      className={className}
      clearable
    />
  );
};

export default CurrencySelect;
