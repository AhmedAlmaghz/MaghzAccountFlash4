import React, { useState } from 'react';
import { Undo2 } from 'lucide-react';
import { Modal, Button, Input } from '@/core/ui/components';
import { useTranslation } from '@/core/i18n/useTranslation';

interface ReverseDialogProps {
  open: boolean;
  onClose: () => void;
  /** Human label of the document being reversed (e.g. INV-0001). */
  docLabel: string;
  onConfirm: (date: string, reason: string) => Promise<void>;
}

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export const ReverseDialog: React.FC<ReverseDialogProps> = ({ open, onClose, docLabel, onConfirm }) => {
  const { t } = useTranslation();
  const [date, setDate] = useState(todayStr());
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const close = () => {
    if (busy) return;
    setReason('');
    setDate(todayStr());
    onClose();
  };

  const confirm = async () => {
    if (reason.trim().length < 3 || busy) return;
    setBusy(true);
    try {
      await onConfirm(date, reason.trim());
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      isOpen={open}
      onClose={close}
      title={`${t('accounting.reverse.title')} — ${docLabel}`}
      size="md"
      footer={
        <div className="flex items-center gap-2 justify-end w-full">
          <Button variant="secondary" onClick={close} disabled={busy}>{t('cancel')}</Button>
          <Button
            variant="primary"
            leftIcon={<Undo2 size={16} />}
            onClick={confirm}
            disabled={reason.trim().length < 3}
            isLoading={busy}
          >
            {t('accounting.reverse.confirm')}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-slate-600 dark:text-slate-400">{t('accounting.reverse.hint')}</p>
        <Input
          label={t('accounting.reverse.date')}
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
        <label className="block">
          <span className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
            {t('accounting.reverse.reason')}
          </span>
          <textarea
            className="input w-full min-h-20"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={t('accounting.reverse.reasonPlaceholder')}
          />
        </label>
      </div>
    </Modal>
  );
};
