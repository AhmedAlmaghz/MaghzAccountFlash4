import { create } from 'zustand';
import type { ChatMessage, PendingToolCall } from './types';

/**
 * AI chat UI state — messages, processing flag, and current session.
 * sessionId is null until the conversation is first persisted; loading a
 * saved session sets it so subsequent saves update the same row.
 */
interface AiChatState {
  messages: ChatMessage[];
  isProcessing: boolean;
  sessionId: string | null;

  addMessage: (msg: Omit<ChatMessage, 'id' | 'createdAt'>) => string;
  updateMessageContent: (messageId: string, content: string) => void;
  removeMessage: (messageId: string) => void;
  /** Drop every message after (and including) the given index — used by regenerate. */
  truncateMessages: (keepCount: number) => void;
  updateToolCall: (messageId: string, patch: Partial<PendingToolCall>) => void;
  setProcessing: (value: boolean) => void;
  clearMessages: () => void;
  setSessionId: (id: string | null) => void;
  loadSession: (sessionId: string, messages: ChatMessage[]) => void;
}

export const useAiStore = create<AiChatState>()((set) => ({
  messages: [],
  isProcessing: false,
  sessionId: null,

  addMessage: (msg) => {
    // P1 fix: crypto.randomUUID is undefined in insecure browsing contexts
    // (plain http on a LAN IP — the documented web mode) and threw a
    // TypeError on the FIRST message, killing chat entirely. Same fallback
    // shape as attachments/extract.ts newId().
    const id =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `msg-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
    const message: ChatMessage = { ...msg, id, createdAt: Date.now() };
    set((state) => ({ messages: [...state.messages, message] }));
    return id;
  },

  updateMessageContent: (messageId, content) =>
    set((state) => ({
      messages: state.messages.map((m) =>
        m.id === messageId ? { ...m, content } : m
      ),
    })),

  removeMessage: (messageId) =>
    set((state) => ({
      messages: state.messages.filter((m) => m.id !== messageId),
    })),

  truncateMessages: (keepCount) =>
    set((state) => ({
      messages: keepCount <= 0 ? [] : state.messages.slice(0, keepCount),
    })),

  updateToolCall: (messageId, patch) =>
    set((state) => ({
      messages: state.messages.map((m) =>
        m.id === messageId && m.toolCall ? { ...m, toolCall: { ...m.toolCall, ...patch } } : m
      ),
    })),

  setProcessing: (value) => set({ isProcessing: value }),

  clearMessages: () => set({ messages: [], isProcessing: false, sessionId: null }),

  setSessionId: (id) => set({ sessionId: id }),

  loadSession: (sessionId, messages) =>
    set({ sessionId, messages, isProcessing: false }),
}));
