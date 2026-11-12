import React, { useMemo } from 'react';
import { SmartSelect, type SmartSelectItem } from '../SmartSelect';
import { useCustomers } from '@/modules/sales/hooks/useSales';
import { useFormatters } from '@/core/utils/useFormatters';
import { useAppStore } from '@/core/store';
import { useTranslation } from '@/core/i18n/useTranslation';
import type { Customer } from '@/modules/sales/types';

interface CustomerSelectProps {
  companyId: string;
  value?: string;
  onChange: (value: string | null) => void;
  /** Fired after a pick with the full customer (name, balance, …). */
  onCustomerChange?: (customer: Customer) => void;
  /** Label of the selected customer when it is not in the loaded list. */
  selectedLabel?: string;
  placeholder?: string;
  disabled?: boolean;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  showBalance?: boolean;
}

export const CustomerSelect: React.FC<CustomerSelectProps> = ({
  companyId, value, onChange, onCustomerChange, selectedLabel, placeholder, disabled, size, className, showBalance = true,
}) => {
  const { t } = useTranslation();
  const resolvedPlaceholder = placeholder ?? t('select.customer.placeholder');
  const { customers, isLoading } = useCustomers(companyId);
  const { activeCompany } = useAppStore();
  const { formatCurrency } = useFormatters(activeCompany?.id || '');

  const options = useMemo(() => {
    const base = customers.map(c => ({
      label: c.name,
      sublabel: showBalance ? `${t('select.customer.balance')}: ${formatCurrency(c.balance)}` : c.phone || undefined,
      disabled: !c.isActive,
      ...c,
    })) as SmartSelectItem[];
    // A restored draft keeps the customer id but the customer may not be in
    // the fetched list — without this the trigger shows the placeholder and
    // the form looks like the customer was never picked.
    if (selectedLabel && value && !base.some((c) => c.id === value)) {
      return [{ id: value, label: selectedLabel }, ...base] as SmartSelectItem[];
    }
    return base;
  }, [customers, showBalance, formatCurrency, t, selectedLabel, value]);

  return (
    <SmartSelect
      value={value}
      onChange={(v) => onChange(typeof v === 'string' ? v : null)}
      onItemSelect={(item) => {
        if (!onCustomerChange) return;
        const customer = customers.find((c) => c.id === item.id);
        if (customer) onCustomerChange(customer);
      }}
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
