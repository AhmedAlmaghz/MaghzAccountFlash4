import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Pencil, Trash2, Printer, Download, Eye, MoreVertical } from 'lucide-react';
import { Button } from './Button';
import { cn } from '@/core/utils';

interface ActionButtonsProps {
  onView?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  onPrint?: () => void;
  onPreview?: () => void;
  onExport?: () => void;
  size?: 'sm' | 'md';
  className?: string;
  showView?: boolean;
  showEdit?: boolean;
  showDelete?: boolean;
  showPrint?: boolean;
  showPreview?: boolean;
  showExport?: boolean;
  disabled?: boolean;
  disabledEdit?: boolean;
  disabledDelete?: boolean;
}

interface Action {
  key: string;
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  disabled: boolean;
  btnClass: string;
}

export const ActionButtons: React.FC<ActionButtonsProps> = ({
  onView,
  onEdit,
  onDelete,
  onPrint,
  onPreview,
  onExport,
  size = 'sm',
  className,
  showView = true,
  showEdit = true,
  showDelete = true,
  showPrint = false,
  showPreview = false,
  showExport = false,
  disabled = false,
  disabledEdit = false,
  disabledDelete = false,
}) => {
  const iconSize = size === 'sm' ? 15 : 17;
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const actions: Action[] = [];
  if (showView && onView)
    actions.push({
      key: 'view', label: 'عرض', onClick: onView, disabled,
      icon: <Eye size={iconSize} />,
      btnClass: 'text-sky-600 hover:text-sky-700 hover:bg-sky-50 dark:hover:bg-sky-900/20',
    });
  if (showPreview && onPreview)
    actions.push({
      key: 'preview', label: 'معاينة', onClick: onPreview, disabled,
      icon: <Eye size={iconSize} />,
      btnClass: 'text-indigo-600 hover:text-indigo-700 hover:bg-indigo-50 dark:hover:bg-indigo-900/20',
    });
  if (showEdit && onEdit)
    actions.push({
      key: 'edit', label: 'تعديل', onClick: onEdit, disabled: disabled || disabledEdit,
      icon: <Pencil size={iconSize} />,
      btnClass: 'text-amber-600 hover:text-amber-700 hover:bg-amber-50 dark:hover:bg-amber-900/20',
    });
  if (showDelete && onDelete)
    actions.push({
      key: 'delete', label: 'حذف', onClick: onDelete, disabled: disabled || disabledDelete,
      icon: <Trash2 size={iconSize} />,
      btnClass: 'text-rose-600 hover:text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-900/20',
    });
  if (showPrint && onPrint)
    actions.push({
      key: 'print', label: 'طباعة', onClick: onPrint, disabled,
      icon: <Printer size={iconSize} />,
      btnClass: 'text-zinc-600 hover:text-zinc-800 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800',
    });
  if (showExport && onExport)
    actions.push({
      key: 'export', label: 'تصدير', onClick: onExport, disabled,
      icon: <Download size={iconSize} />,
      btnClass: 'text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 dark:hover:bg-emerald-900/20',
    });

  const closeMenu = useCallback(() => setMenuOpen(false), []);

  useEffect(() => {
    if (!menuOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) closeMenu();
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeMenu();
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onEsc);
    };
  }, [menuOpen, closeMenu]);

  if (actions.length === 0) return null;

  const runAction = (a: Action) => {
    closeMenu();
    if (!a.disabled) a.onClick();
  };

  return (
    <div className={cn('flex items-center gap-1', className)} ref={menuRef}>
      {/* Mobile: kebab menu */}
      <div className="md:hidden relative">
        <button
          onClick={(e) => {
            e.stopPropagation();
            setMenuOpen((o) => !o);
          }}
          className="flex items-center justify-center w-10 h-10 rounded-xl text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
          aria-label="إجراءات"
          aria-expanded={menuOpen}
        >
          <MoreVertical size={18} />
        </button>
        {menuOpen && (
          // Anchored to the inline-START edge so the popup always opens INTO
          // the card: `end-0` grows toward the viewport edge and gets clipped
          // by the page scroll container in RTL (hidden to the right).
          <div className="absolute z-30 top-full start-0 mt-1 min-w-36 surface-pop border border-zinc-200 dark:border-zinc-800 rounded-2xl shadow-float py-1.5 animate-scale-in">
            {actions.map((a) => (
              <button
                key={a.key}
                onClick={(e) => {
                  e.stopPropagation();
                  runAction(a);
                }}
                disabled={a.disabled}
                className={cn(
                  'flex w-full items-center gap-2.5 px-3.5 py-2.5 text-sm font-medium min-h-11 text-start transition-colors disabled:opacity-40 disabled:pointer-events-none',
                  a.btnClass
                )}
              >
                {a.icon}
                {a.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Desktop: inline icon cluster */}
      <div className="hidden md:flex items-center gap-1">
        {actions.map((a) => (
          <Button
            key={a.key}
            size={size}
            variant="ghost"
            onClick={a.onClick}
            disabled={a.disabled}
            title={a.label}
            className={cn(a.btnClass, 'md:!min-h-9 md:!px-2.5')}
          >
            {a.icon}
          </Button>
        ))}
      </div>
    </div>
  );
};

export default ActionButtons;
