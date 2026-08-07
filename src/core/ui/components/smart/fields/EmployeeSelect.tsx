import React, { useMemo } from 'react';
import { SmartSelect, type SmartSelectItem } from '../SmartSelect';
import { useEmployees } from '@/modules/hr/hooks/useHr';
import { useTranslation } from '@/core/i18n/useTranslation';

interface EmployeeSelectProps {
  companyId: string;
  value?: string;
  onChange: (value: string | null) => void;
  placeholder?: string;
  disabled?: boolean;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  filterActive?: boolean;
}

export const EmployeeSelect: React.FC<EmployeeSelectProps> = ({
  companyId, value, onChange, placeholder, disabled, size, className, filterActive = true,
}) => {
  const { t } = useTranslation();
  const resolvedPlaceholder = placeholder ?? t('select.employee.placeholder');
  const { employees, isLoading } = useEmployees(companyId);

  const options = useMemo(() => {
    let filtered = employees;
    if (filterActive) filtered = filtered.filter(e => e.isActive);
    return filtered.map(e => ({
      label: e.fullName,
      sublabel: `${e.employeeNumber} | ${e.position || ''}`,
      disabled: !e.isActive,
      ...e,
    })) as SmartSelectItem[];
  }, [employees, filterActive]);

  return (
    <SmartSelect
      value={value}
      onChange={(v) => onChange(typeof v === 'string' ? v : null)}
      options={options}
      isLoading={isLoading}
      placeholder={resolvedPlaceholder}
      searchPlaceholder={t('select.employee.search')}
      emptyMessage={t('select.employee.empty')}
      disabled={disabled}
      size={size}
      className={className}
      clearable
    />
  );
};

export default EmployeeSelect;
