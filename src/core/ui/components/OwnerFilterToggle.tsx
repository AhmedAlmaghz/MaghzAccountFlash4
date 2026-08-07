import React from 'react';
import { UserCheck } from 'lucide-react';
import { useTranslation } from '@/core/i18n/useTranslation';

interface OwnerFilterToggleProps {
  isOwnOnly: boolean;
  showToggle: boolean;
  onToggle: (v: boolean) => void;
}

export const OwnerFilterToggle: React.FC<OwnerFilterToggleProps> = ({ isOwnOnly, showToggle, onToggle }) => {
  const { t } = useTranslation();

  if (!showToggle) return null;

  return (
    <button
      type="button"
      onClick={() => onToggle(!isOwnOnly)}
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors border ${
        isOwnOnly
          ? 'bg-primary-50 text-primary-700 border-primary-200 dark:bg-primary-900/30 dark:text-primary-300 dark:border-primary-700'
          : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700 dark:hover:bg-slate-700'
      }`}
      title={isOwnOnly ? (t('filter.showAll')) : (t('filter.myDocsOnly'))}
    >
      <UserCheck size={14} />
      {isOwnOnly ? (t('filter.myDocsOnly')) : (t('filter.allDocs'))}
    </button>
  );
};

export default OwnerFilterToggle;
