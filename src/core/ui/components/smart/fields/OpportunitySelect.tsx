import React, { useMemo } from 'react';
import { SmartSelect, type SmartSelectItem } from '../SmartSelect';
import { useOpportunities } from '@/modules/crm/hooks/useCrm';
import { useFormatters } from '@/core/utils/useFormatters';
import { useAppStore } from '@/core/store';
import { useTranslation } from '@/core/i18n/useTranslation';

interface OpportunitySelectProps {
  companyId: string;
  value?: string;
  onChange: (value: string | null) => void;
  placeholder?: string;
  disabled?: boolean;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export const OpportunitySelect: React.FC<OpportunitySelectProps> = ({
  companyId, value, onChange, placeholder, disabled, size, className,
}) => {
  const { t } = useTranslation();
  const resolvedPlaceholder = placeholder ?? t('select.opportunity.placeholder');
  const { opportunities, isLoading } = useOpportunities(companyId);
  const { activeCompany } = useAppStore();
  const { formatCurrency } = useFormatters(activeCompany?.id || '');

  const options = useMemo(() => {
    return opportunities.map(o => ({
      label: o.name,
      sublabel: `${formatCurrency(o.value)} | ${o.stage}`,
      ...o,
    })) as SmartSelectItem[];
  }, [opportunities, formatCurrency]);

  return (
    <SmartSelect
      value={value}
      onChange={(v) => onChange(typeof v === 'string' ? v : null)}
      options={options}
      isLoading={isLoading}
      placeholder={resolvedPlaceholder}
      searchPlaceholder={t('select.opportunity.search')}
      emptyMessage={t('select.opportunity.empty')}
      disabled={disabled}
      size={size}
      className={className}
      clearable
    />
  );
};

export default OpportunitySelect;
