import React, { useMemo } from 'react';
import { SmartSelect, type SmartSelectItem } from '../SmartSelect';
import { useAccounts } from '@/modules/accounting/hooks/useAccounting';
import { useTranslation } from '@/core/i18n/useTranslation';

interface AccountSelectProps {
  companyId: string;
  value?: string;
  onChange: (value: string | null) => void;
  placeholder?: string;
  filterType?: 'all' | 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';
  excludeGroups?: boolean;
  disabled?: boolean;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export const AccountSelect: React.FC<AccountSelectProps> = ({
  companyId, value, onChange, placeholder,
  filterType = 'all', excludeGroups = true, disabled, size, className,
}) => {
  const { t } = useTranslation();
  const resolvedPlaceholder = placeholder ?? t('select.account.placeholder');
  const { accounts, isLoading } = useAccounts(companyId);

  const flattenedAccounts = useMemo(() => {
    const flatten = (items: typeof accounts): typeof accounts => {
      return items.flatMap(item => [
        item,
        ...(item.children ? flatten(item.children) : []),
      ]);
    };
    return flatten(accounts);
  }, [accounts]);

  const options = useMemo(() => {
    let filtered = flattenedAccounts;
    if (filterType !== 'all') {
      filtered = filtered.filter(a => a.type === filterType);
    }
    if (excludeGroups) {
      filtered = filtered.filter(a => !a.isGroup);
    }
    return filtered.map(a => ({
      label: `${a.code} - ${a.nameAr}`,
      sublabel: a.nameEn || undefined,
      disabled: !a.isActive,
      ...a,
    })) as SmartSelectItem[];
  }, [flattenedAccounts, filterType, excludeGroups]);

  return (
    <SmartSelect
      value={value}
      onChange={(v) => onChange(typeof v === 'string' ? v : null)}
      options={options}
      isLoading={isLoading}
      placeholder={resolvedPlaceholder}
      searchPlaceholder={t('select.account.search')}
      emptyMessage={t('select.account.empty')}
      disabled={disabled}
      size={size}
      className={className}
      clearable
    />
  );
};

export default AccountSelect;
