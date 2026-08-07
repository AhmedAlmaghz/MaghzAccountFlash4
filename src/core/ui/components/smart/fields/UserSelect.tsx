import React, { useMemo } from 'react';
import { SmartSelect, type SmartSelectItem } from '../SmartSelect';
import { useUsers } from '@/modules/auth/hooks/useAuth';
import { useTranslation } from '@/core/i18n/useTranslation';

interface UserSelectProps {
  companyId: string;
  value?: string;
  onChange: (value: string | null) => void;
  placeholder?: string;
  disabled?: boolean;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export const UserSelect: React.FC<UserSelectProps> = ({
  companyId, value, onChange, placeholder, disabled, size, className,
}) => {
  const { t } = useTranslation();
  const resolvedPlaceholder = placeholder ?? t('select.user.placeholder');
  const { users, isLoading } = useUsers(companyId);

  const options = useMemo(() => {
    return users.map(u => ({
      label: u.username,
      sublabel: u.email || u.role,
      disabled: !u.isActive,
      ...u,
    })) as SmartSelectItem[];
  }, [users]);

  return (
    <SmartSelect
      value={value}
      onChange={(v) => onChange(typeof v === 'string' ? v : null)}
      options={options}
      isLoading={isLoading}
      placeholder={resolvedPlaceholder}
      searchPlaceholder={t('select.user.search')}
      emptyMessage={t('select.user.empty')}
      disabled={disabled}
      size={size}
      className={className}
      clearable
    />
  );
};

export default UserSelect;
