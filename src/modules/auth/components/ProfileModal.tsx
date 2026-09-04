import React, { useState } from 'react';
import { Camera, Check } from 'lucide-react';
import { Button, Input, Modal } from '@/core/ui/components';
import { useTranslation } from '@/core/i18n/useTranslation';
import { useToastStore } from '@/core/store/toastStore';
import { useAuthStore } from '../store';
import { authApi } from '../api';
import { UserAvatar } from './UserAvatar';

interface ProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const MAX_PHOTO_BYTES = 2 * 1024 * 1024;

/**
 * Self-service profile: display name, phone and photo (2MB max, data-URL).
 * Photo persists to users.photo_url via the session-scoped update-profile
 * channel — no admin permission needed.
 */
export const ProfileModal: React.FC<ProfileModalProps> = ({ isOpen, onClose }) => {
  const { t } = useTranslation();
  const addToast = useToastStore((s) => s.addToast);
  const user = useAuthStore((s) => s.user);
  const updateStoredUser = useAuthStore((s) => s.updateStoredUser);
  const [fullName, setFullName] = useState(user?.fullName || '');
  const [phone, setPhone] = useState(user?.phone || '');
  const [photoUrl, setPhotoUrl] = useState<string | null>(user?.photoUrl ?? null);
  const [saving, setSaving] = useState(false);

  React.useEffect(() => {
    if (isOpen) {
      setFullName(user?.fullName || '');
      setPhone(user?.phone || '');
      setPhotoUrl(user?.photoUrl ?? null);
    }
  }, [isOpen, user?.fullName, user?.phone, user?.photoUrl]);

  const handlePhoto = (file: File | undefined) => {
    if (!file) return;
    if (file.size > MAX_PHOTO_BYTES) {
      addToast('error', t('auth.profile.photoTooLarge'));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') setPhotoUrl(reader.result);
    };
    reader.readAsDataURL(file);
  };

  const handleSave = async () => {
    if (!user?.id || !user.companyId) return;
    setSaving(true);
    const result = await authApi.updateProfile(user.companyId, user.id, {
      fullName: fullName.trim() || null,
      phone: phone.trim() || null,
      photoUrl,
    });
    setSaving(false);
    if (result.success) {
      updateStoredUser(
        result.user ?? {
          ...user,
          fullName: fullName.trim() || undefined,
          phone: phone.trim() || undefined,
          photoUrl: photoUrl ?? undefined,
        },
      );
      addToast('success', t('auth.profile.saved'));
      onClose();
    } else {
      addToast('error', result.error || t('auth.profile.saveError'));
    }
  };

  return (
    <Modal isOpen={isOpen} title={t('auth.profile.title')} onClose={onClose} size="md">
      <div className="space-y-4">
        <div className="flex items-center gap-4">
          <UserAvatar user={{ username: user?.username || '', fullName, photoUrl: photoUrl ?? undefined }} size="lg" />
          <div>
            <label
              htmlFor="profile-photo-input"
              className="inline-flex items-center gap-2 text-sm font-semibold px-4 py-2 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-200 cursor-pointer hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
            >
              <Camera size={15} />
              {t('auth.profile.changePhoto')}
            </label>
            <input
              id="profile-photo-input"
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => handlePhoto(e.target.files?.[0])}
            />
            <p className="text-xs text-zinc-400 mt-1.5">{t('auth.profile.photoHint')}</p>
          </div>
        </div>
        <Input
          label={t('auth.profile.fullName')}
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
        />
        <Input
          label={t('auth.profile.phone')}
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          dir="ltr"
        />
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" onClick={onClose} disabled={saving}>
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

export default ProfileModal;
