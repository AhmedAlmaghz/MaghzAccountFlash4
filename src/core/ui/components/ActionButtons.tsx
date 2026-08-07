import React from 'react';
import { Pencil, Trash2, Printer, Download, Eye } from 'lucide-react';
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
  const iconSize = size === 'sm' ? 14 : 16;

  return (
    <div className={cn('flex items-center gap-1', className)}>
      {showView && onView && (
        <Button
          size={size}
          variant="ghost"
          onClick={onView}
          disabled={disabled}
          title="عرض"
          className="text-blue-600 hover:text-blue-700 hover:bg-blue-50 dark:hover:bg-blue-900/20"
        >
          <Eye size={iconSize} />
        </Button>
      )}
      {showPreview && onPreview && (
        <Button
          size={size}
          variant="ghost"
          onClick={onPreview}
          disabled={disabled}
          title="معاينة"
          className="text-indigo-600 hover:text-indigo-700 hover:bg-indigo-50 dark:hover:bg-indigo-900/20"
        >
          <Eye size={iconSize} />
        </Button>
      )}
      {showEdit && onEdit && (
        <Button
          size={size}
          variant="ghost"
          onClick={onEdit}
          disabled={disabled || disabledEdit}
          title="تعديل"
          className="text-amber-600 hover:text-amber-700 hover:bg-amber-50 dark:hover:bg-amber-900/20"
        >
          <Pencil size={iconSize} />
        </Button>
      )}
      {showDelete && onDelete && (
        <Button
          size={size}
          variant="ghost"
          onClick={onDelete}
          disabled={disabled || disabledDelete}
          title="حذف"
          className="text-rose-600 hover:text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-900/20"
        >
          <Trash2 size={iconSize} />
        </Button>
      )}
      {showPrint && onPrint && (
        <Button
          size={size}
          variant="ghost"
          onClick={onPrint}
          disabled={disabled}
          title="طباعة"
          className="text-slate-600 hover:text-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800"
        >
          <Printer size={iconSize} />
        </Button>
      )}
      {showExport && onExport && (
        <Button
          size={size}
          variant="ghost"
          onClick={onExport}
          disabled={disabled}
          title="تصدير"
          className="text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 dark:hover:bg-emerald-900/20"
        >
          <Download size={iconSize} />
        </Button>
      )}
    </div>
  );
};

export default ActionButtons;
