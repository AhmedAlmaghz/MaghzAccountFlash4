import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MessageSquare, Trash2, Loader2, Search, Pencil, Check, X } from 'lucide-react';
import { useTranslation } from '@/core/i18n/useTranslation';
import { aiPersistence } from '../api/persistence';
import { formatDateTime } from '@/core/utils/locale';
import type { AiChatSessionSummary } from '../types';
import { cn } from '@/core/utils';

interface SessionsDrawerProps {
  onSelect: (sessionId: string) => void;
  onDelete: (sessionId: string) => void;
  onRename: (sessionId: string, newTitle: string) => void;
  currentSessionId: string | null;
}

function today(): string {
  return new Date().toDateString();
}

function yesterday(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toDateString();
}

function thisWeekRange(): [string, string] {
  const now = new Date();
  const dayOfWeek = now.getDay();
  const monday = new Date(now);
  monday.setDate(now.getDate() - ((dayOfWeek + 6) % 7));
  return [monday.toDateString(), now.toDateString()];
}

interface GroupedSessions {
  labelKey: string;
  sessions: AiChatSessionSummary[];
}

/** Lists saved chat sessions for the current user, with search and inline rename. */
export function SessionsDrawer({ onSelect, onDelete, onRename, currentSessionId }: SessionsDrawerProps) {
  const { t } = useTranslation();
  const [sessions, setSessions] = useState<AiChatSessionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const renameInputRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    const list = await aiPersistence.listSessions();
    setSessions(list);
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Auto-focus the rename input when editing starts
  useEffect(() => {
    if (renamingId && renameInputRef.current) {
      renameInputRef.current.focus();
    }
  }, [renamingId]);

  const filtered = useMemo(() => {
    if (!search.trim()) return sessions;
    const q = search.trim().toLowerCase();
    return sessions.filter(
      (s) =>
        (s.title && s.title.toLowerCase().includes(q)) ||
        q === '',
    );
  }, [sessions, search]);

  const groups = useMemo<GroupedSessions[]>(() => {
    if (filtered.length === 0) return [];
    const now = new Date();
    const todayStr = today();
    const yesterdayStr = yesterday();
    const [weekStartStr] = thisWeekRange();

    const groupsMap: Record<string, AiChatSessionSummary[]> = {};
    for (const s of filtered) {
      const d = new Date(s.updatedAt);
      const dateStr = d.toDateString();
      let key: string;
      if (dateStr === todayStr) {
        key = 'today';
      } else if (dateStr === yesterdayStr) {
        key = 'yesterday';
      } else if (d >= new Date(weekStartStr) && d <= now) {
        key = 'thisWeek';
      } else {
        key = 'older';
      }
      if (!groupsMap[key]) groupsMap[key] = [];
      groupsMap[key].push(s);
    }

    const order = ['today', 'yesterday', 'thisWeek', 'older'] as const;
    const result: GroupedSessions[] = [];
    for (const key of order) {
      if (groupsMap[key]) {
        result.push({ labelKey: `ai.sessions.${key}`, sessions: groupsMap[key] });
      }
    }
    return result;
  }, [filtered]);

  const handleStartRename = useCallback((e: React.MouseEvent, session: AiChatSessionSummary) => {
    e.stopPropagation();
    setRenamingId(session.id);
    setRenameValue(session.title || '');
  }, []);

  const handleCancelRename = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setRenamingId(null);
    setRenameValue('');
  }, []);

  const handleConfirmRename = useCallback(async (e: React.MouseEvent | React.KeyboardEvent) => {
    e.stopPropagation();
    if (!renamingId) return;
    const trimmed = renameValue.trim();
    if (trimmed && trimmed !== '') {
      await onRename(renamingId, trimmed);
    }
    setRenamingId(null);
    setRenameValue('');
  }, [renamingId, renameValue, onRename]);

  const handleRenameKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      void handleConfirmRename(e);
    } else if (e.key === 'Escape') {
      setRenamingId(null);
      setRenameValue('');
    }
  }, [handleConfirmRename]);

  const handleDelete = useCallback((e: React.MouseEvent, sessionId: string) => {
    e.stopPropagation();
    if (!confirm(t('ai.sessions.confirmDelete'))) return;
    onDelete(sessionId);
  }, [onDelete, t]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 size={20} className="animate-spin text-zinc-400" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Search */}
      <div className="px-3 py-2 border-b border-zinc-100 dark:border-zinc-800">
        <div className="relative">
          <Search size={14} className="absolute end-2.5 top-1/2 -translate-y-1/2 text-zinc-400 dark:text-zinc-500" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('ai.sessions.searchPlaceholder')}
            className="w-full pe-8 ps-2.5 py-2 text-xs rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/60 text-zinc-700 dark:text-zinc-200 placeholder:text-zinc-400 dark:placeholder:text-zinc-500 focus:outline-none focus:ring-1 focus:ring-primary-400 focus:border-primary-400 transition-colors"
            aria-label={t('ai.sessions.searchPlaceholder')}
          />
        </div>
      </div>

      {/* Session list */}
      <div className="flex-1 overflow-y-auto divide-y divide-zinc-100 dark:divide-zinc-800">
        {filtered.length === 0 ? (
          <div className="px-4 py-8 text-center text-xs text-zinc-400 dark:text-zinc-500">
            {search ? t('ai.sessions.empty') : t('ai.sessions.empty')}
          </div>
        ) : (
          groups.map((group) => (
            <div key={group.labelKey}>
              <div className="px-3 py-1.5 text-[10px] font-semibold text-zinc-400 dark:text-zinc-500">
                {t(group.labelKey)}
              </div>
              {group.sessions.map((s) => (
                <div
                  key={s.id}
                   className={cn(
                     'group flex items-center gap-2 px-3 py-2.5 cursor-pointer transition-colors',
                     s.id === currentSessionId
                       ? 'bg-primary-50 dark:bg-primary-950/50'
                       : 'hover:bg-zinc-50 dark:hover:bg-zinc-800/60'
                   )}
                   onClick={() => onSelect(s.id)}
                 >
                   <MessageSquare size={14} className={cn('flex-shrink-0', s.id === currentSessionId ? 'text-primary-600 dark:text-primary-400' : 'text-zinc-400 dark:text-zinc-500')} />
                   <div className="flex-1 min-w-0">
                     {renamingId === s.id ? (
                       <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                         <input
                           ref={renameInputRef}
                           type="text"
                           value={renameValue}
                           onChange={(e) => setRenameValue(e.target.value)}
                           onKeyDown={handleRenameKeyDown}
                           className="flex-1 text-xs px-1.5 py-0.5 rounded-lg border border-primary-300 dark:border-primary-700 bg-white dark:bg-zinc-800 text-zinc-800 dark:text-zinc-100 focus:outline-none focus:ring-1 focus:ring-primary-400"
                           aria-label={t('ai.sessions.renamePlaceholder')}
                         />
                         <button
                           onClick={handleConfirmRename}
                           className="p-1 rounded-lg text-primary-500 hover:text-primary-700 hover:bg-primary-50 dark:hover:bg-primary-950/50"
                           aria-label={t('ai.sessions.rename')}
                         >
                           <Check size={12} />
                         </button>
                         <button
                           onClick={handleCancelRename}
                           className="p-1 rounded-lg text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                           aria-label={t('common.close')}
                         >
                           <X size={12} />
                         </button>
                       </div>
                     ) : (
                       <>
                         <p className={cn(
                           'text-xs font-medium truncate',
                           s.id === currentSessionId
                             ? 'text-primary-700 dark:text-primary-300'
                             : 'text-zinc-700 dark:text-zinc-200'
                         )}>
                           {s.title || t('ai.sessions.untitled')}
                         </p>
                         <p className="text-[10px] text-zinc-400 dark:text-zinc-500 tabular">
                           {formatDateTime(s.updatedAt)} · {s.messageCount}
                         </p>
                       </>
                     )}
                   </div>

                   {renamingId !== s.id && (
                     <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                       <button
                         onClick={(e) => handleStartRename(e, s)}
                         className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                         title={t('ai.sessions.rename')}
                         aria-label={t('ai.sessions.rename')}
                       >
                         <Pencil size={12} />
                       </button>
                       <button
                         onClick={(e) => handleDelete(e, s.id)}
                         className="p-1.5 rounded-lg text-zinc-400 hover:text-danger-500 dark:hover:text-danger-400 hover:bg-danger-50 dark:hover:bg-danger-900/20 transition-colors"
                         title={t('ai.sessions.delete')}
                         aria-label={t('ai.sessions.delete')}
                       >
                         <Trash2 size={12} />
                       </button>
                     </div>
                   )}
                </div>
              ))}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
