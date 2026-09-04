import React from 'react';
import { cn } from '@/core/utils';
import type { User } from '../types';

interface UserAvatarProps {
  user: Pick<User, 'username' | 'fullName' | 'photoUrl'> | null | undefined;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const sizes = {
  sm: 'w-8 h-8 text-xs',
  md: 'w-10 h-10 text-sm',
  lg: 'w-16 h-16 text-xl',
} as const;

/**
 * User avatar — shows the profile photo when one exists, otherwise the
 * first-letter initial on the brand gradient. Never renders a broken image:
 * an `onError` hides it and falls back to initials.
 */
export const UserAvatar: React.FC<UserAvatarProps> = ({ user, size = 'md', className }) => {
  const [broken, setBroken] = React.useState(false);
  const photo = !broken && user?.photoUrl ? user.photoUrl : null;
  const initial = (user?.fullName || user?.username || '?').trim().charAt(0).toUpperCase();

  React.useEffect(() => {
    setBroken(false);
  }, [user?.photoUrl]);

  if (photo) {
    return (
      <img
        src={photo}
        alt=""
        aria-hidden
        onError={() => setBroken(true)}
        className={cn('rounded-full object-cover shrink-0 ring-2 ring-primary-200 dark:ring-primary-800', sizes[size], className)}
      />
    );
  }

  return (
    <span
      aria-hidden
      className={cn(
        'brand-gradient rounded-full text-white flex items-center justify-center font-bold uppercase shrink-0',
        sizes[size],
        className,
      )}
    >
      {initial}
    </span>
  );
};

export default UserAvatar;
