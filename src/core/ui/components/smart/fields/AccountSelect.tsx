import React, { useMemo } from 'react';
import { SmartSelect, type SmartSelectItem } from '../SmartSelect';
import { useAccounts } from '@/modules/accounting/hooks/useAccounting';
import { useTranslation } from '@/core/i18n/useTranslation';
import type { Account } from '@/modules/accounting/types';

interface AccountSelectProps {
  companyId: string;
  value?: string;
  onChange: (value: string | null) => void;
  /**
   * Fired after a pick with the full account object. Callers that need the
   * account NAME (journal lines, statement exports) must not look it up
   * again — the id alone carries no label.
   */
  onAccountChange?: (account: Account) => void;
  /**
   * Label to display when the selected account is not in the loaded option
   * list (a loaded document whose account list has not arrived yet).
   */
  selectedLabel?: string;
  placeholder?: string;
  filterType?: 'all' | 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';
  excludeGroups?: boolean;
  disabled?: boolean;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export const AccountSelect: React.FC<AccountSelectProps> = ({
  companyId, value, onChange, onAccountChange, selectedLabel, placeholder,
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
    const base = filtered.map(a => ({
      label: `${a.code} - ${a.nameAr}`,
      sublabel: a.nameEn || undefined,
      disabled: !a.isActive,
      ...a,
    })) as SmartSelectItem[];
    // The loaded document carries the account name but the account may not
    // be in the fetched list — without a synthetic option the trigger shows
    // the placeholder and the line looks empty.
    if (selectedLabel && value && !base.some((a) => a.id === value)) {
      return [{ id: value, label: selectedLabel }, ...base] as SmartSelectItem[];
    }
    return base;
  }, [flattenedAccounts, filterType, excludeGroups, selectedLabel, value]);

  return (
    <SmartSelect
      value={value}
      onChange={(v) => onChange(typeof v === 'string' ? v : null)}
      onItemSelect={(item) => {
        if (!onAccountChange) return;
        const account = flattenedAccounts.find((a) => a.id === item.id);
        if (account) onAccountChange(account);
      }}
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
