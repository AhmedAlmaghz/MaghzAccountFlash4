import React from 'react';
import { ConfirmDialog } from '../ConfirmDialog';
import { useTranslation } from '@/core/i18n/useTranslation';

interface Props {
  blocked: boolean;
  onLeave: () => void;
  onStay: () => void;
}

export const UnsavedChangesDialog: React.FC<Props> = ({ blocked, onLeave, onStay }) => {
  const { t } = useTranslation();
  return (
    <ConfirmDialog
      isOpen={blocked}
      onClose={onStay}
      onConfirm={onLeave}
      title={t('common.unsavedChanges')}
      message={t('common.unsavedChangesDesc')}
      confirmText={t('common.leave')}
      variant="warning"
    />
  );
};
