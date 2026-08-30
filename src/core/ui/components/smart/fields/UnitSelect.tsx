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
    // The `unit` column on products/documents is a plain TEXT field (varchar
    // "كيس"/"piece"), NOT a units.id FK — so the select's VALUE must be the
    // unit NAME. Feeding the UUID here would store a UUID string in the text
    // column and every screen would display a UUID instead of the unit name.
    return units.map(u => {
      const primary = u.nameAr || u.nameEn || u.code || String(u.id);
      return {
        id: primary,
        label: primary,
        sublabel: u.code && u.code !== primary ? u.code : undefined,
        disabled: !u.isActive,
      } as SmartSelectItem;
    });
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
