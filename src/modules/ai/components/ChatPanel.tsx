import { useEffect, useRef, useCallback, useMemo } from 'react';
import { useTranslation } from '@/core/i18n/useTranslation';
import { useAppStore } from '@/core/store';
import { useAiStore } from '../store';
import { getChatEngine } from '../engine/chatEngine';
import { aiPersistence } from '../api/persistence';
import { prefetchEntityCache } from '../entityResolver';
import { registerNavigator, unregisterNavigator, navigateTo } from '../engine/navigationBridge';
import { useNavigate } from 'react-router-dom';
import { MessageBubble } from './MessageBubble';
import { ChatInput } from './ChatInput';
import { Bot, Sparkles } from 'lucide-react';
import { extractSuggestions, type Suggestion } from '../suggestions/suggestionEngine';
import { cn } from '@/core/utils';

export function ChatPanel() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const messages = useAiStore((s) => s.messages);
  const isProcessing = useAiStore((s) => s.isProcessing);
  const scrollRef = useRef<HTMLDivElement>(null);
  const engine = getChatEngine();

  // Register navigator for navigation tools
  useEffect(() => {
    registerNavigator(navigate);
    return () => unregisterNavigator();
  }, [navigate]);

  // Warm the entity cache in the background so the first message doesn't pay
  // the cold-fetch cost of every entity type (fire-and-forget, cached 30s).
  const companyId = useAppStore((s) => s.activeCompany?.id ?? '');
  useEffect(() => {
    if (companyId) prefetchEntityCache(companyId);
  }, [companyId]);

  // Tenant guard: discard the engine's LLM history when the ACTIVE company
  // changes — the singleton otherwise leaks the previous tenant's context
  // (documents, VAT rate, entities) into the new company's requests.
  useEffect(() => {
    if (companyId) getChatEngine().ensureCompanyScope(companyId);
  }, [companyId]);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    const el = scrollRef.current;
    if (el) {
      requestAnimationFrame(() => {
        el.scrollTop = el.scrollHeight;
      });
    }
  }, [messages, isProcessing]);

  // Persist conversation when a processing cycle finishes (true → false)
  const wasProcessing = useRef(false);
  useEffect(() => {
    if (wasProcessing.current && !isProcessing && messages.length > 0) {
      void aiPersistence.saveCurrentSession();
    }
    wasProcessing.current = isProcessing;
  }, [isProcessing, messages.length]);

  // Auto-save on navigation away (beforeunload)
  useEffect(() => {
    const handleBeforeUnload = () => {
      if (useAiStore.getState().messages.length > 0) {
        aiPersistence.saveCurrentSession();
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, []);

  // Periodic auto-save every 60 seconds while there are messages
  useEffect(() => {
    if (messages.length === 0) return;
    const interval = setInterval(() => {
      void aiPersistence.saveCurrentSession();
    }, 60000);
    return () => clearInterval(interval);
  }, [messages.length]);

  // Find the last user text for regenerate
  const lastUserText = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'user' && messages[i].kind === 'text') {
        return messages[i].content;
      }
    }
    return null;
  }, [messages]);

  // Get the last assistant message for regenerate + suggestion chips
  const lastAssistantIndex = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'assistant') return i;
    }
    return -1;
  }, [messages]);

  const handleSend = useCallback(async (text: string) => {
    await engine.send(text);
  }, [engine]);

  const handleConfirm = useCallback(async (callId: string, approved: boolean) => {
    await engine.resolveConfirmation(callId, approved);
  }, [engine]);

  const handleRegenerate = useCallback(async () => {
    if (lastUserText) {
      await engine.send(lastUserText);
    }
  }, [engine, lastUserText]);

  // Suggestions for the last assistant message — interactive action chips
  const lastAssistantSuggestions = useMemo<Suggestion[]>(() => {
    if (lastAssistantIndex < 0 || isProcessing) return [];
    const msg = messages[lastAssistantIndex];
    if (msg.role !== 'assistant' || msg.kind === 'error') return [];
    return extractSuggestions(msg);
  }, [messages, lastAssistantIndex, isProcessing]);

  const handleSuggestion = useCallback((suggestion: Suggestion) => {
    if (suggestion.type === 'navigate' && suggestion.path) {
      navigateTo(suggestion.path);
      return;
    }
    if (suggestion.type === 'prompt' && suggestion.promptKey) {
      void engine.send(t(suggestion.promptKey));
    }
  }, [engine, t]);

  // ── Empty state — welcome hero with starter prompts ─────────────────────────
  if (messages.length === 0) {
    return (
      <div className="flex flex-col h-full min-h-0 bg-zinc-50/50 dark:bg-zinc-900">
        {/* Hero */}
        <div className="flex-1 flex flex-col items-center justify-center px-4 sm:px-6 py-8 min-h-0">
          <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-3xl bg-gradient-to-br from-primary-500 to-primary-700 flex items-center justify-center mb-5 shadow-lift">
            <Sparkles className="w-8 h-8 sm:w-10 sm:h-10 text-white" />
          </div>
          <h2 className="text-xl sm:text-2xl font-bold text-zinc-900 dark:text-zinc-50 mb-2 text-center">
            {t('ai.title')}
          </h2>
          <p className="text-sm sm:text-base text-zinc-500 dark:text-zinc-400 mb-8 text-center max-w-md leading-relaxed">
            {t('ai.subtitle')}
          </p>

          {/* Starter prompt cards — grid on desktop, list on mobile */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 w-full max-w-2xl">
            {[
              { key: 'sales', text: t('ai.suggestions.sales'), icon: Bot },
              { key: 'invoice', text: t('ai.suggestions.invoice'), icon: Sparkles },
              { key: 'stock', text: t('ai.suggestions.stock'), icon: Bot },
              { key: 'report', text: t('ai.suggestions.report'), icon: Sparkles },
            ].map((s) => (
              <button
                key={s.key}
                onClick={() => handleSend(s.text)}
                disabled={isProcessing}
                className={cn(
                  'group flex items-start gap-3 p-4 min-h-14 text-start rounded-2xl border transition-all',
                  'border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900',
                  'hover:border-primary-300 dark:hover:border-primary-700 hover:shadow-lift active:scale-[0.98]',
                  'disabled:opacity-50 disabled:pointer-events-none'
                )}
              >
                <span className="mt-0.5 flex-shrink-0 w-8 h-8 rounded-xl bg-primary-50 dark:bg-primary-950/50 text-primary-600 dark:text-primary-400 flex items-center justify-center">
                  <s.icon size={15} />
                </span>
                <span className="flex-1 text-sm font-medium text-zinc-700 dark:text-zinc-200 leading-relaxed">
                  {s.text}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* Input */}
        <ChatInput onSend={handleSend} isProcessing={isProcessing} />
      </div>
    );
  }

  // ── Messages view ────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full min-h-0 bg-zinc-50/50 dark:bg-zinc-900">
      {/* Messages scroll area — centered column, full width on mobile */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto min-h-0">
        <div className="max-w-3xl w-full mx-auto px-3 sm:px-4 py-4 space-y-5">
          {messages.map((msg, idx) => (
            <MessageBubble
              key={msg.id}
              message={msg}
              onConfirm={handleConfirm}
              isLastAssistant={idx === lastAssistantIndex && !isProcessing}
              onRegenerate={idx === lastAssistantIndex && !isProcessing ? handleRegenerate : undefined}
              suggestions={idx === lastAssistantIndex ? lastAssistantSuggestions : undefined}
              onSuggestion={handleSuggestion}
            />
          ))}

          {/* Thinking indicator */}
          {isProcessing && messages[messages.length - 1]?.role === 'user' && (
            <div className="flex gap-3">
              <div className="w-9 h-9 rounded-2xl bg-gradient-to-br from-primary-500 to-primary-700 flex items-center justify-center text-white flex-shrink-0 shadow-lift">
                <Bot size={16} />
              </div>
              <div className="px-5 py-3 rounded-2xl rounded-bl-md bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 shadow-card">
                <div className="flex gap-1.5">
                  <span className="w-2 h-2 bg-primary-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                  <span className="w-2 h-2 bg-primary-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                  <span className="w-2 h-2 bg-primary-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Input */}
      <ChatInput onSend={handleSend} isProcessing={isProcessing} />
    </div>
  );
}
