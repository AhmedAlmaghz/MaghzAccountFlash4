import { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate } from 'react-router-dom';
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
  const location = useLocation();
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
  // The full AI chat page already hosts the assistant — hide the FAB there
  // to avoid a redundant floating control (cleaner UX).
  if (location.pathname === '/ai') return null;

  return (
    <>
      {/* FAB Button — sits above the mobile bottom nav with safe-area */}
      <button
        onClick={toggle}
        className={cn(
          'fixed z-50 w-14 h-14 rounded-full shadow-float flex items-center justify-center transition-all duration-200 active:scale-90',
          'bottom-[calc(5.5rem+env(safe-area-inset-bottom))] lg:bottom-6 left-4 lg:left-6',
          isOpen
            ? 'bg-zinc-800 dark:bg-zinc-700 text-white rotate-0'
            : 'bg-gradient-to-br from-primary-500 to-primary-700 text-white hover:shadow-lift hover:scale-105'
        )}
        title={isOpen ? t('ai.widget.close') : t('ai.widget.open') + ' (Ctrl+K)'}
        aria-label={isOpen ? t('ai.widget.close') : t('ai.widget.open')}
      >
        {isOpen ? <X size={24} /> : <Bot size={24} />}
      </button>

      {/* Chat panel — full-screen sheet on mobile, floating card on desktop */}
      {isOpen &&
        createPortal(
          <>
            {/* Mobile backdrop */}
            <div
              className="fixed inset-0 z-50 bg-zinc-950/50 backdrop-blur-sm lg:hidden"
              onClick={toggle}
              aria-hidden="true"
            />
            <div
              className={cn(
                'fixed z-50 flex flex-col overflow-hidden',
                // Mobile: full-screen sheet above bottom nav
                'inset-x-0 bottom-0 top-0 lg:inset-auto',
                // Desktop: floating card
                'lg:bottom-24 lg:left-6 lg:w-[400px] lg:h-[600px] lg:max-h-[80vh]',
                'lg:rounded-2xl lg:shadow-float lg:border lg:border-zinc-200 lg:dark:border-zinc-700',
                'bg-white dark:bg-zinc-900 rounded-none animate-fade-in pb-[env(safe-area-inset-bottom)] lg:pb-0'
              )}
            >
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
            </div>
          </>,
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
      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-200/70 dark:border-zinc-800 shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-primary-500 to-primary-700 flex items-center justify-center">
            <Bot size={16} className="text-white" />
          </div>
          <span className="text-sm font-bold text-zinc-800 dark:text-zinc-200">{t('ai.title')}</span>
        </div>
        <button
          onClick={onClose}
          className="p-2 rounded-xl text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
          title={t('ai.widget.close')}
          aria-label={t('ai.widget.close')}
        >
          <X size={18} />
        </button>
      </div>
      <div className="flex-1 flex flex-col items-center justify-center px-6 text-center">
        <div className="w-14 h-14 rounded-2xl bg-primary-50 dark:bg-primary-950/50 flex items-center justify-center mb-4">
          <Bot size={26} className="text-primary-600 dark:text-primary-400" />
        </div>
        <h2 className="text-sm font-bold text-zinc-900 dark:text-zinc-50 mb-1">{t('ai.notConfigured')}</h2>
        <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-5 max-w-xs leading-relaxed">{t('ai.notConfiguredDesc')}</p>
        {canConfigure ? (
          <Button size="sm" leftIcon={<Settings size={14} />} onClick={onOpenSettings}>
            {t('ai.goToSettings')}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
