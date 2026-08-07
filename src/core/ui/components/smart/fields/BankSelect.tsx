import React, { useMemo } from 'react';
import { SmartSelect, type SmartSelectItem } from '../SmartSelect';
import { useBanks } from '@/core/hooks/useSettings';
import { useTranslation } from '@/core/i18n/useTranslation';

interface BankSelectProps {
  companyId: string;
  value?: string;
  onChange: (value: string | null) => void;
  placeholder?: string;
  disabled?: boolean;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export const BankSelect: React.FC<BankSelectProps> = ({
  companyId, value, onChange, placeholder, disabled, size, className,
}) => {
  const { t } = useTranslation();
  const resolvedPlaceholder = placeholder ?? t('select.bank.placeholder');
  const { banks, isLoading } = useBanks(companyId);

  const options = useMemo(() => {
    return banks.map(b => ({
      label: b.name,
      sublabel: b.bankName || b.accountNumber || undefined,
      disabled: !b.isActive,
      ...b,
    })) as SmartSelectItem[];
  }, [banks]);

  return (
    <SmartSelect
      value={value}
      onChange={(v) => onChange(typeof v === 'string' ? v : null)}
      options={options}
      isLoading={isLoading}
      placeholder={resolvedPlaceholder}
      searchPlaceholder={t('select.bank.search')}
      emptyMessage={t('select.bank.empty')}
      disabled={disabled}
      size={size}
      className={className}
      clearable
    />
  );
};

export default BankSelect;
