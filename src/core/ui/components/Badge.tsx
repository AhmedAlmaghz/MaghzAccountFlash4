import React from 'react';
import { cn } from '@/core/utils';

interface BadgeProps {
  children: React.ReactNode;
  className?: string;
}

export const Badge: React.FC<BadgeProps> = ({ children, className }) => (
  <span className={cn('inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium', className)}>
    {children}
  </span>
);
