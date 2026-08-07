import React, { useMemo } from 'react';
import { SmartSelect, type SmartSelectItem } from '../SmartSelect';
import { useCustomers } from '@/modules/sales/hooks/useSales';
import { useFormatters } from '@/core/utils/useFormatters';
import { useAppStore } from '@/core/store';
import { useTranslation } from '@/core/i18n/useTranslation';

interface CustomerSelectProps {
  companyId: string;
  value?: string;
  onChange: (value: string | null) => void;
  placeholder?: string;
  disabled?: boolean;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  showBalance?: boolean;
}

export const CustomerSelect: React.FC<CustomerSelectProps> = ({
  companyId, value, onChange, placeholder, disabled, size, className, showBalance = true,
}) => {
  const { t } = useTranslation();
  const resolvedPlaceholder = placeholder ?? t('select.customer.placeholder');
  const { customers, isLoading } = useCustomers(companyId);
  const { activeCompany } = useAppStore();
  const { formatCurrency } = useFormatters(activeCompany?.id || '');

  const options = useMemo(() => {
    return customers.map(c => ({
      label: c.name,
      sublabel: showBalance ? `${t('select.customer.balance')}: ${formatCurrency(c.balance)}` : c.phone || undefined,
      disabled: !c.isActive,
      ...c,
    })) as SmartSelectItem[];
  }, [customers, showBalance, formatCurrency, t]);

  return (
    <SmartSelect
      value={value}
      onChange={(v) => onChange(typeof v === 'string' ? v : null)}
      options={options}
      isLoading={isLoading}
      placeholder={resolvedPlaceholder}
      searchPlaceholder={t('select.customer.search')}
      emptyMessage={t('select.customer.empty')}
      disabled={disabled}
      size={size}
      className={className}
      clearable
    />
  );
};

export default CustomerSelect;
