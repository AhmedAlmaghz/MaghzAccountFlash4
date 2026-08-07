import React, { useMemo } from 'react';
import { SmartSelect, type SmartSelectItem } from '../SmartSelect';
import { usePayrollComponents } from '@/core/hooks/useSettings';
import { useTranslation } from '@/core/i18n/useTranslation';

interface PayrollComponentSelectProps {
  companyId: string;
  value?: string | string[];
  onChange: (value: string | string[] | null) => void;
  placeholder?: string;
  disabled?: boolean;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  multiple?: boolean;
  filterType?: 'earning' | 'deduction' | 'tax' | 'insurance' | 'net';
}

export const PayrollComponentSelect: React.FC<PayrollComponentSelectProps> = ({
  companyId, value, onChange, placeholder, disabled, size, className, multiple = false, filterType,
}) => {
  const { t } = useTranslation();
  const resolvedPlaceholder = placeholder ?? t('select.payrollComponent.placeholder');
  const { components, isLoading } = usePayrollComponents(companyId);

  const options = useMemo(() => {
    let filtered = components;
    if (filterType) filtered = filtered.filter(c => c.type === filterType);
    return filtered.map(c => ({
      label: c.nameAr,
      sublabel: `${c.type} | ${c.code || ''}`,
      disabled: !c.isActive,
      ...c,
    })) as SmartSelectItem[];
  }, [components, filterType]);

  return (
    <SmartSelect
      value={value}
      onChange={(v) => onChange(typeof v === 'string' ? v : null)}
      options={options}
      isLoading={isLoading}
      placeholder={resolvedPlaceholder}
      searchPlaceholder={t('select.payrollComponent.search')}
      emptyMessage={t('select.payrollComponent.empty')}
      disabled={disabled}
      size={size}
      className={className}
      multiple={multiple}
      clearable
    />
  );
};

export default PayrollComponentSelect;
