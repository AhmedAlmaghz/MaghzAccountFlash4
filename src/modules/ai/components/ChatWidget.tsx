import { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { Bot, Settings, X } from 'lucide-react';
import { useTranslation } from '@/core/i18n/useTranslation';
import { useAppStore } from '@/core/store';
import { usePermission } from '@/modules/auth/hooks/usePermission';
import { aiApi } from '../api';
import { ChatPanel } from './ChatPanel';
import { Button } from '@/core/ui/components/Button';
import { cn } from '@/core/utils';

/**
 * Floating chat widget — mounts at the root level.
 * Renders a FAB button + a popup chat panel.
 *
 * The FAB is visible whenever the user has `ai.use` once the config check
 * resolves, including the unconfigured state — so the user can discover and
 * configure the AI assistant (web and desktop alike). The popup shows a
 * setup card until the assistant is configured.
 */
export function ChatWidget() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const company = useAppStore((s) => s.activeCompany);
  const canUse = usePermission('ai.use');
  const canConfigure = usePermission('ai.settings');
  const [isOpen, setIsOpen] = useState(false);
  const [isConfigured, setIsConfigured] = useState<boolean | null>(null);
  const [toggleCount, setToggleCount] = useState(0);

  const toggle = useCallback(() => {
    setIsOpen((prev) => !prev);
    setToggleCount((c) => c + 1);
  }, []);

  // Check config on company change and each toggle so the widget reflects
  // fresh configuration state right after saving the settings.
  useEffect(() => {
    let cancelled = false;
    async function check() {
      if (!company?.id) { setIsConfigured(false); return; }
      const res = await aiApi.getConfig(company.id);
      if (cancelled) return;
      setIsConfigured(res.success && !!res.data?.enabled && !!res.data?.hasApiKey);
    }
    check();
    return () => { cancelled = true; };
  }, [company?.id, toggleCount]);

  // Global keyboard shortcuts
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Cmd/Ctrl+K — toggle widget
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setIsOpen((prev) => !prev);
        return;
      }
      // Escape — close widget
      if (e.key === 'Escape' && isOpen) {
        // Only close if not inside the chat input (let ChatInput handle its own Escape)
        const target = e.target as HTMLElement;
        if (!target.closest('[data-chat-input]')) {
          setIsOpen(false);
        }
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  // Only hide before the initial config check resolves (or without permission).
  // Once a company is loaded, the FAB renders even when AI is not configured,
  // and its popup shows the setup card instead of the chat.
  if (!canUse || !company?.id || isConfigured === null) return null;

  return (
    <>
      {/* FAB Button */}
      <button
        onClick={toggle}
        className={cn(
          'fixed bottom-6 left-6 z-50 w-14 h-14 rounded-full shadow-lg flex items-center justify-center transition-all duration-200',
          isOpen
            ? 'bg-slate-800 dark:bg-slate-700 text-white rotate-0'
            : 'bg-primary-600 text-white hover:bg-primary-700 hover:scale-105'
        )}
        title={isOpen ? t('ai.widget.close') : t('ai.widget.open') + ' (Ctrl+K)'}
      >
        {isOpen ? <X size={24} /> : <Bot size={24} />}
      </button>

      {/* Chat panel */}
      {isOpen &&
        createPortal(
          <div className="fixed bottom-24 left-4 sm:left-6 z-50 w-[calc(100vw-2rem)] sm:w-[400px] h-[600px] max-h-[80vh] rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 flex flex-col overflow-hidden animate-fade-in">
            {isConfigured ? (
              <ChatPanel />
            ) : (
              <AiSetupPanel
                onClose={() => setIsOpen(false)}
                canConfigure={canConfigure}
                onOpenSettings={() => {
                  setIsOpen(false);
                  navigate('/settings/ai');
                }}
              />
            )}
          </div>,
          document.body
        )}
    </>
  );
}

/** Panel shown inside the chat popup before the AI assistant is configured. */
function AiSetupPanel({ onClose, canConfigure, onOpenSettings }: {
  onClose: () => void;
  canConfigure: boolean;
  onOpenSettings: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-2 border-b border-slate-200 dark:border-slate-700 shrink-0">
        <div className="flex items-center gap-2">
          <Bot size={16} className="text-primary-600 dark:text-primary-400" />
          <span className="text-sm font-semibold text-slate-800 dark:text-slate-200">{t('ai.title')}</span>
        </div>
        <button
          onClick={onClose}
          className="p-1.5 rounded-md text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          title={t('ai.widget.close')}
        >
          <X size={16} />
        </button>
      </div>
      <div className="flex-1 flex flex-col items-center justify-center px-6 text-center">
        <div className="w-14 h-14 rounded-2xl bg-primary-100 dark:bg-primary-900/30 flex items-center justify-center mb-4">
          <Bot size={26} className="text-primary-600 dark:text-primary-400" />
        </div>
        <h2 className="text-sm font-bold text-slate-900 dark:text-slate-50 mb-1">{t('ai.notConfigured')}</h2>
        <p className="text-xs text-slate-500 dark:text-slate-400 mb-5 max-w-xs">{t('ai.notConfiguredDesc')}</p>
        {canConfigure ? (
          <Button size="sm" leftIcon={<Settings size={14} />} onClick={onOpenSettings}>
            {t('ai.goToSettings')}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
