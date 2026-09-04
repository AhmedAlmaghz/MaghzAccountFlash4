import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
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

  const MENU_WIDTH = 288;
  const [open, setOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ top: number; style: React.CSSProperties } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // The menu renders in a portal on document.body (above every stacking
  // context), so measure the trigger and pin the popup under it. The menu's
  // inline-END edge aligns with the trigger's inline-end edge, then clamps
  // into the viewport — correct in RTL and LTR alike.
  useLayoutEffect(() => {
    if (!open || !buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    const rtl = document.documentElement.dir !== 'ltr';
    const top = Math.min(rect.bottom + 8, window.innerHeight - 16);
    if (rtl) {
      const left = Math.max(8, Math.min(rect.left, window.innerWidth - MENU_WIDTH - 8));
      setMenuPos({ top, style: { position: 'fixed', top, left, width: MENU_WIDTH } });
    } else {
      const right = Math.max(8, Math.min(window.innerWidth - rect.right, window.innerWidth - MENU_WIDTH - 8));
      setMenuPos({ top, style: { position: 'fixed', top, right, width: MENU_WIDTH } });
    }
  }, [open ]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (rootRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    // Re-measuring on scroll/resize fights the user; closing is predictable.
    const onScroll = () => setOpen(false);
    document.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
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

      {open &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            aria-label={t('header.userMenu.openMenu')}
            style={menuPos?.style}
            className="rounded-2xl border border-zinc-200 dark:border-zinc-700 surface-pop shadow-float p-2 z-[100] animate-scale-in origin-top"
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
          </div>,
          document.body,
        )}

      <ProfileModal isOpen={profileOpen} onClose={() => setProfileOpen(false)} />
      <ChangePasswordModal isOpen={passwordOpen} onClose={() => setPasswordOpen(false)} />
    </div>
  );
};

export default UserMenu;
