import React, { useMemo } from 'react';
import { SmartSelect, type SmartSelectItem } from '../SmartSelect';
import { useWarehouses } from '@/modules/inventory/hooks/useInventory';
import { useTranslation } from '@/core/i18n/useTranslation';

interface WarehouseSelectProps {
  companyId: string;
  value?: string;
  onChange: (value: string | null) => void;
  placeholder?: string;
  disabled?: boolean;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export const WarehouseSelect: React.FC<WarehouseSelectProps> = ({
  companyId, value, onChange, placeholder, disabled, size, className,
}) => {
  const { t } = useTranslation();
  const resolvedPlaceholder = placeholder ?? t('select.warehouse.placeholder');
  const { warehouses, isLoading } = useWarehouses(companyId);

  const options = useMemo(() => {
    return warehouses.map(w => ({
      label: w.name,
      sublabel: w.code || undefined,
      disabled: !w.isActive,
      ...w,
    })) as SmartSelectItem[];
  }, [warehouses]);

  return (
    <SmartSelect
      value={value}
      onChange={(v) => onChange(typeof v === 'string' ? v : null)}
      options={options}
      isLoading={isLoading}
      placeholder={resolvedPlaceholder}
      searchPlaceholder={t('select.warehouse.search')}
      emptyMessage={t('select.warehouse.empty')}
      disabled={disabled}
      size={size}
      className={className}
      clearable
    />
  );
};

export default WarehouseSelect;
