import React, { useMemo } from 'react';
import { SmartSelect, type SmartSelectItem } from '../SmartSelect';
import { useCashBoxes } from '@/core/hooks/useSettings';
import { useTranslation } from '@/core/i18n/useTranslation';

interface CashBoxSelectProps {
  companyId: string;
  value?: string;
  onChange: (value: string | null) => void;
  placeholder?: string;
  disabled?: boolean;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export const CashBoxSelect: React.FC<CashBoxSelectProps> = ({
  companyId, value, onChange, placeholder, disabled, size, className,
}) => {
  const { t } = useTranslation();
  const resolvedPlaceholder = placeholder ?? t('select.cashBox.placeholder');
  const { boxes, isLoading } = useCashBoxes(companyId);

  const options = useMemo(() => {
    return boxes.map(b => ({
      label: b.name,
      sublabel: b.code || undefined,
      disabled: !b.isActive,
      ...b,
    })) as SmartSelectItem[];
  }, [boxes]);

  return (
    <SmartSelect
      value={value}
      onChange={(v) => onChange(typeof v === 'string' ? v : null)}
      options={options}
      isLoading={isLoading}
      placeholder={resolvedPlaceholder}
      searchPlaceholder={t('select.cashBox.search')}
      emptyMessage={t('select.cashBox.empty')}
      disabled={disabled}
      size={size}
      className={className}
      clearable
    />
  );
};

export default CashBoxSelect;
