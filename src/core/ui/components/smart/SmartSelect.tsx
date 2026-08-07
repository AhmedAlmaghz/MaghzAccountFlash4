import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Check, ChevronDown, X, Plus, Search, Loader2 } from 'lucide-react';
import { Button, Modal, Input } from '@/core/ui/components';
import { useTranslation } from '@/core/i18n/useTranslation';

export interface SmartSelectItem {
  id: string;
  label: string;
  sublabel?: string;
  disabled?: boolean;
  description?: string;
  meta?: Array<{ label: string; value: string }>;
}

export interface SmartSelectProps<T extends SmartSelectItem> {
  value?: string | string[];
  onChange: (value: string | string[] | null) => void;
  /**
   * Optional callback fired after a single-select pick with the full item
   * object. Allows parents to react to extra item data (price, barcode, etc.)
   * without having to look it up again.
   */
  onItemSelect?: (item: T) => void;
  options: T[];
  isLoading?: boolean;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyMessage?: string;
  creatable?: boolean;
  creatableLabel?: string;
  onCreate?: (query: string) => Promise<{ id: string; label: string } | null>;
  multiple?: boolean;
  disabled?: boolean;
  clearable?: boolean;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  renderItem?: (item: T, selected: boolean) => React.ReactNode;
  renderTrigger?: (selected: T | T[] | null) => React.ReactNode;
}

export function SmartSelect<T extends SmartSelectItem>({
  value,
  onChange,
  onItemSelect,
  options,
  isLoading = false,
  placeholder,
  searchPlaceholder,
  emptyMessage,
  creatable = false,
  creatableLabel,
  onCreate,
  multiple = false,
  disabled = false,
  clearable = true,
  size = 'md',
  className = '',
  renderItem,
  renderTrigger,
}: SmartSelectProps<T>) {
  const { t } = useTranslation();
  const resolvedPlaceholder = placeholder ?? t('select.default.placeholder');
  const resolvedSearchPlaceholder = searchPlaceholder ?? t('select.default.search');
  const resolvedEmptyMessage = emptyMessage ?? t('select.default.empty');
  const resolvedCreatableLabel = creatableLabel ?? t('select.default.addNew');
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);
  const [createLoading, setCreateLoading] = useState(false);
  const [newValue, setNewValue] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [highlightedIndex, setHighlightedIndex] = useState(0);

  const selectedValues = useMemo(() => {
    if (multiple) return Array.isArray(value) ? value : [];
    return value ? [value as string] : [];
  }, [value, multiple]);

  const selectedItems = useMemo(() => {
    return options.filter(o => selectedValues.includes(o.id));
  }, [options, selectedValues]);

  const singleSelected = useMemo(() => {
    return !multiple && selectedItems.length === 1 ? selectedItems[0] : null;
  }, [multiple, selectedItems]);

  const filteredOptions = useMemo(() => {
    if (!search) return options;
    const q = search.toLowerCase();
    return options.filter(o =>
      o.label.toLowerCase().includes(q) ||
      (o.sublabel?.toLowerCase().includes(q) ?? false)
    );
  }, [options, search]);

  // Reset highlighted index when filtered options change
  useEffect(() => {
    setHighlightedIndex(0);
  }, [filteredOptions.length]);

  const handleSelect = (id: string) => {
    if (multiple) {
      const current = Array.isArray(value) ? [...value] : [];
      if (current.includes(id)) {
        onChange(current.filter(v => v !== id));
      } else {
        onChange([...current, id]);
        const item = options.find(o => o.id === id);
        if (item && onItemSelect) onItemSelect(item);
      }
    } else {
      onChange(id);
      const item = options.find(o => o.id === id);
      if (item && onItemSelect) onItemSelect(item);
      setOpen(false);
      setSearch('');
    }
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange(multiple ? [] : null);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!open) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightedIndex(prev => Math.min(prev + 1, filteredOptions.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightedIndex(prev => Math.max(prev - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filteredOptions[highlightedIndex] && !filteredOptions[highlightedIndex].disabled) {
        handleSelect(filteredOptions[highlightedIndex].id);
      }
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  const handleCreate = async () => {
    if (!onCreate || !newValue.trim()) return;
    setCreateLoading(true);
    const result = await onCreate(newValue.trim());
    setCreateLoading(false);
    if (result) {
      handleSelect(result.id);
      setCreating(false);
      setNewValue('');
    }
  };

  // Close on click outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Scroll highlighted into view
  useEffect(() => {
    if (listRef.current && open) {
      const el = listRef.current.children[highlightedIndex] as HTMLElement;
      if (el) el.scrollIntoView({ block: 'nearest' });
    }
  }, [highlightedIndex, open]);

  const sizeClasses = {
    sm: 'h-8 text-sm px-2',
    md: 'h-10 text-sm px-3',
    lg: 'h-12 text-base px-4',
  };

  const displayLabel = () => {
    if (renderTrigger) {
      return renderTrigger(multiple ? selectedItems : singleSelected);
    }
    if (singleSelected) {
      return (
        <div className="flex items-center gap-2 min-w-0">
          <span className="truncate">{singleSelected.label}</span>
          {singleSelected.sublabel && (
            <span className="text-slate-400 text-xs truncate">{singleSelected.sublabel}</span>
          )}
        </div>
      );
    }
    if (multiple && selectedItems.length > 0) {
      return (
        <div className="flex items-center gap-1 flex-wrap">
          {selectedItems.slice(0, 3).map(item => (
            <span key={item.id} className="bg-primary-100 text-primary-700 text-xs px-1.5 py-0.5 rounded-md">
              {item.label}
            </span>
          ))}
          {selectedItems.length > 3 && (
            <span className="text-slate-500 text-xs">+{selectedItems.length - 3}</span>
          )}
        </div>
      );
    }
    return <span className="text-slate-400">{resolvedPlaceholder}</span>;
  };

  return (
    <div ref={containerRef} className={`relative ${className}`} dir="rtl" onKeyDown={handleKeyDown}>
      {/* Trigger */}
      <button
        type="button"
        onClick={() => !disabled && setOpen(!open)}
        disabled={disabled}
        className={`
          w-full flex items-center justify-between gap-2 rounded-lg border border-slate-300 dark:border-slate-600
          bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100
          hover:border-primary-400 dark:hover:border-primary-500
          focus:outline-none focus:ring-2 focus:ring-primary-500/30 focus:border-primary-500
          transition-colors
          ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
          ${sizeClasses[size]}
        `}
      >
        <span className="flex-1 min-w-0 text-right truncate">
          {displayLabel()}
        </span>
        <div className="flex items-center gap-1 shrink-0">
          {isLoading && <Loader2 size={14} className="animate-spin text-slate-400" />}
          {clearable && selectedValues.length > 0 && !disabled && (
            <span
              role="button"
              tabIndex={0}
              title={t('common.clear')}
              onClick={(e) => { e.stopPropagation(); handleClear(e as unknown as React.MouseEvent); }}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); handleClear(e as unknown as React.MouseEvent); } }}
              className="p-0.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-md text-slate-400 hover:text-rose-500 transition-colors cursor-pointer"
            >
              <X size={14} />
            </span>
          )}
          <ChevronDown size={14} className={`text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
        </div>
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute z-50 w-full mt-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg shadow-lg overflow-hidden">
          {/* Search bar */}
          <div className="flex items-center border-b border-slate-200 dark:border-slate-700 px-3 py-2 gap-2">
            <Search size={14} className="text-slate-400 shrink-0" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder={resolvedSearchPlaceholder}
              className="flex-1 bg-transparent border-none outline-none text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400"
              autoFocus
            />
            {creatable && (
              <button
                type="button"
                onClick={() => setCreating(true)}
                className="p-1 hover:bg-primary-50 dark:hover:bg-primary-900/20 rounded-md text-primary-600 transition-colors"
                title={resolvedCreatableLabel}
              >
                <Plus size={14} />
              </button>
            )}
          </div>

          {/* Options list */}
          <div ref={listRef} className="max-h-60 overflow-y-auto p-1">
            {filteredOptions.length === 0 && !isLoading ? (
              <div className="py-6 text-center text-sm text-slate-400">
                {search && creatable ? (
                  <button
                    type="button"
                    onClick={() => { setNewValue(search); setCreating(true); }}
                    className="flex items-center justify-center gap-2 w-full text-primary-600 hover:text-primary-700"
                  >
                    <Plus size={14} />
                    {resolvedCreatableLabel} &quot;{search}&quot;
                  </button>
                ) : (
                  resolvedEmptyMessage
                )}
              </div>
            ) : (
              <div className="space-y-0.5">
                {filteredOptions.map((item, idx) => {
                  const isSelected = selectedValues.includes(item.id);
                  const isDisabled = item.disabled ?? false;
                  const isHighlighted = idx === highlightedIndex;
                  return (
                    <div
                      key={item.id}
                      onMouseEnter={() => setHighlightedIndex(idx)}
                      onClick={() => !isDisabled && handleSelect(item.id)}
                      className={`
                        flex items-center gap-2 px-3 py-2 rounded-md text-sm select-none
                        ${isDisabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}
                        ${isHighlighted ? 'bg-slate-100 dark:bg-slate-800' : ''}
                        ${isSelected ? 'bg-primary-50 dark:bg-primary-900/20 text-primary-700 dark:text-primary-300' : 'text-slate-700 dark:text-slate-200'}
                      `}
                    >
                      {multiple && (
                        <div className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${isSelected ? 'bg-primary-500 border-primary-500' : 'border-slate-300 dark:border-slate-600'}`}>
                          {isSelected && <Check size={10} className="text-white" />}
                        </div>
                      )}
                      <div className="flex-1 min-w-0 text-right">
                        {renderItem ? renderItem(item, isSelected) : (
                          <div className="space-y-0.5">
                            <div className="truncate font-medium">{item.label}</div>
                            {item.sublabel && <div className="text-xs text-slate-500 dark:text-slate-400 truncate">{item.sublabel}</div>}
                            {item.meta && item.meta.length > 0 && (
                              <div className="flex items-center gap-2 flex-wrap text-[10px] text-slate-500 dark:text-slate-400 pt-0.5">
                                {item.meta.map((m, i) => (
                                  <span key={i} className="inline-flex items-center gap-1 bg-slate-100 dark:bg-slate-800 rounded px-1.5 py-0.5">
                                    <span className="text-slate-400">{m.label}:</span>
                                    <span className="font-medium text-slate-700 dark:text-slate-200">{m.value}</span>
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                      {!multiple && isSelected && <Check size={14} className="text-primary-500 shrink-0" />}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Create Modal */}
      {creating && (
        <Modal
          isOpen={creating}
          onClose={() => { setCreating(false); setNewValue(''); }}
          title={resolvedCreatableLabel}
          size="sm"
          footer={
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" onClick={() => { setCreating(false); setNewValue(''); }}>{t('common.cancel')}</Button>
              <Button size="sm" onClick={handleCreate} isLoading={createLoading} leftIcon={<Plus size={14} />}>{t('common.create')}</Button>
            </div>
          }
        >
          <Input
            label={t('common.name')}
            value={newValue}
            onChange={e => setNewValue(e.target.value)}
            autoFocus
            placeholder={t('common.enterName')}
          />
        </Modal>
      )}
    </div>
  );
}

export default SmartSelect;
