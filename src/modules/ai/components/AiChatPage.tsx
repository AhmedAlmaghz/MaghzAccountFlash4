import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bot, History, Plus, Settings, Trash2, X } from 'lucide-react';
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

  const handleNewChat = async () => {
    // Save current session before creating a new one
    await aiPersistence.saveCurrentSession();
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
    // Save current session first
    await aiPersistence.saveCurrentSession();
    // Reset (clears engine LLM history + store), then restore the
    // saved messages into the store. Engine history starts fresh — the
    // system prompt is re-injected on the next send.
    getChatEngine().reset();
    await aiPersistence.loadSession(sid);
    // Rebuild LLM history from persisted messages so the model has context
    getChatEngine().restoreHistory(useAiStore.getState().messages);
    setShowSessions(false);
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

  if (!canUse) {
    return (
      <div className="h-full flex items-center justify-center text-sm text-slate-500 dark:text-slate-400">
        {t('ai.noPermission')}
      </div>
    );
  }

  // Not configured state
  if (configStatus === 'not_configured') {
    return (
      <div className="h-full flex flex-col items-center justify-center p-6">
        <Card className="max-w-md w-full text-center">
          <div className="py-8 px-6">
            <div className="w-16 h-16 rounded-2xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center mx-auto mb-4">
              <Bot size={32} className="text-slate-400" />
            </div>
            <h2 className="text-lg font-bold text-slate-900 dark:text-slate-50 mb-2">{t('ai.notConfigured')}</h2>
            <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">{t('ai.notConfiguredDesc')}</p>
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

  // Main chat view
  return (
    <div className="h-full flex flex-col bg-white dark:bg-slate-900">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-slate-800">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-primary-100 dark:bg-primary-900/30 flex items-center justify-center">
            <Bot size={20} className="text-primary-600 dark:text-primary-400" />
          </div>
          <div>
            <h1 className="text-sm font-bold text-slate-900 dark:text-slate-50">{t('ai.title')}</h1>
            <p className="text-xs text-slate-500 dark:text-slate-400">{t('ai.subtitle')}</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleNewChat}
            leftIcon={<Plus size={14} />}
            title={t('ai.newChat')}
          />
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowSessions((v) => !v)}
            leftIcon={showSessions ? <X size={14} /> : <History size={14} />}
            title={t('ai.sessions.title')}
          />
          {messages.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleClear}
              leftIcon={<Trash2 size={14} />}
              title={t('ai.clearChat')}
            />
          )}
          {canConfigure && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleGoToSettings}
              leftIcon={<Settings size={14} />}
              title={t('ai.settings.title')}
            />
          )}
        </div>
      </div>

      {/* Body: optional sessions drawer + chat */}
      <div className="flex-1 flex overflow-hidden">
        {showSessions && (
          <div className="w-64 flex-shrink-0 border-l border-slate-200 dark:border-slate-800 overflow-y-auto">
            <div className="px-3 py-2 text-[11px] font-semibold text-slate-400 dark:text-slate-500 border-b border-slate-100 dark:border-slate-800">
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
        <div className="flex-1 overflow-hidden">
          <ChatPanel />
        </div>
      </div>
    </div>
  );
}
