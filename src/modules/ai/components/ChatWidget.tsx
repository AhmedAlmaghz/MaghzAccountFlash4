import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Bot, X } from 'lucide-react';
import { useTranslation } from '@/core/i18n/useTranslation';
import { useAppStore } from '@/core/store';
import { usePermission } from '@/modules/auth/hooks/usePermission';
import { aiApi } from '../api';
import { ChatPanel } from './ChatPanel';
import { cn } from '@/core/utils';

/**
 * Floating chat widget — mounts at the root level.
 * Renders a FAB button + a popup chat panel.
 */
export function ChatWidget() {
  const { t } = useTranslation();
  const company = useAppStore((s) => s.activeCompany);
  const canUse = usePermission('ai.use');
  const [isOpen, setIsOpen] = useState(false);
  const [isConfigured, setIsConfigured] = useState<boolean | null>(null);

  // Check config
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
  }, [company?.id]);

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

  // Don't render if not configured
  if (!canUse || isConfigured === false || isConfigured === null) return null;

  const toggle = () => setIsOpen((prev) => !prev);

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
            <ChatPanel />
          </div>,
          document.body
        )}
    </>
  );
}
