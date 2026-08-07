import React from 'react';
import { Modal } from './Modal';
import { Button } from './Button';
import { AlertTriangle } from 'lucide-react';

interface ConfirmDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title?: string;
  message?: string;
  confirmText?: string;
  cancelText?: string;
  variant?: 'danger' | 'warning' | 'info';
  isLoading?: boolean;
}

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  isOpen,
  onClose,
  onConfirm,
  title = 'تأكيد',
  message = 'هل أنت متأكد من تنفيذ هذا الإجراء؟',
  confirmText = 'تأكيد',
  cancelText = 'إلغاء',
  variant = 'danger',
  isLoading,
}) => {
  const variantStyles = {
    danger: 'text-rose-600',
    warning: 'text-amber-600',
    info: 'text-blue-600',
  };

  const buttonVariant = variant === 'danger' ? 'danger' : variant === 'warning' ? 'secondary' : 'primary';

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <div className="flex items-center gap-2 justify-end w-full">
          <Button variant="secondary" onClick={onClose} disabled={isLoading}>
            {cancelText}
          </Button>
          <Button
            variant={buttonVariant}
            onClick={onConfirm}
            isLoading={isLoading}
          >
            {confirmText}
          </Button>
        </div>
      }
    >
      <div className="flex items-start gap-3">
        <div className={cn('p-2 rounded-lg bg-opacity-10', variantStyles[variant])}>
          <AlertTriangle className={cn('w-6 h-6', variantStyles[variant])} />
        </div>
        <p className="text-slate-700 dark:text-slate-300 text-sm leading-relaxed">
          {message}
        </p>
      </div>
    </Modal>
  );
};

function cn(...classes: (string | false | undefined)[]) {
  return classes.filter(Boolean).join(' ');
}

export default ConfirmDialog;
