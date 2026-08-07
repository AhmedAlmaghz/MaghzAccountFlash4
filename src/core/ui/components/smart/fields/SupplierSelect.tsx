import React, { useMemo } from 'react';
import { SmartSelect, type SmartSelectItem } from '../SmartSelect';
import { useSuppliers } from '@/modules/purchases/hooks/usePurchases';
import { useFormatters } from '@/core/utils/useFormatters';
import { useAppStore } from '@/core/store';
import { useTranslation } from '@/core/i18n/useTranslation';

interface SupplierSelectProps {
  companyId: string;
  value?: string;
  onChange: (value: string | null) => void;
  placeholder?: string;
  disabled?: boolean;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  showBalance?: boolean;
}

export const SupplierSelect: React.FC<SupplierSelectProps> = ({
  companyId, value, onChange, placeholder, disabled, size, className, showBalance = true,
}) => {
  const { t } = useTranslation();
  const resolvedPlaceholder = placeholder ?? t('select.supplier.placeholder');
  const { suppliers, isLoading } = useSuppliers(companyId);
  const { activeCompany } = useAppStore();
  const { formatCurrency } = useFormatters(activeCompany?.id || '');

  const options = useMemo(() => {
    return suppliers.map(s => ({
      label: s.name,
      sublabel: showBalance ? `${t('select.supplier.balance')}: ${formatCurrency(s.balance)}` : s.phone || undefined,
      disabled: !s.isActive,
      ...s,
    })) as SmartSelectItem[];
  }, [suppliers, showBalance, formatCurrency, t]);

  return (
    <SmartSelect
      value={value}
      onChange={(v) => onChange(typeof v === 'string' ? v : null)}
      options={options}
      isLoading={isLoading}
      placeholder={resolvedPlaceholder}
      searchPlaceholder={t('select.supplier.search')}
      emptyMessage={t('select.supplier.empty')}
      disabled={disabled}
      size={size}
      className={className}
      clearable
    />
  );
};

export default SupplierSelect;
