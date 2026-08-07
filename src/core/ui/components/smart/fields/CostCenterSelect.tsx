import React, { useMemo } from 'react';
import { SmartSelect, type SmartSelectItem } from '../SmartSelect';
import { useCostCenters } from '@/core/hooks/useSettings';
import { useTranslation } from '@/core/i18n/useTranslation';

interface CostCenterSelectProps {
  companyId: string;
  value?: string;
  onChange: (value: string | null) => void;
  placeholder?: string;
  disabled?: boolean;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export const CostCenterSelect: React.FC<CostCenterSelectProps> = ({
  companyId, value, onChange, placeholder, disabled, size, className,
}) => {
  const { t } = useTranslation();
  const resolvedPlaceholder = placeholder ?? t('select.costCenter.placeholder');
  const { centers, isLoading } = useCostCenters(companyId);

  const options = useMemo(() => {
    return centers.map(c => ({
      label: c.nameAr,
      sublabel: c.code || c.type,
      disabled: !c.isActive,
      ...c,
    })) as SmartSelectItem[];
  }, [centers]);

  return (
    <SmartSelect
      value={value}
      onChange={(v) => onChange(typeof v === 'string' ? v : null)}
      options={options}
      isLoading={isLoading}
      placeholder={resolvedPlaceholder}
      searchPlaceholder={t('select.costCenter.search')}
      emptyMessage={t('select.costCenter.empty')}
      disabled={disabled}
      size={size}
      className={className}
      clearable
    />
  );
};

export default CostCenterSelect;
