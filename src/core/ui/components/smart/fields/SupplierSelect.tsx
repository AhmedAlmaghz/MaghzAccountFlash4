import React, { useMemo } from 'react';
import { SmartSelect, type SmartSelectItem } from '../SmartSelect';
import { useSuppliers } from '@/modules/purchases/hooks/usePurchases';
import { useFormatters } from '@/core/utils/useFormatters';
import { useAppStore } from '@/core/store';
import { useTranslation } from '@/core/i18n/useTranslation';
import type { Supplier } from '@/modules/purchases/types';

interface SupplierSelectProps {
  companyId: string;
  value?: string;
  onChange: (value: string | null) => void;
  /** Fired after a pick with the full supplier (name, balance, …). */
  onSupplierChange?: (supplier: Supplier) => void;
  /** Label of the selected supplier when it is not in the loaded list. */
  selectedLabel?: string;
  placeholder?: string;
  disabled?: boolean;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  showBalance?: boolean;
}

export const SupplierSelect: React.FC<SupplierSelectProps> = ({
  companyId, value, onChange, onSupplierChange, selectedLabel, placeholder, disabled, size, className, showBalance = true,
}) => {
  const { t } = useTranslation();
  const resolvedPlaceholder = placeholder ?? t('select.supplier.placeholder');
  const { suppliers, isLoading } = useSuppliers(companyId);
  const { activeCompany } = useAppStore();
  const { formatCurrency } = useFormatters(activeCompany?.id || '');

  const options = useMemo(() => {
    const base = suppliers.map(s => ({
      label: s.name,
      sublabel: showBalance ? `${t('select.supplier.balance')}: ${formatCurrency(s.balance)}` : s.phone || undefined,
      disabled: !s.isActive,
      ...s,
    })) as SmartSelectItem[];
    // A restored draft keeps the supplier id but the supplier may not be in
    // the fetched list — without this the trigger shows the placeholder and
    // the form looks like the supplier was never picked.
    if (selectedLabel && value && !base.some((s) => s.id === value)) {
      return [{ id: value, label: selectedLabel }, ...base] as SmartSelectItem[];
    }
    return base;
  }, [suppliers, showBalance, formatCurrency, t, selectedLabel, value]);

  return (
    <SmartSelect
      value={value}
      onChange={(v) => onChange(typeof v === 'string' ? v : null)}
      onItemSelect={(item) => {
        if (!onSupplierChange) return;
        const supplier = suppliers.find((s) => s.id === item.id);
        if (supplier) onSupplierChange(supplier);
      }}
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
