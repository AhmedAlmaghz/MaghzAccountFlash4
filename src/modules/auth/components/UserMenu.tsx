import React, { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  User as UserIcon,
  KeyRound,
  Settings,
  LogOut,
  Sun,
  Moon,
  Globe,
  Palette,
  ChevronDown,
} from 'lucide-react';
import { useAppStore } from '@/core/store';
import { useTranslation } from '@/core/i18n/useTranslation';
import { useEscapeKey } from '@/core/hooks/useResponsive';
import { cn } from '@/core/utils';
import { useAuthStore } from '../store';
import { UserAvatar } from './UserAvatar';
import { ProfileModal } from './ProfileModal';
import { ChangePasswordModal } from './ChangePasswordModal';

/**
 * Header user menu — avatar button (photo only) opening name + email,
 * language, appearance, profile, change-password, settings and logout.
 * Closes on outside click / Escape and returns focus to the trigger.
 */
export const UserMenu: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const language = useAppStore((s) => s.language);
  const setLanguage = useAppStore((s) => s.setLanguage);
  const theme = useAppStore((s) => s.theme);
  const setTheme = useAppStore((s) => s.setTheme);

  const [open, setOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open ]);

  useEscapeKey(open, () => {
    setOpen(false);
    buttonRef.current?.focus();
  });

  if (!user) return null;

  const displayName = user.fullName?.trim() || user.username;

  const handleLogout = () => {
    setOpen(false);
    logout();
    navigate('/login');
  };

  const menuItemClass =
    'w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors text-start';

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t('header.userMenu.openMenu')}
        title={displayName}
        className="flex items-center gap-1 rounded-full p-0.5 hover:ring-2 hover:ring-primary-300 dark:hover:ring-primary-700 transition-shadow"
      >
        <UserAvatar user={user} size="sm" />
        <ChevronDown
          size={14}
          className={cn('text-zinc-400 transition-transform', open && 'rotate-180')}
          aria-hidden
        />
      </button>

      {open && (
        <div
          role="menu"
          aria-label={t('header.userMenu.openMenu')}
          className="absolute end-0 top-full mt-2 w-72 rounded-2xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow-float p-2 z-50 animate-scale-in origin-top"
        >
          {/* Identity */}
          <div className="flex items-center gap-3 px-3 py-3">
            <UserAvatar user={user} size="md" />
            <div className="min-w-0">
              <p className="font-bold text-sm text-zinc-900 dark:text-zinc-50 truncate">{displayName}</p>
              {user.email && (
                <p className="text-xs text-zinc-500 dark:text-zinc-400 truncate" dir="ltr">
                  {user.email}
                </p>
              )}
              <span className="inline-block mt-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300">
                {user.role}
              </span>
            </div>
          </div>

          <div className="h-px bg-zinc-100 dark:bg-zinc-800 my-1" />

          {/* Language */}
          <p className="px-3 pt-1.5 pb-1 text-[11px] font-semibold text-zinc-400 flex items-center gap-1.5">
            <Globe size={12} aria-hidden />
            {t('header.userMenu.language')}
          </p>
          <div className="grid grid-cols-2 gap-1.5 px-1 pb-1">
            {(['ar', 'en'] as const).map((lng) => (
              <button
                key={lng}
                type="button"
                role="menuitemradio"
                aria-checked={language === lng}
                onClick={() => setLanguage(lng)}
                className={cn(
                  'rounded-xl px-3 py-2 text-xs font-semibold transition-colors',
                  language === lng
                    ? 'bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300'
                    : 'text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800',
                )}
              >
                {lng === 'ar' ? t('header.userMenu.arabic') : t('header.userMenu.english')}
              </button>
            ))}
          </div>

          {/* Appearance */}
          <p className="px-3 pt-1.5 pb-1 text-[11px] font-semibold text-zinc-400 flex items-center gap-1.5">
            <Palette size={12} aria-hidden />
            {t('header.userMenu.appearance')}
          </p>
          <div className="grid grid-cols-2 gap-1.5 px-1 pb-1">
            {(['light', 'dark'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                role="menuitemradio"
                aria-checked={theme === mode}
                onClick={() => setTheme(mode)}
                className={cn(
                  'flex items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold transition-colors',
                  theme === mode
                    ? 'bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300'
                    : 'text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800',
                )}
              >
                {mode === 'dark' ? <Moon size={13} aria-hidden /> : <Sun size={13} aria-hidden />}
                {mode === 'dark' ? t('header.userMenu.dark') : t('header.userMenu.light')}
              </button>
            ))}
          </div>
          <Link
            to="/settings/themes"
            onClick={() => setOpen(false)}
            className="flex items-center justify-center gap-1.5 mx-1 mb-1 rounded-xl px-3 py-2 text-xs font-semibold text-gold-600 dark:text-gold-400 hover:bg-gold-50 dark:hover:bg-gold-900/20 transition-colors"
          >
            <Palette size={13} aria-hidden />
            {t('header.userMenu.allThemes')}
          </Link>

          <div className="h-px bg-zinc-100 dark:bg-zinc-800 my-1" />

          {/* Actions */}
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              setProfileOpen(true);
            }}
            className={menuItemClass}
          >
            <UserIcon size={16} aria-hidden />
            {t('header.userMenu.profile')}
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              setPasswordOpen(true);
            }}
            className={menuItemClass}
          >
            <KeyRound size={16} aria-hidden />
            {t('header.userMenu.changePassword')}
          </button>
          <Link
            to="/settings"
            onClick={() => setOpen(false)}
            role="menuitem"
            className={menuItemClass}
          >
            <Settings size={16} aria-hidden />
            {t('header.userMenu.settings')}
          </Link>

          <div className="h-px bg-zinc-100 dark:bg-zinc-800 my-1" />

          <button
            type="button"
            role="menuitem"
            onClick={handleLogout}
            className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-900/20 transition-colors text-start"
          >
            <LogOut size={16} aria-hidden />
            {t('header.userMenu.logout')}
          </button>
        </div>
      )}

      <ProfileModal isOpen={profileOpen} onClose={() => setProfileOpen(false)} />
      <ChangePasswordModal isOpen={passwordOpen} onClose={() => setPasswordOpen(false)} />
    </div>
  );
};

export default UserMenu;
