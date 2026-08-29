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
import { Download, Bot } from 'lucide-react';
import { extractSuggestions, type Suggestion } from '../suggestions/suggestionEngine';

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

  // Export helpers
  const exportJson = useCallback(() => {
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

  // Empty state — suggestions
  if (messages.length === 0) {
    return (
      <div className="flex flex-col h-full">
        {/* Empty state */}
        <div className="flex-1 flex flex-col items-center justify-center px-6">
          <div className="w-16 h-16 rounded-2xl bg-primary-100 dark:bg-primary-900/30 flex items-center justify-center mb-4">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              className="w-8 h-8 text-primary-600 dark:text-primary-400"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path d="M12 2a7 7 0 017 7c0 2.38-1.19 4.47-3 5.74V17a2 2 0 01-2 2h-4a2 2 0 01-2-2v-2.26C6.19 13.47 5 11.38 5 9a7 7 0 017-7z" />
              <path d="M10 21v1a2 2 0 004 0v-1" />
            </svg>
          </div>
          <h2 className="text-lg font-bold text-slate-900 dark:text-slate-50 mb-1">{t('ai.title')}</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mb-6 text-center max-w-sm">{t('ai.subtitle')}</p>

          {/* Suggestion chips */}
          <div className="flex flex-wrap justify-center gap-2 max-w-lg">
            {[
              { key: 'sales', text: t('ai.suggestions.sales') },
              { key: 'stock', text: t('ai.suggestions.stock') },
              { key: 'invoice', text: t('ai.suggestions.invoice') },
              { key: 'customer', text: t('ai.suggestions.customer') },
              { key: 'navigate', text: t('ai.suggestions.navigate') },
              { key: 'report', text: t('ai.suggestions.report') },
            ].map((s) => (
              <button
                key={s.key}
                onClick={() => handleSend(s.text)}
                disabled={isProcessing}
                className="px-3 py-1.5 text-xs font-medium rounded-full border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-primary-50 dark:hover:bg-primary-900/20 hover:border-primary-300 dark:hover:border-primary-700 hover:text-primary-700 dark:hover:text-primary-300 transition-colors disabled:opacity-50"
              >
                {s.text}
              </button>
            ))}
          </div>
        </div>

        {/* Input */}
        <ChatInput onSend={handleSend} isProcessing={isProcessing} />
      </div>
    );
  }

  // Messages view
  return (
    <div className="flex flex-col h-full">
      {/* Header with export */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shrink-0">
        <div className="flex items-center gap-2">
          <Bot size={16} className="text-primary-600 dark:text-primary-400" />
          <span className="text-sm font-semibold text-slate-800 dark:text-slate-200">
            {t('ai.title')}
          </span>
        </div>
        <div className="flex items-center gap-1">
          {/* Export dropdown */}
          <div className="relative group">
            <button
              className="p-1.5 rounded-md text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              title={t('ai.messageActions.exportAs')}
            >
              <Download size={16} />
            </button>
            <div className="absolute left-0 top-full mt-1 hidden group-hover:block z-50">
              <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-lg py-1 min-w-[140px]">
                <button
                  onClick={exportJson}
                  className="w-full text-right px-3 py-1.5 text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
                >
                  {t('ai.messageActions.exportJson')}
                </button>
                <button
                  onClick={exportMarkdown}
                  className="w-full text-right px-3 py-1.5 text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
                >
                  {t('ai.messageActions.exportMarkdown')}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Messages scroll area */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
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
            <div className="w-8 h-8 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-600 dark:text-slate-300 flex-shrink-0">
              <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4" stroke="currentColor" strokeWidth={2}>
                <path d="M12 2a7 7 0 017 7c0 2.38-1.19 4.47-3 5.74V17a2 2 0 01-2 2h-4a2 2 0 01-2-2v-2.26C6.19 13.47 5 11.38 5 9a7 7 0 017-7z" />
                <path d="M10 21v1a2 2 0 004 0v-1" />
              </svg>
            </div>
            <div className="px-4 py-2.5 rounded-2xl rounded-bl-md bg-slate-100 dark:bg-slate-800">
              <div className="flex gap-1">
                <span className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Input */}
      <ChatInput onSend={handleSend} isProcessing={isProcessing} />
    </div>
  );
}
