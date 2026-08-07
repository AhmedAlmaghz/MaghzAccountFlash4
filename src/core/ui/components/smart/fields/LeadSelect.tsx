import React, { useMemo } from 'react';
import { SmartSelect, type SmartSelectItem } from '../SmartSelect';
import { useLeads } from '@/modules/crm/hooks/useCrm';
import { useTranslation } from '@/core/i18n/useTranslation';

interface LeadSelectProps {
  companyId: string;
  value?: string;
  onChange: (value: string | null) => void;
  placeholder?: string;
  disabled?: boolean;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export const LeadSelect: React.FC<LeadSelectProps> = ({
  companyId, value, onChange, placeholder, disabled, size, className,
}) => {
  const { t } = useTranslation();
  const resolvedPlaceholder = placeholder ?? t('select.lead.placeholder');
  const { leads, isLoading } = useLeads(companyId);

  const options = useMemo(() => {
    return leads.map(l => ({
      label: l.name,
      sublabel: l.phone || l.email || undefined,
      ...l,
    })) as SmartSelectItem[];
  }, [leads]);

  return (
    <SmartSelect
      value={value}
      onChange={(v) => onChange(typeof v === 'string' ? v : null)}
      options={options}
      isLoading={isLoading}
      placeholder={resolvedPlaceholder}
      searchPlaceholder={t('select.lead.search')}
      emptyMessage={t('select.lead.empty')}
      disabled={disabled}
      size={size}
      className={className}
      clearable
    />
  );
};

export default LeadSelect;
