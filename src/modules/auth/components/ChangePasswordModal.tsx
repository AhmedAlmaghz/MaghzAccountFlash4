import React, { useState } from 'react';
import { KeyRound, Eye, EyeOff, Check } from 'lucide-react';
import { Button, Input, Modal } from '@/core/ui/components';
import { useTranslation } from '@/core/i18n/useTranslation';
import { useToastStore } from '@/core/store/toastStore';
import { useAuthStore } from '../store';
import { authApi } from '../api';

interface ChangePasswordModalProps {
  isOpen: boolean;
  onClose: () => void;
}

/**
 * Self-service password change: current + new + confirm.
 * Client mirrors the server policy (12+ chars, letter + digit) for instant
 * feedback; the server always re-enforces it and verifies the current one.
 */
export const ChangePasswordModal: React.FC<ChangePasswordModalProps> = ({ isOpen, onClose }) => {
  const { t } = useTranslation();
  const addToast = useToastStore((s) => s.addToast);
  const user = useAuthStore((s) => s.user);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState({ current: false, next: false, confirm: false });
  const [saving, setSaving] = useState(false);

  const reset = () => {
    setCurrent('');
    setNext('');
    setConfirm('');
    setShow({ current: false, next: false, confirm: false });
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleSave = async () => {
    if (!user?.id || !user.companyId) return;
    if (!current) {
      addToast('error', t('auth.changePassword.currentRequired'));
      return;
    }
    if (next !== confirm) {
      addToast('error', t('auth.changePassword.mismatch'));
      return;
    }
    if (!authApi.meetsPasswordPolicy(next)) {
      addToast('error', t('auth.changePassword.weakPassword'));
      return;
    }
    setSaving(true);
    const result = await authApi.changePasswordSelf(user.companyId, user.id, current, next);
    setSaving(false);
    if (result.success) {
      addToast('success', t('auth.changePassword.success'));
      handleClose();
    } else {
      addToast('error', result.error || t('auth.changePassword.saveError'));
    }
  };

  const toggle = (key: keyof typeof show) => setShow((s) => ({ ...s, [key]: !s[key] }));

  const field = (
    key: keyof typeof show,
    label: string,
    value: string,
    setValue: (v: string) => void,
  ) => (
    <div className="relative">
      <Input
        label={label}
        type={show[key] ? 'text' : 'password'}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        autoComplete="new-password"
        className="pe-10"
      />
      <button
        type="button"
        onClick={() => toggle(key)}
        className="absolute end-3 top-[2.6rem] text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
        aria-label={show[key] ? t('auth.changePassword.hide') : t('auth.changePassword.show')}
      >
        {show[key] ? <EyeOff size={17} /> : <Eye size={17} />}
      </button>
    </div>
  );

  return (
    <Modal
      isOpen={isOpen}
      title={t('auth.changePassword.title')}
      onClose={handleClose}
      size="md"
    >
      <div className="space-y-4">
        <div className="flex items-start gap-2 text-xs text-zinc-500 dark:text-zinc-400 bg-zinc-50 dark:bg-zinc-800/40 rounded-lg p-3 border border-zinc-200 dark:border-zinc-700">
          <KeyRound size={15} className="shrink-0 mt-0.5 text-primary-600 dark:text-primary-400" />
          <span>{t('auth.changePassword.policyHint')}</span>
        </div>
        {field('current', t('auth.changePassword.currentPassword'), current, setCurrent)}
        {field('next', t('auth.changePassword.newPassword'), next, setNext)}
        {field('confirm', t('auth.changePassword.confirmPassword'), confirm, setConfirm)}
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" onClick={handleClose} disabled={saving}>
            {t('settings.common.cancel')}
          </Button>
          <Button onClick={handleSave} disabled={saving} leftIcon={<Check size={16} />}>
            {saving ? t('settings.common.loading') : t('settings.common.save')}
          </Button>
        </div>
      </div>
    </Modal>
  );
};

export default ChangePasswordModal;
