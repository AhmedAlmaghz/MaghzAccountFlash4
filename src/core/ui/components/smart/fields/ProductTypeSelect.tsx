import React, { useMemo } from 'react';
import { SmartSelect, type SmartSelectItem } from '../SmartSelect';
import { useProductTypes } from '@/core/hooks/useSettings';
import type { ProductType } from '@/core/types';
import { useTranslation } from '@/core/i18n/useTranslation';

interface ProductTypeSelectProps {
  companyId: string;
  value?: string;
  onChange: (value: string | null) => void;
  placeholder?: string;
  disabled?: boolean;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  filterModule?: 'sales' | 'purchases' | 'inventory' | 'manufacturing';
}

export const ProductTypeSelect: React.FC<ProductTypeSelectProps> = ({
  companyId, value, onChange, placeholder, disabled, size, className, filterModule,
}) => {
  const { t } = useTranslation();
  const resolvedPlaceholder = placeholder ?? t('select.productType.placeholder');
  const { types, isLoading } = useProductTypes(companyId);

  const options = useMemo(() => {
    let filtered = types;
    if (filterModule) {
      const map: Record<string, keyof ProductType> = {
        sales: 'appearsInSales',
        purchases: 'appearsInPurchases',
        inventory: 'appearsInInventory',
        manufacturing: 'appearsInManufacturing',
      };
      filtered = filtered.filter(t => t[map[filterModule] as keyof ProductType] as boolean);
    }
    return filtered.map(t => ({
      label: t.nameAr,
      sublabel: t.code || undefined,
      disabled: !t.isActive,
      ...t,
    })) as SmartSelectItem[];
  }, [types, filterModule]);

  return (
    <SmartSelect
      value={value}
      onChange={(v) => onChange(typeof v === 'string' ? v : null)}
      options={options}
      isLoading={isLoading}
      placeholder={resolvedPlaceholder}
      searchPlaceholder={t('select.productType.search')}
      emptyMessage={t('select.productType.empty')}
      disabled={disabled}
      size={size}
      className={className}
      clearable
    />
  );
};

export default ProductTypeSelect;
