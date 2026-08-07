import React, { useMemo } from 'react';
import { SmartSelect, type SmartSelectItem } from '../SmartSelect';
import { useUnits } from '@/core/hooks/useSettings';
import { useTranslation } from '@/core/i18n/useTranslation';

interface UnitSelectProps {
  companyId: string;
  value?: string;
  onChange: (value: string | null) => void;
  placeholder?: string;
  disabled?: boolean;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export const UnitSelect: React.FC<UnitSelectProps> = ({
  companyId, value, onChange, placeholder, disabled, size, className,
}) => {
  const { t } = useTranslation();
  const resolvedPlaceholder = placeholder ?? t('select.unit.placeholder');
  const { units, isLoading } = useUnits(companyId);

  const options = useMemo(() => {
    return units.map(u => ({
      label: u.nameAr,
      sublabel: u.code || undefined,
      disabled: !u.isActive,
      ...u,
    })) as SmartSelectItem[];
  }, [units]);

  return (
    <SmartSelect
      value={value}
      onChange={(v) => onChange(typeof v === 'string' ? v : null)}
      options={options}
      isLoading={isLoading}
      placeholder={resolvedPlaceholder}
      searchPlaceholder={t('select.unit.search')}
      emptyMessage={t('select.unit.empty')}
      disabled={disabled}
      size={size}
      className={className}
      clearable
    />
  );
};

export default UnitSelect;
