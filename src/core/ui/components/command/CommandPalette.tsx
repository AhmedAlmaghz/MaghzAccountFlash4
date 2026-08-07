import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import {
  Search,
  CornerDownLeft,
  ArrowUp,
  ArrowDown,
  Loader2,
  LayoutDashboard,
  Calculator,
  Package,
  ShoppingCart,
  Store,
  Factory,
  Users,
  HeartHandshake,
  BarChart3,
  Settings,
  Bot,
  type LucideIcon,
} from 'lucide-react';
import { useTranslation } from '@/core/i18n/useTranslation';
import { useAuthStore } from '@/modules/auth/store';
import { useAppStore } from '@/core/store';
import { cn } from '@/core/utils';
import { paletteItems, canAccessItem, type PaletteModule } from './paletteItems';
import { filterItems, highlightParts } from './paletteSearch';

const MODULE_ICONS: Record<PaletteModule, LucideIcon> = {
  core: LayoutDashboard,
  accounting: Calculator,
  inventory: Package,
  sales: ShoppingCart,
  purchases: Store,
  manufacturing: Factory,
  hr: Users,
  crm: HeartHandshake,
  reports: BarChart3,
  settings: Settings,
  ai: Bot,
};

const MODULE_ORDER: PaletteModule[] = [
  'core',
  'accounting',
  'inventory',
  'sales',
  'purchases',
  'manufacturing',
  'hr',
  'crm',
  'reports',
  'settings',
  'ai',
];

export interface EntityResult {
  key: string;
  label: string;
  subtitle?: string;
}

export interface EntitySource {
  key: string;
  /** i18n key for the group header (e.g. sidebar.sales.customers). */
  groupKey: string;
  /** Route to navigate to when the entity is selected. */
  path: string;
  icon: LucideIcon;
  fetch: (companyId: string, query: string) => Promise<EntityResult[]>;
}

export interface CommandPaletteProps {
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  /** Optional entity search sources (injected by the app shell). */
  entitySources?: EntitySource[];
}

interface SelectableRow {
  key: string;
  label: string;
  subtitle?: string;
  path: string;
  icon: LucideIcon;
  groupKey: string;
}

interface EntityGroup {
  key: string;
  groupKey: string;
  rows: SelectableRow[];
}

const MAX_PAGE_RESULTS = 12;
const MAX_ENTITY_RESULTS_PER_SOURCE = 5;

export const CommandPalette: React.FC<CommandPaletteProps> = ({
  open,
  onOpen,
  onClose,
  entitySources = [],
}) => {
  const { t, language } = useTranslation();
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [entityGroups, setEntityGroups] = useState<EntityGroup[]>([]);
  const [entityLoading, setEntityLoading] = useState(false);

  // Reactive subscriptions — recompute page access when auth state changes.
  const user = useAuthStore((s) => s.user);
  const permissions = useAuthStore((s) => s.permissions);
  const activeCompany = useAppStore((s) => s.activeCompany);

  const hasPermission = useCallback(
    (permission: string) => useAuthStore.getState().hasPermission(permission),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [user, permissions],
  );

  // Global shortcut: Ctrl/Cmd+K toggles the palette.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        if (open) onClose();
        else onOpen();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onOpen, onClose]);

  // Reset state on open + focus the input.
  useEffect(() => {
    if (open) {
      setQuery('');
      setSelectedIndex(0);
      setEntityGroups([]);
      requestAnimationFrame(() => inputRef.current?.focus());
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [open]);

  // Close on Escape (works even when the input is blurred).
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  // Debounced entity search.
  useEffect(() => {
    if (!open) return;
    const trimmed = query.trim();
    if (!trimmed || !activeCompany?.id || entitySources.length === 0) {
      setEntityGroups([]);
      setEntityLoading(false);
      return;
    }
    setEntityLoading(true);
    let cancelled = false;
    const timer = setTimeout(async () => {
      const results = await Promise.allSettled<EntityGroup>(
        entitySources.map(async (source) => {
          const items = await source.fetch(activeCompany.id, trimmed);
          return {
            key: source.key,
            groupKey: source.groupKey,
            rows: items.slice(0, MAX_ENTITY_RESULTS_PER_SOURCE).map((item) => ({
              key: `${source.key}:${item.key}`,
              label: item.label,
              subtitle: item.subtitle,
              path: source.path,
              icon: source.icon,
              groupKey: source.groupKey,
            })),
          };
        }),
      );
      if (cancelled) return;
      const groups = results
        .filter((r): r is PromiseFulfilledResult<EntityGroup> => r.status === 'fulfilled')
        .map((r) => r.value)
        .filter((g) => g.rows.length > 0);
      setEntityGroups(groups);
      setEntityLoading(false);
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [open, query, activeCompany?.id, entitySources]);

  // Accessible + labeled pages, filtered by query.
  const pageGroups = useMemo(() => {
    const accessible = paletteItems.filter((item) =>
      canAccessItem(item, user?.role, hasPermission),
    );
    const labeled = accessible.map((item) => ({
      ...item,
      label: t(item.labelKey),
    }));
    const filtered = filterItems(labeled, query.trim());

    return MODULE_ORDER.map((module) => {
      const rows = filtered
        .filter((item) => item.module === module)
        .slice(0, MAX_PAGE_RESULTS)
        .map((item) => ({
          key: item.id,
          label: item.label,
          subtitle: item.path,
          path: item.path,
          icon: MODULE_ICONS[item.module],
          groupKey: `sidebar.${module}.title`,
        }));
      return { module, rows };
    }).filter((group) => group.rows.length > 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, user?.id, user?.role, permissions, language]);

  const pageGroupsFlat = useMemo(
    () => pageGroups.flatMap((g) => g.rows),
    [pageGroups],
  );

  // All selectable rows: pages first, then entities.
  const allRows = useMemo(
    () => [...pageGroupsFlat, ...entityGroups.flatMap((g) => g.rows)],
    [pageGroupsFlat, entityGroups],
  );

  const hasResults = allRows.length > 0;
  const isEmptyQuery = query.trim().length === 0;

  // Keep selection in bounds.
  useEffect(() => {
    setSelectedIndex((i) => Math.min(Math.max(i, 0), Math.max(allRows.length - 1, 0)));
  }, [allRows.length]);

  // Scroll the selected row into view.
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-palette-key="${allRows[selectedIndex]?.key}"]`);
    if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex, allRows]);

  const selectRow = (row: SelectableRow) => {
    navigate(row.path);
    onClose();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, Math.max(allRows.length - 1, 0)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const row = allRows[selectedIndex];
      if (row) selectRow(row);
    }
  };

  const renderRow = (row: SelectableRow, isSelected: boolean) => (
    <button
      key={row.key}
      data-palette-key={row.key}
      type="button"
      onClick={() => selectRow(row)}
      onMouseEnter={() => setSelectedIndex(allRows.findIndex((r) => r.key === row.key))}
      className={cn(
        'w-full flex items-center gap-3 px-4 py-2.5 text-start transition-colors',
        isSelected
          ? 'bg-primary-600/10 text-primary-400'
          : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800',
      )}
    >
      <row.icon size={18} className="shrink-0 text-slate-400" />
      <span className="flex-1 text-sm min-w-0">
        {highlightParts(row.label, query.trim()).map((seg, i) =>
          seg.match ? (
            <mark
              key={i}
              className="bg-amber-200/70 dark:bg-amber-500/30 text-inherit rounded-sm px-0.5 font-semibold"
            >
              {seg.text}
            </mark>
          ) : (
            <span key={i}>{seg.text}</span>
          ),
        )}
        {row.subtitle && (
          <span className="ms-2 text-xs text-slate-400 dark:text-slate-500 hidden md:inline">
            {row.subtitle}
          </span>
        )}
      </span>
      {isSelected && <CornerDownLeft size={14} className="shrink-0 text-primary-500" />}
    </button>
  );

  return createPortal(
    <div className={cn('fixed inset-0 z-50', !open && 'pointer-events-none')} aria-hidden={!open}>
      {/* Backdrop */}
      <div
        className={cn(
          'absolute inset-0 bg-black/50 backdrop-blur-sm transition-opacity duration-150',
          open ? 'opacity-100' : 'opacity-0',
        )}
        onClick={onClose}
      />

      {/* Panel */}
      <div
        role="dialog"
        aria-label={t('palette.title')}
        className={cn(
          'absolute left-1/2 top-[15vh] w-[min(92vw,42rem)] -translate-x-1/2',
          'bg-white dark:bg-slate-900 rounded-xl shadow-2xl ring-1 ring-slate-200 dark:ring-slate-700',
          'transition-all duration-150 overflow-hidden',
          open ? 'opacity-100 scale-100' : 'opacity-0 scale-95 pointer-events-none',
        )}
      >
        {/* Input */}
        <div className="flex items-center gap-3 px-4 border-b border-slate-200 dark:border-slate-800">
          <Search size={18} className="text-slate-400 shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            onKeyDown={handleKeyDown}
            placeholder={t('palette.searchPlaceholder')}
            aria-label={t('palette.searchLabel')}
            className="flex-1 bg-transparent py-4 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none"
          />
          {entityLoading && <Loader2 size={16} className="animate-spin text-slate-400 shrink-0" />}
          <kbd className="hidden sm:inline-block px-1.5 py-0.5 text-[10px] font-mono text-slate-400 bg-slate-100 dark:bg-slate-800 rounded border border-slate-200 dark:border-slate-700 shrink-0">
            ESC
          </kbd>
        </div>

        {/* Results */}
        <div ref={listRef} className="max-h-[50vh] overflow-y-auto py-2">
          {hasResults ? (
            <>
              {/* Pages group */}
              {pageGroupsFlat.length > 0 && (
                <div>
                  <div className="px-4 py-1.5 text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                    {t('palette.pagesGroup')}
                  </div>
                  {pageGroupsFlat.map((row) => renderRow(row, allRows[selectedIndex]?.key === row.key))}
                </div>
              )}

              {/* Entity groups */}
              {entityGroups.map((group) => (
                <div key={group.key}>
                  <div className="px-4 py-1.5 text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                    {t(group.groupKey)}
                  </div>
                  {group.rows.map((row) => renderRow(row, allRows[selectedIndex]?.key === row.key))}
                </div>
              ))}
            </>
          ) : (
            <div className="px-6 py-10 text-center">
              <div className="mx-auto w-10 h-10 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
                <Search size={18} className="text-slate-400" />
              </div>
              <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">
                {isEmptyQuery ? t('palette.typeToSearch') : t('palette.noResults')}
              </p>
              {!isEmptyQuery && (
                <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">{t('palette.noResultsHint')}</p>
              )}
            </div>
          )}
        </div>

        {/* Footer hints */}
        <div className="flex items-center gap-4 px-4 py-2.5 border-t border-slate-200 dark:border-slate-800 text-[11px] text-slate-400">
          <span className="flex items-center gap-1">
            <kbd className="px-1 py-0.5 font-mono bg-slate-100 dark:bg-slate-800 rounded border border-slate-200 dark:border-slate-700">
              <ArrowUp size={10} className="inline" />
              <ArrowDown size={10} className="inline" />
            </kbd>
            {t('palette.hintNavigate')}
          </span>
          <span className="flex items-center gap-1">
            <kbd className="px-1 py-0.5 font-mono bg-slate-100 dark:bg-slate-800 rounded border border-slate-200 dark:border-slate-700">
              ↵
            </kbd>
            {t('palette.hintSelect')}
          </span>
          <span className="flex items-center gap-1">
            <kbd className="px-1 py-0.5 font-mono bg-slate-100 dark:bg-slate-800 rounded border border-slate-200 dark:border-slate-700">
              ESC
            </kbd>
            {t('palette.hintClose')}
          </span>
          <span className="ms-auto hidden sm:inline">{t('palette.ctrlK')}</span>
        </div>
      </div>
    </div>,
    document.body,
  );
};
