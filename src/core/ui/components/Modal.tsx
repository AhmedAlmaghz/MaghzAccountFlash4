import React, { memo, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cn } from '@/core/utils';

export interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl' | '4xl' | 'full';
  className?: string;
  /** Force centered-desktop behavior on all screens (confirm dialogs). */
  disableSheet?: boolean;
}

export const Modal: React.FC<ModalProps> = memo(({
  isOpen,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
  className,
  disableSheet = false,
}) => {
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    if (isOpen) {
      window.addEventListener('keydown', handleEscape);
    }
    return () => window.removeEventListener('keydown', handleEscape);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const sizes: Record<NonNullable<ModalProps['size']>, string> = {
    sm: 'max-w-sm',
    md: 'max-w-md',
    lg: 'max-w-lg',
    xl: 'max-w-xl',
    '2xl': 'max-w-2xl',
    '3xl': 'max-w-3xl',
    '4xl': 'max-w-4xl',
    full: 'max-w-[95vw]',
  };

  const isSheetLike = size === 'full' || size === '4xl' || size === '3xl';

  return createPortal(
    <div
      className={cn(
        'fixed inset-0 z-50',
        disableSheet || !isSheetLike
          ? 'flex items-center justify-center p-4'
          // Mobile: bottom sheet / Desktop: centered
          : 'flex items-end sm:items-center justify-center sm:p-4'
      )}
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-zinc-950/50 backdrop-blur-sm transition-opacity"
        onClick={onClose}
      />

      {/* Modal / Bottom sheet */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn(
          'relative bg-white dark:bg-zinc-900 rounded-t-3xl sm:rounded-2xl shadow-float w-full',
          'flex flex-col',
          disableSheet || !isSheetLike
            ? 'animate-fade-in rounded-2xl max-h-[90vh]'
            : isSheetLike
              ? 'animate-sheet-up max-h-[92dvh] sm:max-h-[90vh]'
              : 'animate-fade-in max-h-[90vh]',
          !disableSheet && isSheetLike &&
            'rounded-t-3xl max-h-[92dvh] sm:max-h-[90vh] sm:rounded-2xl pb-[max(env(safe-area-inset-bottom),0.75rem)]',
          disableSheet || !isSheetLike ? sizes[size] : cn(sizes[size], 'sm:max-h-[90vh]'),
          className
        )}
      >
        {/* Drag handle (sheet mode on mobile) */}
        {!disableSheet && isSheetLike && (
          <div className="sm:hidden flex justify-center pt-2.5 pb-1 shrink-0">
            <div className="w-10 h-1.5 rounded-full bg-zinc-300 dark:bg-zinc-700" />
          </div>
        )}

        {/* Header */}
        {(title || description) && (
          <div className="flex items-start justify-between px-5 sm:px-6 py-4 border-b border-zinc-200/70 dark:border-zinc-800 shrink-0">
            <div className="min-w-0">
              {title && <h3 className="text-base sm:text-lg font-bold text-zinc-900 dark:text-zinc-50 truncate">{title}</h3>}
              {description && <p className="text-xs sm:text-sm text-zinc-500 dark:text-zinc-400 mt-1">{description}</p>}
            </div>
            <button
              onClick={onClose}
              className="p-2 -me-1 rounded-xl text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
              aria-label="close"
            >
              <X size={20} />
            </button>
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 sm:px-6 py-4">{children}</div>

        {/* Footer */}
        {footer && (
          <div className="flex items-center justify-end gap-2 px-5 sm:px-6 py-4 border-t border-zinc-200/70 dark:border-zinc-800 shrink-0">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
});
