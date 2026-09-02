import { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Bot,
  History,
  Plus,
  Settings,
  Trash2,
  Download,
  FileJson,
  FileText,
  Sparkles,
  X,
} from 'lucide-react';
import { useTranslation } from '@/core/i18n/useTranslation';
import { useAppStore } from '@/core/store';
import { usePermission } from '@/modules/auth/hooks/usePermission';
import { aiApi } from '../api';
import { aiPersistence } from '../api/persistence';
import { getChatEngine } from '../engine/chatEngine';
import { useAiStore } from '../store';
import { ChatPanel } from './ChatPanel';
import { SessionsDrawer } from './SessionsDrawer';
import { Button } from '@/core/ui/components/Button';
import { Card } from '@/core/ui/components/Card';
import { useIsMobile, useBodyScrollLock, useEscapeKey } from '@/core/hooks/useResponsive';
import { cn } from '@/core/utils';

export default function AiChatPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const company = useAppStore((s) => s.activeCompany);
  const canUse = usePermission('ai.use');
  const canConfigure = usePermission('ai.settings');
  const messages = useAiStore((s) => s.messages);
  const sessionId = useAiStore((s) => s.sessionId);
  const [configStatus, setConfigStatus] = useState<'loading' | 'configured' | 'not_configured'>('loading');
  const [showSessions, setShowSessions] = useState(false);
  const [sessionsKey, setSessionsKey] = useState(0);
  const [exportOpen, setExportOpen] = useState(false);
  const exportRef = useRef<HTMLDivElement>(null);
  const isMobile = useIsMobile();

  useBodyScrollLock(showSessions && isMobile);
  useEscapeKey(exportOpen, () => setExportOpen(false));

  // Check if AI is configured
  useEffect(() => {
    let cancelled = false;
    async function check() {
      if (!company?.id) {
        setConfigStatus('not_configured');
        return;
      }
      const res = await aiApi.getConfig(company.id);
      if (cancelled) return;
      if (res.success && res.data?.enabled && res.data?.hasApiKey) {
        setConfigStatus('configured');
      } else {
        setConfigStatus('not_configured');
      }
    }
    check();
    return () => { cancelled = true; };
  }, [company?.id]);

  // Close export dropdown on outside click
  useEffect(() => {
    if (!exportOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (exportRef.current && !exportRef.current.contains(e.target as Node)) {
        setExportOpen(false);
      }
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [exportOpen]);

  const handleNewChat = () => {
    // Persist the current conversation in the background — the save snapshots
    // the store synchronously, so resetting immediately afterwards is safe and
    // the UI never waits on the DB round-trip.
    void aiPersistence.saveCurrentSession();
    getChatEngine().reset();
    setSessionsKey((k) => k + 1);
    setShowSessions(false);
  };

  const handleClear = () => {
    getChatEngine().reset();
  };

  const handleGoToSettings = () => {
    navigate('/settings/ai');
  };

  const handleSelectSession = async (sid: string) => {
    // Background save of the conversation we're leaving (snapshot is taken
    // synchronously inside the persistence layer) — never block the switch.
    void aiPersistence.saveCurrentSession();
    setShowSessions(false);
    // Reset (clears engine LLM history + store), then restore the
    // saved messages into the store. Engine history starts fresh — the
    // system prompt is re-injected on the next send.
    getChatEngine().reset();
    const loaded = await aiPersistence.loadSession(sid);
    if (!loaded) return;
    // Rebuild LLM history from persisted messages so the model has context
    getChatEngine().restoreHistory(useAiStore.getState().messages);
  };

  const handleRenameSession = async (sid: string, newTitle: string) => {
    await aiPersistence.renameSession(sid, newTitle);
    setSessionsKey((k) => k + 1);
  };

  const handleDeleteSession = async (sid: string) => {
    await aiPersistence.deleteSession(sid);
    if (sid === sessionId) getChatEngine().reset();
    setSessionsKey((k) => k + 1);
  };

  // ── Export actions (moved here from the old in-chat header) ────────────────
  const exportJson = useCallback(() => {
    setExportOpen(false);
    const json = JSON.stringify(messages, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ai-chat-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [messages]);

  const exportMarkdown = useCallback(() => {
    setExportOpen(false);
    const lines: string[] = [`# ${t('ai.title')}\n`];
    for (const msg of messages) {
      const role = msg.role === 'user' ? t('ai.you') || 'You' : t('ai.title');
      if (msg.content) {
        lines.push(`**${role}:** ${msg.content}\n`);
      }
      if (msg.toolCall) {
        lines.push(`> *${msg.toolCall.label}: ${msg.toolCall.resultSummary || msg.toolCall.status}*\n`);
      }
    }
    const md = lines.join('\n');
    const blob = new Blob([md], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ai-chat-${new Date().toISOString().split('T')[0]}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }, [messages, t]);

  if (!canUse) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-sm text-zinc-500 dark:text-zinc-400 px-6 text-center">
        <div className="w-14 h-14 rounded-2xl bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center mb-4">
          <Bot size={26} className="text-zinc-400" />
        </div>
        {t('ai.noPermission')}
      </div>
    );
  }

  // Not configured state
  if (configStatus === 'not_configured') {
    return (
      <div className="h-full flex flex-col items-center justify-center p-4 sm:p-6">
        <Card className="max-w-md w-full text-center">
          <div className="py-8 px-6">
            <div className="w-16 h-16 rounded-2xl bg-primary-50 dark:bg-primary-950/50 flex items-center justify-center mx-auto mb-4">
              <Bot size={30} className="text-primary-600 dark:text-primary-400" />
            </div>
            <h2 className="text-lg font-bold text-zinc-900 dark:text-zinc-50 mb-2">{t('ai.notConfigured')}</h2>
            <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-6 leading-relaxed">{t('ai.notConfiguredDesc')}</p>
            {canConfigure && (
              <Button onClick={handleGoToSettings} leftIcon={<Settings size={16} />}>
                {t('ai.goToSettings')}
              </Button>
            )}
          </div>
        </Card>
      </div>
    );
  }

  // Loading
  if (configStatus === 'loading') {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="animate-spin w-8 h-8 border-2 border-primary-600 border-t-transparent rounded-full" />
      </div>
    );
  }

  const hasMessages = messages.length > 0;

  // ── Shared toolbar buttons ─────────────────────────────────────────────────
  const toolbarButtons = (
    <>
      {/* Export dropdown — downloads the current conversation */}
      {hasMessages && (
        <div ref={exportRef} className="relative">
          <button
            onClick={() => setExportOpen((v) => !v)}
            className="p-2.5 rounded-xl text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors"
            title={t('ai.messageActions.exportAs')}
            aria-label={t('ai.messageActions.exportAs')}
            aria-expanded={exportOpen}
          >
            <Download size={18} />
          </button>
          {exportOpen && (
            <div className="absolute top-full end-0 mt-1 z-30 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl shadow-float py-1.5 min-w-40 animate-scale-in">
              <button
                onClick={exportJson}
                className="flex w-full items-center gap-2.5 px-3.5 py-2.5 min-h-11 text-sm font-medium text-start text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
              >
                <FileJson size={15} className="text-primary-600 dark:text-primary-400" />
                {t('ai.messageActions.exportJson')}
              </button>
              <button
                onClick={exportMarkdown}
                className="flex w-full items-center gap-2.5 px-3.5 py-2.5 min-h-11 text-sm font-medium text-start text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
              >
                <FileText size={15} className="text-primary-600 dark:text-primary-400" />
                {t('ai.messageActions.exportMarkdown')}
              </button>
            </div>
          )}
        </div>
      )}

      <button
        onClick={handleNewChat}
        className="p-2.5 rounded-xl text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors"
        title={t('ai.newChat')}
        aria-label={t('ai.newChat')}
      >
        <Plus size={18} />
      </button>
      <button
        onClick={() => setShowSessions((v) => !v)}
        className={cn(
          'p-2.5 rounded-xl transition-colors',
          showSessions
            ? 'bg-primary-100 dark:bg-primary-950/50 text-primary-700 dark:text-primary-300'
            : 'text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-900 dark:hover:text-zinc-100'
        )}
        title={t('ai.sessions.title')}
        aria-label={t('ai.sessions.title')}
        aria-expanded={showSessions}
      >
        <History size={18} />
      </button>
      {hasMessages && (
        <button
          onClick={handleClear}
          className="p-2.5 rounded-xl text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-900/20 transition-colors"
          title={t('ai.clearChat')}
          aria-label={t('ai.clearChat')}
        >
          <Trash2 size={18} />
        </button>
      )}
      {canConfigure && (
        <button
          onClick={handleGoToSettings}
          className="p-2.5 rounded-xl text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors"
          title={t('ai.settings.title')}
          aria-label={t('ai.settings.title')}
        >
          <Settings size={18} />
        </button>
      )}
    </>
  );

  // ── Main chat view ─────────────────────────────────────────────────────────
  return (
    <div className="h-full flex flex-col bg-zinc-50/50 dark:bg-zinc-900 -m-3 sm:-m-4 lg:-m-6">
      {/* Header — professional gradient bar */}
      <div className="relative shrink-0 bg-gradient-to-l from-primary-600 via-primary-700 to-primary-800 text-white overflow-hidden">
        {/* Decorative glow */}
        <div className="absolute -top-16 start-1/4 w-48 h-48 rounded-full bg-primary-400/30 blur-3xl pointer-events-none" aria-hidden="true" />
        <div className="absolute -bottom-20 end-10 w-56 h-40 rounded-full bg-gold-400/20 blur-3xl pointer-events-none" aria-hidden="true" />

        <div className="relative flex items-center justify-between gap-2 px-3 sm:px-5 py-3 sm:py-3.5">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-2xl bg-white/15 backdrop-blur flex items-center justify-center shrink-0 border border-white/20">
              <Sparkles size={19} className="text-white" />
            </div>
            <div className="min-w-0">
              <h1 className="text-sm sm:text-base font-bold text-white truncate">{t('ai.title')}</h1>
              <p className="text-[11px] sm:text-xs text-white/70 truncate hidden sm:block">{t('ai.subtitle')}</p>
            </div>
          </div>

          <div className="flex items-center gap-0.5 sm:gap-1 shrink-0">
            {toolbarButtons}
          </div>
        </div>
      </div>

      {/* Body: sessions drawer (desktop side panel / mobile sheet) + chat */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* Desktop side panel */}
        {showSessions && (
          <div className="hidden md:block w-72 shrink-0 border-e border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-y-auto">
            <div className="px-4 py-2.5 text-[11px] font-semibold text-zinc-400 dark:text-zinc-500 border-b border-zinc-100 dark:border-zinc-800 uppercase tracking-wide">
              {t('ai.sessions.title')}
            </div>
            <SessionsDrawer
              key={sessionsKey}
              onSelect={handleSelectSession}
              onDelete={handleDeleteSession}
              onRename={handleRenameSession}
              currentSessionId={sessionId}
            />
          </div>
        )}

        {/* Mobile sessions sheet */}
        {showSessions && isMobile && (
          <div className="md:hidden fixed inset-0 z-50">
            <div
              className="absolute inset-0 bg-zinc-950/50 backdrop-blur-sm"
              onClick={() => setShowSessions(false)}
              aria-hidden="true"
            />
            <div
              role="dialog"
              aria-modal="true"
              aria-label={t('ai.sessions.title')}
              className="absolute inset-x-0 bottom-0 top-16 bg-white dark:bg-zinc-900 rounded-t-3xl shadow-float flex flex-col animate-sheet-up overflow-hidden"
            >
              <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-200/70 dark:border-zinc-800 shrink-0">
                <div className="flex items-center gap-2">
                  <History size={18} className="text-primary-600 dark:text-primary-400" />
                  <span className="text-sm font-bold text-zinc-900 dark:text-zinc-50">{t('ai.sessions.title')}</span>
                </div>
                <button
                  onClick={() => setShowSessions(false)}
                  className="p-2.5 -me-1 rounded-xl text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-700 dark:hover:text-zinc-200 transition-colors"
                  aria-label={t('common.close')}
                >
                  <X size={20} />
                </button>
              </div>
              <div className="flex-1 overflow-hidden">
                <SessionsDrawer
                  key={sessionsKey}
                  onSelect={handleSelectSession}
                  onDelete={handleDeleteSession}
                  onRename={handleRenameSession}
                  currentSessionId={sessionId}
                />
              </div>
            </div>
          </div>
        )}

        {/* Chat fills the remaining space (full-bleed on mobile) */}
        <div className="flex-1 min-w-0 overflow-hidden">
          <ChatPanel />
        </div>
      </div>
    </div>
  );
}
