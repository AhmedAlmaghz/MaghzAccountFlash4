import React, { useMemo } from 'react';
import { SmartSelect, type SmartSelectItem } from '../SmartSelect';
import { useBoms } from '@/modules/manufacturing/hooks/useManufacturing';
import { useTranslation } from '@/core/i18n/useTranslation';

interface BOMSelectProps {
  companyId: string;
  value?: string;
  onChange: (value: string | null) => void;
  placeholder?: string;
  disabled?: boolean;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export const BOMSelect: React.FC<BOMSelectProps> = ({
  companyId, value, onChange, placeholder, disabled, size, className,
}) => {
  const { t } = useTranslation();
  const resolvedPlaceholder = placeholder ?? t('select.bom.placeholder');
  const { boms, isLoading } = useBoms(companyId);

  const options = useMemo(() => {
    return boms.map(b => ({
      label: b.productName || `BOM ${b.version}`,
      sublabel: `${t('select.bom.version')}: ${b.version}`,
      disabled: !b.isActive,
      ...b,
    })) as SmartSelectItem[];
  }, [boms, t]);

  return (
    <SmartSelect
      value={value}
      onChange={(v) => onChange(typeof v === 'string' ? v : null)}
      options={options}
      isLoading={isLoading}
      placeholder={resolvedPlaceholder}
      searchPlaceholder={t('select.bom.search')}
      emptyMessage={t('select.bom.empty')}
      disabled={disabled}
      size={size}
      className={className}
      clearable
    />
  );
};

export default BOMSelect;
