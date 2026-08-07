import React, { useMemo } from 'react';
import { SmartSelect, type SmartSelectItem } from '../SmartSelect';
import { useBranches } from '@/modules/core/hooks/useCore';
import { useTranslation } from '@/core/i18n/useTranslation';

interface BranchSelectProps {
  companyId: string;
  value?: string;
  onChange: (value: string | null) => void;
  placeholder?: string;
  disabled?: boolean;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export const BranchSelect: React.FC<BranchSelectProps> = ({
  companyId, value, onChange, placeholder, disabled, size, className,
}) => {
  const { t } = useTranslation();
  const resolvedPlaceholder = placeholder ?? t('select.branch.placeholder');
  const { branches, isLoading } = useBranches(companyId);

  const options = useMemo(() => {
    return branches.map(b => ({
      label: b.name,
      sublabel: b.code || undefined,
      disabled: !b.isActive,
      ...b,
    })) as SmartSelectItem[];
  }, [branches]);

  return (
    <SmartSelect
      value={value}
      onChange={(v) => onChange(typeof v === 'string' ? v : null)}
      options={options}
      isLoading={isLoading}
      placeholder={resolvedPlaceholder}
      searchPlaceholder={t('select.branch.search')}
      emptyMessage={t('select.branch.empty')}
      disabled={disabled}
      size={size}
      className={className}
      clearable
    />
  );
};

export default BranchSelect;
